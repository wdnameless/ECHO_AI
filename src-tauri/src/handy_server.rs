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

/// Start the server on demand (frontend can call this too).
#[tauri::command]
pub fn start_handy_server() -> bool {
    ensure_server_running();
    is_running()
}

/// Speak text aloud using Windows SAPI (fallback for WebView2 which may not
/// expose the Web Speech API). Fire-and-forget.
#[tauri::command]
pub fn speak_text(text: String) {
    let script = format!(
        "Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SetOutputToDefaultAudioDevice(); $s.Speak($args[0]); $s.Dispose()",
    );
    let _ = Command::new("powershell")
        .args(["-NoProfile", "-WindowStyle", "Hidden", "-Command", &script, "-", &text])
        .spawn();
}
