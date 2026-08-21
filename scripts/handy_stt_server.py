"""
Handy Local STT Server
OpenAI-compatible transcription endpoint at http://127.0.0.1:8000
that wraps the Handy CLI (handy.exe --transcribe-file) so Pluely's
"Handy Local STT (Local Whisper)" provider works out of the box.

Uses the model selected inside the Handy app (settings_store.json).
Pure Python standard library - no dependencies.
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

_lock = threading.Lock()


def log(msg: str) -> None:
    with _lock:
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


def resolve_gguf(model_id: str) -> str:
    """Resolve model id to the local GGUF file in the HuggingFace cache."""
    cache_root = os.path.join(
        os.environ.get("USERPROFILE", ""), ".cache", "huggingface", "hub"
    )
    if not os.path.isdir(cache_root):
        return ""
    model_basename = os.path.basename(model_id)
    for repo_dir in glob.glob(os.path.join(cache_root, "models--*")):
        name_part = os.path.basename(repo_dir).replace("models--", "").replace("--", "/")
        if name_part not in model_id:
            continue
        snapshots = os.path.join(repo_dir, "snapshots")
        if not os.path.isdir(snapshots):
            continue
        for rev in os.listdir(snapshots):
            rev_path = os.path.join(snapshots, rev)
            for root, _, files in os.walk(rev_path):
                for f in files:
                    if f.endswith(".gguf"):
                        full = os.path.join(root, f)
                        if f == model_basename:
                            return full
                        if len(files) == 1:
                            return full
    return ""


def transcribe_wav(wav_path: str, model_id: str) -> str:
    handy = find_handy_exe()
    cmd = [handy, "--transcribe-file", wav_path]
    if model_id:
        cmd += ["--model", model_id]
    # Prefer the Vulkan GPU device (index 0) for ~40x real-time transcription.
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
# LOCAL OFFLINE FALLBACK - openai-whisper (CPU, base.pt already cached).
# Used when the Handy GPU model fails or is not selected - NO CLOUD,
# NO API KEYS, NO 429 rate limits.
# ---------------------------------------------------------------------------
_whisper_model = None
_whisper_lock = threading.Lock()
WHISPER_MODEL_NAME = os.environ.get("PLUELY_WHISPER_MODEL", "base")


def transcribe_local_whisper(wav_path: str) -> str:
    """Transcribe using locally installed openai-whisper (CPU)."""
    global _whisper_model
    with _whisper_lock:
        if _whisper_model is None:
            log(f"Loading local whisper model '{WHISPER_MODEL_NAME}' (CPU)...")
            try:
                import whisper
            except ImportError as e:
                log(f"openai-whisper not installed: {e}")
                return ""
            _whisper_model = whisper.load_model(WHISPER_MODEL_NAME)
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


class STTHandler(BaseHTTPRequestHandler):
    server_version = "HandySTT/1.0"

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
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/health":
            model = read_selected_model()
            ready = bool(model) and os.path.isfile(find_handy_exe()) if True else False
            try:
                find_handy_exe()
                ready = bool(model)
            except Exception:
                ready = False
            self._send_json(200, {"status": "ok" if ready else "degraded", "model": model})
            return
        if path == "/v1/models":
            model = read_selected_model()
            self._send_json(200, {"data": [{"id": model or "handy-local"}]})
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

            model_id = read_selected_model()
            if not model_id:
                self._send_json(500, {"error": "No model selected in Handy. Open Handy and pick a model."})
                return

            wav = extract_multipart(body, content_type)
            if not wav:
                self._send_json(400, {"error": "No audio file field in the request"})
                return

            fd, tmp = tempfile.mkstemp(suffix=".wav")
            try:
                with os.fdopen(fd, "wb") as f:
                    f.write(wav)
                log(f"Transcribing {len(wav)} bytes with model {model_id}")
                text = transcribe_wav(tmp, model_id)

                # If Handy (GPU) failed - fall back to LOCAL offline whisper (CPU).
                # No cloud, no API keys, no 429 rate limits.
                if not text:
                    log("Handy GPU returned empty - trying local offline whisper...")
                    text = transcribe_local_whisper(tmp)
            finally:
                try:
                    os.remove(tmp)
                except Exception:
                    pass

            if not text:
                self._send_json(500, {"error": "Handy returned an empty transcription"})
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
        content = part[head_end + 4 :]
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

    server = ThreadingHTTPServer((HOST, PORT), STTHandler)
    log(f"Listening on http://{HOST}:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
