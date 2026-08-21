"""
Handy Local STT Server
OpenAI-compatible transcription endpoint at http://127.0.0.1:8000
that Pluely's "Handy Local STT (Local Whisper)" provider uses.

Engine priority (all local, no cloud):
  1. faster-whisper (CTranslate2) - model loaded ONCE and kept in memory.
     GPU (CUDA) -> float16, CPU -> int8. Default model: "small" (RU+EN).
     Override with PLUELY_WHISPER_MODEL env var.
  2. Handy CLI (handy.exe --transcribe-file) - fallback if faster-whisper
     is not installed.
  3. openai-whisper (CPU) - last resort.

Priority queue: final segments (X-Priority: high) are transcribed before
live partials (X-Priority: low), so the answer pipeline never waits behind
a backlog of 1-second partial chunks.
"""

import glob
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
import traceback
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

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

WHISPER_MODEL_NAME = os.environ.get("PLUELY_WHISPER_MODEL", "small")

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
        _fw_model = WhisperModel(
            WHISPER_MODEL_NAME,
            device=device,
            compute_type=compute_type,
        )
        _fw_ready = True
        log("faster-whisper model loaded and kept in memory")
    except Exception as e:
        _fw_error = f"faster-whisper load failed: {e}"
        log(_fw_error)


def transcribe_faster_whisper(wav_path: str) -> str:
    global _fw_model
    with _fw_lock:
        if _fw_model is None:
            return ""
        try:
            segments, _info = _fw_model.transcribe(
                wav_path,
                language=None,
                beam_size=1,
                vad_filter=True,
                condition_on_previous_text=False,
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


def transcribe_local_whisper(wav_path: str) -> str:
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
                language=None,
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


def enqueue(wav_path: str, priority: str) -> str:
    """Blocking: enqueue and wait for the transcription result."""
    result_holder = {}
    done = threading.Event()
    with _queue_cv:
        item = (wav_path, result_holder, done)
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
                wav_path, holder, done = _high_queue.popleft()
            else:
                wav_path, holder, done = _low_queue.popleft()

        text = ""
        try:
            if _fw_ready:
                text = transcribe_faster_whisper(wav_path)
            if not text:
                model_id = read_selected_model()
                if model_id:
                    text = transcribe_handy(wav_path, model_id)
            if not text:
                text = transcribe_local_whisper(wav_path)
        except Exception as e:
            log("Worker transcription error: " + str(e))
        finally:
            holder["text"] = text
            done.set()


def _warmup():
    """Load the persistent engine at startup so the first request is fast."""
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

            wav = extract_multipart(body, content_type)
            if not wav:
                self._send_json(400, {"error": "No audio file field in the request"})
                return

            fd, tmp = tempfile.mkstemp(suffix=".wav")
            try:
                with os.fdopen(fd, "wb") as f:
                    f.write(wav)
                log(f"Transcribing {len(wav)} bytes (priority={priority})")
                text = enqueue(tmp, priority)
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
    server.serve_forever()


if __name__ == "__main__":
    main()
