use std::io::{Read, Write};
use std::net::TcpStream;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

pub static STT_SERVER: Mutex<Option<Child>> = Mutex::new(None);

const PORT: &str = "127.0.0.1:8000";

fn is_running() -> bool {
    TcpStream::connect_timeout(&PORT.parse().unwrap(), Duration::from_millis(400)).is_ok()
}

/// Locate a usable python interpreter.
fn find_python() -> Option<String> {
    let candidates = [
        "python",
        "python3",
        r"C:\Python312\python.exe",
        r"C:\Python311\python.exe",
        r"C:\Python310\python.exe",
        r"C:\Program Files\Python312\python.exe",
        r"C:\Program Files\Python311\python.exe",
        r"C:\Program Files\Python310\python.exe",
        r"C:\Users\Administrator\AppData\Local\Programs\Python\Python312\python.exe",
    ];
    candidates
        .iter()
        .find(|c| Command::new(c).arg("--version").output().map(|o| o.status.success()).unwrap_or(false))
        .map(|s| s.to_string())
}

/// Locate the bundled script (dev tree or installed bundle).
fn find_script() -> Option<String> {
    let manifest = env!("CARGO_MANIFEST_DIR");
    let mut candidates = vec![
        format!("{}/../scripts/handy_stt_server.py", manifest),
        format!("{}/scripts/handy_stt_server.py", manifest),
        format!("{}/resources/handy_stt_server.py", manifest),
    ];
    // Installed bundle: look next to the running executable.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(format!("{}/resources/handy_stt_server.py", dir.display()));
            candidates.push(format!("{}/handy_stt_server.py", dir.display()));
            candidates.push(format!("{}/_up_/scripts/handy_stt_server.py", dir.display()));
            candidates.push(format!("{}/scripts/handy_stt_server.py", dir.display()));
        }
    }
    candidates
        .into_iter()
        .find(|p| std::path::Path::new(p).is_file())
}

/// Start the local Handy STT server if it isn't already running.
pub fn ensure_server_running() {
    if is_running() {
        return;
    }

    let Some(python) = find_python() else {
        eprintln!("handy_server: python not found, skipping");
        return;
    };
    let Some(script) = find_script() else {
        eprintln!("handy_server: script not found, skipping");
        return;
    };

    #[cfg(target_os = "windows")]
    let spawn = {
        let mut cmd = Command::new(python);
        cmd.arg(&script)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(0x08000000); // CREATE_NO_WINDOW
        cmd.spawn()
    };

    #[cfg(not(target_os = "windows"))]
    let spawn = Command::new(python).arg(&script).stdout(Stdio::null()).stderr(Stdio::null()).spawn();

    match spawn {
        Ok(child) => {
            eprintln!("[tauri] Handy STT server started (pid {})", child.id());
            if let Ok(mut guard) = STT_SERVER.lock() {
                *guard = Some(child);
            }
        }
        Err(e) => eprintln!("[tauri] failed to start Handy STT server: {}", e),
    }
}

/// Stop the server child process (called on app exit).
pub fn stop_server() {
    if let Ok(mut guard) = STT_SERVER.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// Status for the frontend.
#[tauri::command]
pub fn handy_server_status() -> bool {
    is_running()
}

/// Detailed status for the frontend: whether the server is up plus the
/// currently selected Handy model (read from the server /health endpoint).
#[tauri::command]
pub fn handy_server_status_detailed() -> serde_json::Value {
    if !is_running() {
        return serde_json::json!({ "online": false, "model": "" });
    }
    // Ask the python server for the selected model via /health.
    let model = TcpStream::connect_timeout(&PORT.parse().unwrap(), Duration::from_millis(400))
        .ok()
        .and_then(|mut stream| {
            let _ = stream.set_read_timeout(Some(Duration::from_millis(600)));
            let _ = stream.write_all(
                b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
            );
            let _ = stream.flush();
            let mut buf = Vec::new();
            let _ = stream.read_to_end(&mut buf);
            let text = String::from_utf8_lossy(&buf);
            // Extract the JSON body after the blank line
            let body = text.split("\r\n\r\n").nth(1).unwrap_or("");
            let v: serde_json::Value = serde_json::from_str(body).ok()?;
            v.get("model").and_then(|m| m.as_str()).map(|s| s.to_string())
        })
        .unwrap_or_default();
    serde_json::json!({ "online": true, "model": model })
}

/// Start the server on demand (frontend can call this too).
#[tauri::command]
pub fn start_handy_server() -> bool {
    ensure_server_running();
    is_running()
}

/// Speak text aloud using Windows SAPI (fallback for WebView2 which may not
/// expose the Web Speech API). Uses a single long-lived PowerShell process
/// that reads lines from stdin - avoids the ~300-500ms process spawn per phrase.
pub static TTS_PROCESS: Mutex<Option<(Child, Option<std::process::ChildStdin>)>> =
    Mutex::new(None);

#[tauri::command]
pub fn speak_text(text: String) {
    #[cfg(target_os = "windows")]
    {
        let script = r#"
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SetOutputToDefaultAudioDevice()
while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    if ($line -eq "__QUIT__") { break }
    try { $s.Speak($line) } catch {}
}
$s.Dispose()
"#;

        let mut guard = match TTS_PROCESS.lock() {
            Ok(g) => g,
            Err(_) => return,
        };

        // (Re)spawn the persistent process if it died.
        if guard.is_none() {
            let mut cmd = Command::new("powershell");
            cmd.args(["-NoProfile", "-WindowStyle", "Hidden", "-Command", script])
                .stdin(Stdio::piped())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .creation_flags(0x08000000); // CREATE_NO_WINDOW
            if let Ok(mut child) = cmd.spawn() {
                let stdin = child.stdin.take();
                *guard = Some((child, stdin));
            } else {
                return;
            }
        }

        if let Some((child, stdin)) = guard.as_mut() {
            if let Some(stdin) = stdin.as_mut() {
                let _ = writeln!(stdin, "{}", text.replace('\n', " ").replace('\r', " "));
                let _ = stdin.flush();
            } else if let Some(mut stdin) = child.stdin.take() {
                let _ = writeln!(stdin, "{}", text.replace('\n', " ").replace('\r', " "));
                let _ = stdin.flush();
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = text;
    }
}

/// Kill the persistent TTS process (called on app exit).
pub fn stop_tts() {
    if let Ok(mut guard) = TTS_PROCESS.lock() {
        if let Some((mut child, mut stdin)) = guard.take() {
            if let Some(stdin) = stdin.as_mut() {
                let _ = writeln!(stdin, "__QUIT__");
                let _ = stdin.flush();
            }
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
