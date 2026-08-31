use std::io::{Read, Write};
use std::net::TcpStream;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
use windows::Win32::System::JobObjects::{CreateJobObjectW, SetInformationJobObject, AssignProcessToJobObject, JobObjectExtendedLimitInformation, JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE};
#[cfg(target_os = "windows")]
use windows::Win32::Foundation::{CloseHandle, HANDLE};
#[cfg(target_os = "windows")]
use windows::Win32::System::Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE};

#[cfg(target_os = "windows")]
struct SendHandle(#[allow(dead_code)] HANDLE);
#[cfg(target_os = "windows")]
unsafe impl Send for SendHandle {}
#[cfg(target_os = "windows")]
unsafe impl Sync for SendHandle {}

#[cfg(target_os = "windows")]
static JOB_OBJECT: Mutex<Option<SendHandle>> = Mutex::new(None);

pub static STT_SERVER: Mutex<Option<Child>> = Mutex::new(None);

const PORT: &str = "127.0.0.1:8000";
const ASR_PORT: &str = "127.0.0.1:9877";

fn is_running() -> bool {
    // The sidecar rebounds upward (9877..9882) when the default port is busy,
    // so a fixed-port probe would report a healthy instance as dead. Ask the
    // port file first (written next to the sidecar binary), then probe the
    // known range. The legacy python server on :8000 stays as a candidate.
    if let Some(port) = read_bound_asr_port() {
        if TcpStream::connect_timeout(
            &format!("127.0.0.1:{port}").parse().unwrap(),
            Duration::from_millis(300),
        )
        .is_ok()
        {
            return true;
        }
    }
    for port in 9877..=9882 {
        if TcpStream::connect_timeout(
            &format!("127.0.0.1:{port}").parse().unwrap(),
            Duration::from_millis(150),
        )
        .is_ok()
        {
            return true;
        }
    }
    TcpStream::connect_timeout(&PORT.parse().unwrap(), Duration::from_millis(150)).is_ok()
}

/// Read the port recorded in the asr-port file next to any known sidecar
/// location. Prefer the freshest mtime when several exist.
fn read_bound_asr_port() -> Option<u16> {
    let mut paths: Vec<std::path::PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            paths.push(dir.join("asr-port"));
            paths.push(dir.join("resources").join("asr-port"));
        }
    }
    let manifest = env!("CARGO_MANIFEST_DIR");
    paths.push(
        std::path::Path::new(&manifest)
            .join("../../pluely-asr/target/release/asr-port")
            .to_path_buf(),
    );
    let mut freshest: Option<(std::time::SystemTime, u16)> = None;
    for p in paths {
        let Ok(content) = std::fs::read_to_string(&p) else {
            continue;
        };
        let Ok(port) = content.trim().parse::<u16>() else {
            continue;
        };
        let ts = p
            .metadata()
            .and_then(|m| m.modified())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
        if freshest.as_ref().map_or(true, |(cur, _)| ts > *cur) {
            freshest = Some((ts, port));
        }
    }
    freshest.map(|(_, port)| port)
}

/// Locate a usable pluely-asr binary.
///
/// Only portable, install-relative locations are probed. A previously
/// hardcoded developer-machine path won over the bundled copy and made the
/// installed app run whatever binary happened to sit in the dev tree - a
/// different build than the one the installer shipped, which is how stale
/// watchdog logic kept returning.
fn find_pluely_asr() -> Option<String> {
    let mut candidates: Vec<String> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            // Bundled resource dir first, then exe dir (dev builds run
            // target/release -> target/release/pluely-asr.exe does not
            // exist, so bundle layouts remain authoritative).
            candidates.push(format!("{}/resources/pluely-asr.exe", dir.display()));
            candidates.push(format!("{}/pluely-asr.exe", dir.display()));
        }
    }
    if let Ok(manifest) = std::env::var("CARGO_MANIFEST_DIR") {
        // Dev build (cargo tauri dev): source-tree resources and the
        // workspace sidecar crate next to the repo.
        candidates.push(format!("{}/resources/pluely-asr.exe", manifest));
        candidates.push(format!("{}/../../pluely-asr/target/release/pluely-asr.exe", manifest));
    }
    candidates
        .into_iter()
        .find(|p| std::path::Path::new(p).is_file())
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

/// Locate the Nemotron GGUF model file.
fn find_model_path() -> Option<String> {
    let mut candidates = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(format!("{}/resources/nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf", dir.display()));
            candidates.push(format!("{}/nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf", dir.display()));
            candidates.push(format!("{}/models/nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf", dir.display()));
        }
    }
    let manifest = env!("CARGO_MANIFEST_DIR");
    candidates.push(format!("{}/resources/nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf", manifest));
    candidates.push(r"D:\WORK\Pluely fork\models\nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf".to_string());
    if let Ok(user_profile) = std::env::var("USERPROFILE") {
        candidates.push(format!(
            r"{}\.cache\huggingface\hub\models--handy-computer--nemotron-3.5-asr-streaming-0.6b-gguf\snapshots\6d44e540bc31b0de1dbe174a3cea87f53a7f22fb\nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf",
            user_profile
        ));
    }
    if let Some(found) = candidates.into_iter().find(|p| std::path::Path::new(p).is_file()) {
        return Some(found);
    }
    // Fallback: any GGUF next to the app (lets the user swap models freely).
    let mut scan_dirs = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            scan_dirs.push(dir.to_path_buf());
            scan_dirs.push(dir.join("resources"));
            scan_dirs.push(dir.join("models"));
        }
    }
    for dir in scan_dirs {
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.extension()
                    .map_or(false, |e| e.eq_ignore_ascii_case("gguf"))
                {
                    return Some(p.to_string_lossy().to_string());
                }
            }
        }
    }
    None
}

#[cfg(target_os = "windows")]
fn assign_job_object(child: &Child) {
    unsafe {
        let child_handle = match OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, child.id()) {
            Ok(h) => h,
            Err(e) => {
                eprintln!("[tauri] failed to OpenProcess for job object: {:?}", e);
                return;
            }
        };

        let job_handle = match CreateJobObjectW(None, None) {
            Ok(h) => h,
            Err(e) => {
                eprintln!("[tauri] failed to CreateJobObjectW: {:?}", e);
                let _ = CloseHandle(child_handle);
                return;
            }
        };

        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

        if let Err(e) = SetInformationJobObject(
            job_handle,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const _,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        ) {
            eprintln!("[tauri] failed to SetInformationJobObject: {:?}", e);
            let _ = CloseHandle(job_handle);
            let _ = CloseHandle(child_handle);
            return;
        }

        if let Err(e) = AssignProcessToJobObject(job_handle, child_handle) {
            eprintln!("[tauri] failed to AssignProcessToJobObject: {:?}", e);
            let _ = CloseHandle(job_handle);
            let _ = CloseHandle(child_handle);
            return;
        }

        let _ = CloseHandle(child_handle);

        if let Ok(mut guard) = JOB_OBJECT.lock() {
            *guard = Some(SendHandle(job_handle));
        }
        eprintln!("[tauri] pluely-asr assigned to Windows Job Object (kill on close enabled)");
    }
}

#[cfg(not(target_os = "windows"))]
fn assign_job_object(_child: &Child) {}

/// Open (create/append) the diagnostic log file for the sidecar.
/// Location: exe-dir first (portable + installed), then app data dir.
fn open_sidecar_log_file() -> std::fs::File {
    use std::fs::OpenOptions;
    let mut paths: Vec<std::path::PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            paths.push(dir.join("asr-sidecar.log"));
            paths.push(dir.join("resources").join("asr-sidecar.log"));
        }
    }
    if let Ok(appdata) = std::env::var("APPDATA") {
        let dir = std::path::Path::new(&appdata)
            .join("com.srikanthnani.pluely");
        paths.push(dir.join("asr-sidecar.log"));
    }
    for p in &paths {
        if let Ok(f) =
            OpenOptions::new().create(true).append(true).open(p)
        {
            return f;
        }
    }
    // Unreachable in practice; fall back to null so spawn never fails.
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(std::env::temp_dir().join("pluely-asr-sidecar.log"))
        .expect("sidecar fallback log")
}


/// Spawn the native pluely-asr sidecar. Returns true on success.
///
/// stdout/stderr go to a rotating-ish log file (asr-sidecar.log) next to the
/// log dir instead of /dev/null: transcription 500s were invisible because
/// the engine's native error never reached any surface.
fn spawn_pluely_asr() -> bool {
    let Some(asr_bin) = find_pluely_asr() else {
        return false;
    };
    let model_path = find_model_path().unwrap_or_else(|| {
        r"D:\WORK\Pluely fork\models\nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf".to_string()
    });

    let log_file = open_sidecar_log_file();

    #[cfg(target_os = "windows")]
    let spawn = {
        let mut cmd = Command::new(&asr_bin);
        cmd.arg("--model")
            .arg(&model_path)
            .arg("--port")
            .arg("9877")
            .arg("--bind")
            .arg("127.0.0.1")
            .stdout(Stdio::from(log_file.try_clone().expect("sidecar log clone")))
            .stderr(Stdio::from(log_file))
            .creation_flags(0x08000000); // CREATE_NO_WINDOW
        cmd.spawn()
    };

    #[cfg(not(target_os = "windows"))]
    let spawn = Command::new(&asr_bin)
        .arg("--model")
        .arg(&model_path)
        .arg("--port")
        .arg("9877")
        .arg("--bind")
        .arg("127.0.0.1")
        .stdout(Stdio::from(log_file.try_clone().expect("sidecar log clone")))
        .stderr(log_file)
        .spawn();

    match spawn {
        Ok(child) => {
            eprintln!(
                "[tauri] Pluely ASR native GPU server started (pid {})",
                child.id()
            );
            assign_job_object(&child);
            if let Ok(mut guard) = STT_SERVER.lock() {
                *guard = Some(child);
            }
            true
        }
        Err(e) => {
            eprintln!("[tauri] failed to spawn pluely-asr: {}", e);
            false
        }
    }
}

static WATCHDOG_STARTED: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

/// Background watchdog: if the sidecar dies (crash, OOM, driver reset),
/// bring it back automatically so recognition never silently disappears.
fn start_sidecar_watchdog() {
    if WATCHDOG_STARTED.swap(true, std::sync::atomic::Ordering::Relaxed) {
        return;
    }
    std::thread::spawn(|| {
        loop {
            std::thread::sleep(Duration::from_secs(25));
            if !is_running() {
                eprintln!("[tauri] watchdog: ASR service is down, restarting...");
                if spawn_pluely_asr() {
                    // Give the model a moment to load before next check.
                    std::thread::sleep(Duration::from_secs(8));
                }
            }
        }
    });
}

/// Start the local Handy STT server if it isn't already running.
pub fn ensure_server_running() {
    if is_running() {
        start_sidecar_watchdog();
        return;
    }

    // Try starting the native pluely-asr GPU microservice first if available
    if spawn_pluely_asr() {
        start_sidecar_watchdog();
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

/// Read the port the sidecar actually bound to (written next to its binary).
/// Returns None if the file is missing or the sidecar never started.
#[tauri::command]
pub fn read_asr_port_file() -> Option<String> {
    // Shared lookup also validates that the file parses to a real port and
    // picks the freshest file when several sidecar copies exist.
    read_bound_asr_port().map(|port| port.to_string())
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
