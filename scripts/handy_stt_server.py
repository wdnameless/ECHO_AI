"""
Handy Local STT Server
OpenAI-compatible transcription endpoint at http://127.0.0.1:8000
that Echo AI's "Handy Local STT (Local Whisper)" provider uses.

Engine priority (all local, no cloud):
  0. Nemotron 3.5 ASR 0.6B (sherpa-onnx, CUDA) - the model the user has
     loaded in Handy, run natively via the sherpa-onnx websocket server
     (GPU, model stays in memory). Auto-discovered from the Handy HuggingFace
     cache. This is the primary engine.
  1. faster-whisper (CTranslate2) - loaded ONCE and kept in memory.
     GPU (CUDA) -> float16, CPU -> int8. Default model: "small" (RU+EN).
  2. Handy CLI (handy.exe --transcribe-file) - fallback if sherpa/faster
     are unavailable.
  3. openai-whisper (CPU) - last resort.

Priority queue: final segments (X-Priority: high) are transcribed before
live partials (X-Priority: low), so the answer pipeline never waits behind
a backlog of 1-second partial chunks.
"""

import glob
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import threading
import time
import traceback
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

try:
    import numpy as np
except ImportError:
    np = None

try:
    import websocket as ws_client
except ImportError:
    ws_client = None

# Windows console uses cp1252/cp866 by default which crashes on Russian text.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HOST = "127.0.0.1"
PORT = 8000

APPDATA = os.environ.get("APPDATA", "")
HANDY_SETTINGS = os.path.join(APPDATA, "com.pais.handy", "settings_store.json")

HANDY_EXE_CANDIDATES = [
    os.environ.get("HANDY_EXE", ""),
    r"D:\progg\Handy\handy.exe",
    r"C:\Program Files\Handy\handy.exe",
    r"C:\Program Files (x86)\Handy\handy.exe",
]

# ---------------------------------------------------------------------------
# Nemotron 3.5 ASR (sherpa-onnx) - PRIMARY ENGINE
# The model is discovered from the Handy HuggingFace cache (the same GGUF the
# user loads in Handy) converted ONNX export; we run it natively through the
# sherpa-onnx online websocket server on CUDA.
# ---------------------------------------------------------------------------
NEMOTRON_SHERPA_PORT = int(os.environ.get("PLUELY_NEMOTRON_PORT", "6007"))
NEMOTRON_SHERPA_EXE_CANDIDATES = [
    os.environ.get("PLUELY_SHERPA_EXE", ""),
    os.path.join(os.environ.get("USERPROFILE", ""), ".cache", "pluely", "sherpa-onnx", "sherpa-onnx-online-websocket-server.exe"),
    r"D:\TMP\opencode\sherpa-gpu\sherpa-onnx-v1.13.6-cuda-12.x-cudnn-9.x-onnxruntime1.27.1-win-x64-cuda\bin\sherpa-onnx-online-websocket-server.exe",
]

# ONNX files in the same repo family (snapshot subdirs of the GGUF repo or
# the standalone sherpa export).
NEMOTRON_ONNX_DIRS = [
    os.environ.get("PLUELY_NEMOTRON_ONNX_DIR", ""),
    os.path.join(os.environ.get("USERPROFILE", ""), ".cache", "pluely", "nemotron-sherpa"),
    os.path.join(os.environ.get("USERPROFILE", ""), ".cache", "huggingface", "hub"),
]

_nemotron_server = None
_nemotron_ready = False
_nemotron_error = ""

def find_nemotron_files():
    """Locate encoder/decoder/joiner/tokens for the sherpa-onnx Nemotron export."""
    for base in NEMOTRON_ONNX_DIRS:
        if not base or not os.path.isdir(base):
            continue
        # direct dir (snapshot or our bundled copy)
        enc = os.path.join(base, "encoder.int8.onnx")
        dec = os.path.join(base, "decoder.int8.onnx")
        joi = os.path.join(base, "joiner.int8.onnx")
        tok = os.path.join(base, "tokens.txt")
        if all(os.path.isfile(p) for p in (enc, dec, joi, tok)):
            return {"encoder": enc, "decoder": dec, "joiner": joi, "tokens": tok}
        # scan HF hub model dirs
        if "huggingface" in base:
            for model_dir in glob.glob(os.path.join(base, "models--csukuangfj2--sherpa-onnx-nemotron-*")):
                for snap in glob.glob(os.path.join(model_dir, "snapshots", "*")):
                    enc = os.path.join(snap, "encoder.int8.onnx")
                    dec = os.path.join(snap, "decoder.int8.onnx")
                    joi = os.path.join(snap, "joiner.int8.onnx")
                    tok = os.path.join(snap, "tokens.txt")
                    if all(os.path.isfile(p) for p in (enc, dec, joi, tok)):
                        return {"encoder": enc, "decoder": dec, "joiner": joi, "tokens": tok}
    return None


def _nemotron_exe():
    for c in NEMOTRON_SHERPA_EXE_CANDIDATES:
        if c and os.path.isfile(c):
            return c
    return None


def start_nemotron_server():
    """Start the sherpa-onnx websocket server (CUDA) if possible."""
    global _nemotron_server, _nemotron_ready, _nemotron_error
    try:
        files = find_nemotron_files()
        if not files:
            _nemotron_error = "Nemotron ONNX files not found"
            log("Nemotron: " + _nemotron_error)
            return
        exe = _nemotron_exe()
        if not exe:
            _nemotron_error = "sherpa-onnx websocket server not found"
            log("Nemotron: " + _nemotron_error)
            return
        cmd = [
            exe,
            "--port", str(NEMOTRON_SHERPA_PORT),
            "--tokens", files["tokens"],
            "--encoder", files["encoder"],
            "--decoder", files["decoder"],
            "--joiner", files["joiner"],
            "--provider", "cuda",
            "--feat-dim", "128",
            "--num-work-threads", "4",
        ]
        _nemotron_server = subprocess.Popen(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        # wait for the port to open
        import socket
        for _ in range(60):
            time.sleep(0.5)
            try:
                s = socket.create_connection(("127.0.0.1", NEMOTRON_SHERPA_PORT), timeout=0.5)
                s.close()
                _nemotron_ready = True
                log("Nemotron sherpa server up (CUDA)")
                return
            except OSError:
                pass
        _nemotron_error = "sherpa server did not open the port"
        log("Nemotron: " + _nemotron_error)
    except Exception as e:
        _nemotron_error = f"start failed: {e}"
        log("Nemotron: " + _nemotron_error)


def transcribe_nemotron(wav_path: str, language: str = "auto") -> str:
    """Send a WAV through the sherpa-onnx websocket server (Nemotron)."""
    if not _nemotron_ready or np is None or ws_client is None:
        return ""
    try:
        import wave as wavemod
        with wavemod.open(wav_path, "rb") as w:
            if w.getframerate() != 16000 or w.getnchannels() != 1 or w.getsampwidth() != 2:
                return ""
            samples = w.readframes(w.getnframes())
        samples_float32 = np.frombuffer(samples, dtype=np.int16).astype(np.float32) / 32768

        ws = ws_client.create_connection(
            f"ws://127.0.0.1:{NEMOTRON_SHERPA_PORT}", timeout=60
        )
        chunks = 8000  # 0.5s
        results = []
        start = 0
        while start < samples_float32.shape[0]:
            end = min(start + chunks, samples_float32.shape[0])
            ws.send(samples_float32[start:end].tobytes(), opcode=ws_client.ABNF.OPCODE_BINARY)
            start += chunks
        ws.send("Done!")
        ws.settimeout(30)
        try:
            while True:
                msg = ws.recv()
                if msg == "Done!":
                    break
                try:
                    j = json.loads(msg)
                    if j.get("text"):
                        results.append(j["text"])
                except Exception:
                    pass
        except Exception:
            pass
        ws.close()
        text = results[-1].strip() if results else ""
        return text
    except Exception as e:
        log("Nemotron transcribe failed: " + str(e))
        return ""


WHISPER_MODEL_NAME = os.environ.get("PLUELY_WHISPER_MODEL", "small")
# Optional: fix the STT language instead of auto-detecting. Auto-detect on
# every request costs time and can jump between languages mid-utterance.
# Allowed: "ru", "en", "auto". Set PLUELY_STT_LANGUAGE=en for English-only.
STT_LANGUAGE = os.environ.get("PLUELY_STT_LANGUAGE", "auto").lower() or "auto"
# Beam size for decoding: 1 = fastest (greedy), 5 = most accurate.
STT_BEAM_SIZE = int(os.environ.get("PLUELY_STT_BEAM_SIZE", "1"))
# Number of CPU threads for the encoder/decoder (0 = auto).
STT_CPU_THREADS = int(os.environ.get("PLUELY_STT_CPU_THREADS", "0"))
# Parallel inference workers (1 = sequential; useful for partial burst load).
STT_NUM_WORKERS = int(os.environ.get("PLUELY_STT_NUM_WORKERS", "1"))
# Context hint improves recognition of tech/job interview terms ("Kubernetes",
# "Docker", "микросервисы") and works for BOTH fixed-language and auto modes.
STT_INITIAL_PROMPT = os.environ.get(
    "PLUELY_STT_INITIAL_PROMPT",
    "Расскажите про ваш опыт, проекты, стек технологий, Kubernetes, Docker, "
    "микросервисы, базы данных, собеседование, резюме.",
)

_log_lock = threading.Lock()


def log(msg: str) -> None:
    with _log_lock:
        print(f"[handy_stt][{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def find_handy_exe() -> str:
    for candidate in HANDY_EXE_CANDIDATES:
        if candidate and os.path.isfile(candidate):
            return candidate
    for base in (r"D:\progg\Handy", r"C:\Program Files\Handy", r"C:\Program Files (x86)\Handy"):
        p = os.path.join(base, "handy.exe")
        if os.path.isfile(p):
            return p
    raise FileNotFoundError("handy.exe not found")


def read_selected_model() -> str:
    """Read the model the user selected inside the Handy app."""
    try:
        with open(HANDY_SETTINGS, "r", encoding="utf-8", errors="replace") as f:
            data = json.load(f)
        model = (data.get("settings") or {}).get("selected_model", "")
        if model and re.search(r"\.gguf$", model):
            return model
    except Exception as e:
        log(f"Could not read Handy settings: {e}")
    return ""


# ---------------------------------------------------------------------------
# ENGINE 1: faster-whisper (persistent, in-memory model)
# ---------------------------------------------------------------------------
_fw_model = None
_fw_lock = threading.Lock()
_fw_ready = False
_fw_error = ""


def _load_faster_whisper():
    global _fw_model, _fw_ready, _fw_error
    try:
        from faster_whisper import WhisperModel
    except ImportError as e:
        _fw_error = f"faster-whisper not installed: {e}"
        log(_fw_error)
        return

    try:
        import torch
        use_cuda = torch.cuda.is_available()
    except Exception:
        use_cuda = False

    device = "cuda" if use_cuda else "cpu"
    compute_type = "float16" if use_cuda else "int8"
    log(f"Loading faster-whisper model '{WHISPER_MODEL_NAME}' on {device}/{compute_type}...")
    try:
        load_kwargs = {}
        if STT_CPU_THREADS > 0:
            load_kwargs["cpu_threads"] = STT_CPU_THREADS
        if STT_NUM_WORKERS > 0:
            load_kwargs["num_workers"] = STT_NUM_WORKERS
        _fw_model = WhisperModel(
            WHISPER_MODEL_NAME,
            device=device,
            compute_type=compute_type,
            **load_kwargs,
        )
        _fw_ready = True
        log("faster-whisper model loaded and kept in memory")
    except Exception as e:
        _fw_error = f"faster-whisper load failed: {e}"
        log(_fw_error)


def transcribe_faster_whisper(wav_path: str, language: str = "auto") -> str:
    global _fw_model
    with _fw_lock:
        if _fw_model is None:
            return ""
        try:
            # Fixed language (ru|en) when provided - the model NEVER
            # auto-detects other languages.
            lang = language if language in ("ru", "en") else None
            segments, _info = _fw_model.transcribe(
                wav_path,
                language=lang,
                beam_size=STT_BEAM_SIZE,
                vad_filter=True,
                condition_on_previous_text=False,
                initial_prompt=STT_INITIAL_PROMPT,
                # Skip word timestamps: the app only needs the plain text.
                # Disabling timestamp decoding measurably cuts latency.
                without_timestamps=True,
            )
            text = " ".join(seg.text.strip() for seg in segments).strip()
            return text
        except Exception as e:
            log("faster-whisper failed: " + str(e))
            return ""


# ---------------------------------------------------------------------------
# ENGINE 2: Handy CLI (fallback, spawns a process per request)
# ---------------------------------------------------------------------------
_handy_lock = threading.Lock()


def transcribe_handy(wav_path: str, model_id: str) -> str:
    with _handy_lock:
        handy = find_handy_exe()
        cmd = [handy, "--transcribe-file", wav_path]
        if model_id:
            cmd += ["--model", model_id]
        cmd += ["--device-index", "0", "--json"]
        log("Running: " + " ".join(cmd))
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=180,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        out = (proc.stdout or "") + (proc.stderr or "")
        m = re.search(r"\{.*\}", out, re.DOTALL)
        if m:
            try:
                parsed = json.loads(m.group(0))
                text = (parsed.get("text") or "").strip()
                if text:
                    return text
            except Exception:
                pass
        log("No JSON transcript found, output tail: " + out[-300:])
        return ""


# ---------------------------------------------------------------------------
# ENGINE 3: openai-whisper (CPU, last resort)
# ---------------------------------------------------------------------------
_whisper_model = None
_whisper_lock = threading.Lock()


def transcribe_local_whisper(wav_path: str, language: str = "auto") -> str:
    global _whisper_model
    with _whisper_lock:
        if _whisper_model is None:
            log("Loading local whisper model (CPU)...")
            try:
                import whisper
            except ImportError as e:
                log(f"openai-whisper not installed: {e}")
                return ""
            _whisper_model = whisper.load_model("base")
            log("Local whisper model loaded")
        try:
            result = _whisper_model.transcribe(
                wav_path,
                language=language if language in ("ru", "en") else None,
                fp16=False,
                no_speech_threshold=0.6,
                condition_on_previous_text=False,
            )
            text = (result.get("text") or "").strip()
            log("Local whisper OK: " + text[:80])
            return text
        except Exception as e:
            log("Local whisper failed: " + str(e))
            return ""


# ---------------------------------------------------------------------------
# Priority queue: high (final segments) before low (live partials)
# ---------------------------------------------------------------------------
_high_queue = deque()
_low_queue = deque()
_queue_cv = threading.Condition()
_engine_state = {"engine": "starting", "model": WHISPER_MODEL_NAME, "ready": False}


def enqueue(wav_path: str, priority: str, language: str = "auto") -> str:
    """Blocking: enqueue and wait for the transcription result."""
    result_holder = {}
    done = threading.Event()
    with _queue_cv:
        item = (wav_path, language, result_holder, done)
        if priority == "low":
            _low_queue.append(item)
        else:
            _high_queue.append(item)
        _queue_cv.notify()
    done.wait()
    return result_holder.get("text", "")


def _worker():
    while True:
        with _queue_cv:
            while not _high_queue and not _low_queue:
                _queue_cv.wait()
            if _high_queue:
                wav_path, language, holder, done = _high_queue.popleft()
            else:
                wav_path, language, holder, done = _low_queue.popleft()

        text = ""
        try:
            # PRIMARY: Nemotron 3.5 ASR via sherpa-onnx (CUDA, persistent).
            if _nemotron_ready:
                text = transcribe_nemotron(wav_path, language)
            # Fallback 1: faster-whisper (GPU/CUDA, in-memory).
            if not text and _fw_ready:
                text = transcribe_faster_whisper(wav_path, language)
            # Fallback 2: Handy CLI (Vulkan GPU).
            if not text:
                model_id = read_selected_model()
                if model_id:
                    text = transcribe_handy(wav_path, model_id)
            # Last resort: local CPU whisper.
            if not text:
                text = transcribe_local_whisper(wav_path, language)
        except Exception as e:
            log("Worker transcription error: " + str(e))
        finally:
            holder["text"] = text
            done.set()


def _warmup():
    """Load the persistent engine at startup so the first request is fast."""
    # PRIMARY: start the Nemotron sherpa-onnx server (CUDA) in the background.
    threading.Thread(target=start_nemotron_server, daemon=True).start()
    _load_faster_whisper()
    if _fw_ready:
        _engine_state.update(engine="faster-whisper", ready=True)
        # Verify the pipeline with a tiny silent wav.
        try:
            import struct
            import wave as wavemod

            fd, tmp = tempfile.mkstemp(suffix=".wav")
            os.close(fd)
            with wavemod.open(tmp, "wb") as w:
                w.setnchannels(1)
                w.setsampwidth(2)
                w.setframerate(16000)
                w.writeframes(struct.pack("<" + "h" * 1600, *([0] * 1600)))
            transcribe_faster_whisper(tmp)
            os.remove(tmp)
            log("Warmup transcription OK")
        except Exception as e:
            log("Warmup check skipped: " + str(e))
    else:
        _engine_state.update(engine="handy-cli", ready=False)
        log("faster-whisper unavailable, will use Handy CLI fallback")


# ---------------------------------------------------------------------------
# HTTP server
# ---------------------------------------------------------------------------
class STTHandler(BaseHTTPRequestHandler):
    server_version = "HandySTT/2.0"

    def log_message(self, fmt, *args):
        log(f"{self.address_string()} - {fmt % args}")

    def _send_json(self, status: int, obj: dict):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Priority")
        self.end_headers()

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/health":
            self._send_json(200, {
                "status": "ok" if _engine_state["ready"] else "degraded",
                "engine": _engine_state["engine"],
                "model": _engine_state["model"],
                "error": _fw_error or None,
            })
            return
        if path == "/v1/models":
            self._send_json(200, {"data": [{"id": _engine_state["model"]}]})
            return
        self._send_json(404, {"error": "Not found"})

    def do_POST(self):
        path = urlsplit(self.path).path
        if path.rstrip("/") != "/v1/audio/transcriptions":
            self._send_json(404, {"error": "Not found"})
            return
        try:
            content_type = self.headers.get("Content-Type", "")
            length = int(self.headers.get("Content-Length", "0") or 0)
            body = self.rfile.read(length) if length else b""

            if not body:
                self._send_json(400, {"error": "Empty request body"})
                return

            priority = self.headers.get("X-Priority", "high").lower()
            if priority not in ("high", "low"):
                priority = "high"

            # Fixed language from the app (ru|en). The model NEVER
            # auto-detects: only these two languages are transcribed.
            lang = self.headers.get("X-Language", "").lower()
            if lang not in ("ru", "en"):
                lang = STT_LANGUAGE if STT_LANGUAGE in ("ru", "en") else "auto"

            wav = extract_multipart(body, content_type)
            if not wav:
                self._send_json(400, {"error": "No audio file field in the request"})
                return

            fd, tmp = tempfile.mkstemp(suffix=".wav")
            try:
                with os.fdopen(fd, "wb") as f:
                    f.write(wav)
                log(f"Transcribing {len(wav)} bytes (priority={priority}, lang={lang})")
                text = enqueue(tmp, priority, lang)
            finally:
                try:
                    os.remove(tmp)
                except Exception:
                    pass

            if not text:
                self._send_json(500, {"error": "Transcription failed (all engines returned empty)"})
                return
            log(f"OK: {text[:80]}")
            self._send_json(200, {"text": text})
        except Exception as e:
            log(traceback.format_exc())
            self._send_json(500, {"error": str(e)})


def extract_multipart(body: bytes, content_type: str):
    m = re.search(r'boundary=(?:"([^"]+)"|([^;\s]+))', content_type)
    if not m:
        return None
    boundary = (m.group(1) or m.group(2)).encode()
    file_field = None
    for part in body.split(b"--" + boundary):
        head_end = part.find(b"\r\n\r\n")
        if head_end < 0:
            continue
        headers = part[:head_end].decode("latin-1", errors="replace")
        content = part[head_end + 4:]
        if content.endswith(b"\r\n"):
            content = content[:-2]
        if re.search(r'name="file"', headers, re.I):
            file_field = content
    return file_field


def main():
    if "--check" in sys.argv:
        try:
            print("OK handy=" + find_handy_exe())
            print("OK model=" + (read_selected_model() or "(none)"))
        except Exception as e:
            print(f"ERROR {e}")
        return

    threading.Thread(target=_warmup, daemon=True).start()
    threading.Thread(target=_worker, daemon=True).start()

    server = ThreadingHTTPServer((HOST, PORT), STTHandler)
    log(f"Listening on http://{HOST}:{PORT}")
    try:
        server.serve_forever()
    finally:
        # Stop the Nemotron sherpa server (CUDA) when we exit.
        if _nemotron_server is not None:
            try:
                _nemotron_server.terminate()
            except Exception:
                pass


if __name__ == "__main__":
    main()
