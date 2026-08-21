"""
Automated test: GPU (Handy) failure -> local openai-whisper fallback.

Verifies:
  1. When the GPU transcription returns an empty result (simulated failure),
     the in-server fallback calls the local CPU openai-whisper model.
  2. The local whisper model is cached (loaded only once) - repeated calls
     do NOT reload it (session is preserved).
  3. The HTTP server keeps serving subsequent requests after the fallback
     (no session loss / no crash).

Run:  python scripts/test_gpu_fallback.py
"""

import importlib.util
import json
import os
import sys
import tempfile
import threading
import time
import urllib.request
import wave
import struct

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SERVER_PATH = os.path.join(SCRIPT_DIR, "handy_stt_server.py")

RESULTS = {"passed": 0, "failed": 0}

def check(name, condition, detail=""):
    if condition:
        RESULTS["passed"] += 1
        print(f"  PASS  {name}" + (f"  ({detail})" if detail else ""))
    else:
        RESULTS["failed"] += 1
        print(f"  FAIL  {name}" + (f"  ({detail})" if detail else ""))

# ---------------------------------------------------------------------------
# Load the server module without running main()
# ---------------------------------------------------------------------------
spec = importlib.util.spec_from_file_location("handy_stt_server", SERVER_PATH)
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)  # executes module code (main() guarded by __main__)

_orig_main = server.main

def _fake_main():
    return None

server.main = _fake_main

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_test_wav(path, seconds=1.2, freq=440.0):
    """Generate a simple tone WAV - enough for whisper to process."""
    rate = 16000
    n = int(rate * seconds)
    with wave.open(path, "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        frames = b"".join(
            int(0.15 * 32767 * (0.6 + 0.4 * ((i // 400) % 2)))  # alternating amplitude
            .to_bytes(2, "little", signed=True)
            for i in range(n)
        )
        w.writeframes(frames)


def start_server(port):
    server._whisper_model = None  # reset cache between runs
    srv = server.ThreadingHTTPServer(("127.0.0.1", port), server.STTHandler)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    return srv


def stop_server(srv):
    srv.shutdown()
    srv.server_close()


def transcribe_http(port, wav_path):
    """POST a wav to the running server, return (status_code, json_obj)."""
    boundary = "----PluelyTestBoundary"
    with open(wav_path, "rb") as f:
        audio = f.read()
    body = (
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="file"; filename="test.wav"\r\n'
        "Content-Type: audio/wav\r\n\r\n"
    ).encode() + audio + f"\r\n--{boundary}--\r\n".encode()

    req = urllib.request.Request(
        f"http://127.0.0.1:{port}/v1/audio/transcriptions",
        data=body,
        method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return resp.status, json.loads(resp.read().decode())


# ---------------------------------------------------------------------------
# Test 1: GPU fails -> local whisper used (direct function call)
# ---------------------------------------------------------------------------
print("\n[1] Direct fallback chain (GPU empty result -> local whisper)")
wav_path = os.path.join(tempfile.gettempdir(), "pluely_fallback_test.wav")
make_test_wav(wav_path)

original_gpu = server.transcribe_wav
gpu_calls = {"n": 0}

def fake_gpu_fail(wav, model):
    """Simulate GPU failure: logs and returns empty (like handy.exe crash)."""
    gpu_calls["n"] += 1
    server.log("TEST: simulated GPU failure (returned empty)")
    return ""

server.transcribe_wav = fake_gpu_fail

loaded_count = {"n": 0}
original_load = server.whisper.load_model if hasattr(server, "whisper") else None

# Patch whisper.load_model to count loads (ensures single-load caching)
import whisper as _whisper

orig_whisper_load = _whisper.load_model
def counting_load(name, *a, **k):
    loaded_count["n"] += 1
    return orig_whisper_load(name, *a, **k)

_whisper.load_model = counting_load
server.whisper = _whisper

try:
    # Simulate the server's REAL fallback chain (mirrors STTHandler.do_POST):
    # 1. GPU (transcribe_wav) returns empty -> simulated failure
    # 2. fallback: local whisper (CPU) transcribes
    gpu_result = server.transcribe_wav(wav_path, "test-model")
    check("GPU function was called (failure simulated)", gpu_calls["n"] == 1)
    check("GPU returned empty (simulated crash)", gpu_result == "")

    text1 = server.transcribe_local_whisper(wav_path)
    check("local whisper returned text (no exception)", isinstance(text1, str))

    # Second call must reuse the cached model (session preserved)
    text2 = server.transcribe_local_whisper(wav_path)
    check(
        "whisper model loaded exactly once (cache/session preserved)",
        loaded_count["n"] == 1,
        f"loads={loaded_count['n']}",
    )
    check("second call also returned text", isinstance(text2, str))
finally:
    server.transcribe_wav = original_gpu
    _whisper.load_model = orig_whisper_load

# ---------------------------------------------------------------------------
# TEST 2: HTTP server continues after fallback (no session loss)
# ---------------------------------------------------------------------------
print("\n[2] HTTP server survives GPU failure + fallback")

port = 8123
srv = start_server(port)

# Make GPU fail on the FIRST request only, then recover on the second.
server.transcribe_wav = fake_gpu_fail
server.transcribe_local_whisper = lambda p: (server.log("TEST: local whisper"), "fallback text")[1]

try:
    status, body = transcribe_http(port, wav_path)
    check("first request (GPU failed) returned 200", status == 200, f"status={status}")
    check(
        "first response text came from local fallback",
        body.get("text") == "fallback text",
        f"text={body.get('text')!r}",
    )
except Exception as e:
    check("first request (GPU failed) returned 200", False, str(e))

# Now restore GPU behavior - server must keep working (session alive).
def fake_gpu_recovered(wav_path_arg, model_id):
    server.log("TEST: GPU recovered")
    return "gpu recovered text"

server.transcribe_wav = fake_gpu_recovered
server.transcribe_local_whisper = lambda t: "fallback text"

try:
    status2, body2 = transcribe_http(port, wav_path)
    check("second request after GPU recovery returned 200", status2 == 200, f"status={status2}")
    check(
        "second response came from recovered GPU (session intact)",
        body2.get("text") == "gpu recovered text",
        f"text={body2.get('text')!r}",
    )
except Exception as e:
    check("second request after GPU recovery returned 200", False, str(e))

stop_server(srv)

# ---------------------------------------------------------------------------
# TEST 3: both GPU paths fail -> server returns clear 500 error (no crash)
# ---------------------------------------------------------------------------
print("\n[3] Total local failure returns graceful 500 (server stays alive)")

srv = start_server(8766)
server.transcribe_wav = fake_gpu_fail
server.transcribe_local_whisper = lambda t: ""

try:
    try:
        transcribe_http(port := 8766, wav_path)
        check("server does not crash when all local models fail", False)
    except Exception as e:
        # urllib raises HTTPError for non-2xx; verify it's a 500, not a crash
        from urllib.error import HTTPError
        if isinstance(e, HTTPError) and e.code == 500:
            check("server does not crash when all local models fail", True, "HTTP 500")
        else:
            check("server does not crash when all local models fail", False, str(e))

    # Server must still answer /health afterwards (process alive)
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{8766}/health", timeout=5) as r:
            check("server still healthy after total failure", r.status == 200, f"status={r.status}")
    except Exception as e:
        check("server still healthy after total failure", False, str(e))
finally:
    stop_server(srv)

# ---------------------------------------------------------------------------
print("\n==============================================")
print(f"RESULTS: {RESULTS['passed']} passed, {RESULTS['failed']} failed")
print("==============================================")
sys.exit(1 if RESULTS["failed"] else 0)
