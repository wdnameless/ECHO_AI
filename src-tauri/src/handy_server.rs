use std::io::{Read, Write};
use std::net::TcpStream;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;

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
/// The user's chosen directories come first: the engine may live in a portable
/// root, on another drive, or in a folder extracted by hand. The bundled and
/// install-relative locations stay as fallbacks so an existing install keeps
/// working without any configuration.
fn find_pluely_asr() -> Option<String> {
    let mut candidates: Vec<String> = Vec::new();

    // 1. Engine embedded in the binary: extracted on first use, so a build that
    //    ships as a single file still has a working recogniser.
    let paths = crate::settings::resolved_paths();
    match crate::embedded::ensure_extracted(&paths) {
        Ok(Some(dir)) => {
            crate::embedded::cleanup_old_extractions(&paths);
            candidates.push(
                crate::embedded::engine_binary(&dir)
                    .to_string_lossy()
                    .to_string(),
            );
        }
        Ok(None) => {}
        Err(e) => eprintln!("[tauri] не удалось распаковать движок: {e}"),
    }

    // 2. Explicit user layout: <engine_dir>/pluely-asr.exe and portable roots.
    candidates.push(format!("{}/pluely-asr.exe", paths.engine_dir));
    candidates.push(format!("{}/resources/pluely-asr.exe", paths.root));
    candidates.push(format!("{}/pluely-asr.exe", paths.root));

    // 3. Install-relative locations (portable archive and installed bundle).
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(format!("{}/resources/pluely-asr.exe", dir.display()));
            candidates.push(format!("{}/pluely-asr.exe", dir.display()));
        }
    }

    // 4. Development build: source-tree resources and the sibling crate.
    if let Ok(manifest) = std::env::var("CARGO_MANIFEST_DIR") {
        candidates.push(format!("{}/resources/pluely-asr.exe", manifest));
        candidates.push(format!(
            "{}/../../pluely-asr/target/release/pluely-asr.exe",
            manifest
        ));
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

/// Model file names shipped by older builds, checked only in an installed
/// layout so a pre-existing install keeps recognising speech after upgrading.
const MODEL_FILE_CANDIDATES: &[&str] = &["nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf"];

/// Locate the ASR model file.
///
/// Order: the model the user explicitly selected, then any `.gguf` in their
/// models directory, then the historical bundled/install-relative locations so
/// an install that still carries the embedded model keeps working.
fn find_model_path() -> Option<String> {
    let settings = crate::settings::load_settings();
    let paths = crate::settings::resolve(&settings);

    // 1. Explicit selection wins: the user asked for this exact file.
    if let Some(selected) = settings.selected_model.as_deref() {
        let candidate = std::path::Path::new(selected);
        if candidate.is_file() {
            return Some(selected.to_string());
        }
        eprintln!(
            "[tauri] выбранная модель недоступна ({}), ищу другую",
            selected
        );
    }

    // 2. Any GGUF the user placed in the models directory.
    if let Some(found) = first_gguf_in(std::path::Path::new(&paths.models_dir)) {
        return Some(found);
    }

    // 3. Bundled model, for installs built before models became a user choice.
    //    Deliberately no source-tree candidate: the model is no longer bundled,
    //    and reading it from a build tree would let a stale leftover silently
    //    become the active model on a developer machine.
    let mut candidates: Vec<String> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let installed_layout = dir.join("resources").is_dir();
            if installed_layout {
                for name in MODEL_FILE_CANDIDATES {
                    candidates.push(format!("{}/resources/{name}", dir.display()));
                    candidates.push(format!("{}/{name}", dir.display()));
                    candidates.push(format!("{}/models/{name}", dir.display()));
                }
            }
        }
    }
    if let Some(found) = candidates
        .into_iter()
        .find(|p| std::path::Path::new(p).is_file())
    {
        return Some(found);
    }

    // 4. Last resort: any GGUF shipped alongside the executable.
    let mut scan_dirs: Vec<std::path::PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            if dir.join("resources").is_dir() {
                scan_dirs.push(dir.join("resources"));
                scan_dirs.push(dir.to_path_buf());
                scan_dirs.push(dir.join("models"));
            }
        }
    }
    for dir in scan_dirs {
        if let Some(found) = first_gguf_in(&dir) {
            return Some(found);
        }
    }

    None
}

/// First `.gguf` file inside a directory, if the directory exists.
fn first_gguf_in(dir: &std::path::Path) -> Option<String> {
    let entries = std::fs::read_dir(dir).ok()?;
    let mut candidates: Vec<std::path::PathBuf> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("gguf"))
        })
        .collect();
    // Deterministic pick, so two runs do not load different models.
    candidates.sort();
    candidates
        .first()
        .map(|path| path.to_string_lossy().to_string())
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
/// Location: the user's chosen log directory first, then exe dir (portable and
/// installed layouts), then the app data directory.
fn open_sidecar_log_file() -> std::fs::File {
    use std::fs::OpenOptions;
    let mut paths: Vec<std::path::PathBuf> = Vec::new();

    let logs_dir = crate::settings::resolved_paths().logs_dir;
    paths.push(std::path::Path::new(&logs_dir).join("asr-sidecar.log"));

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            paths.push(dir.join("asr-sidecar.log"));
            paths.push(dir.join("resources").join("asr-sidecar.log"));
        }
    }
    if let Ok(appdata) = std::env::var("APPDATA") {
        let dir = std::path::Path::new(&appdata).join("com.srikanthnani.pluely");
        paths.push(dir.join("asr-sidecar.log"));
    }
    for p in &paths {
        if let Ok(f) = OpenOptions::new().create(true).append(true).open(p) {
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
    // Без модели движок не запустится: раньше здесь молча подставлялся путь
    // к машине разработчика, из-за чего на чужой системе движок падал с
    // невнятной ошибкой вместо честного отказа.
    let Some(model_path) = find_model_path() else {
        eprintln!("[tauri] pluely-asr: model not found, skipping native ASR");
        return false;
    };

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
                "[tauri] Echo AI ASR native GPU server started (pid {})",
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
    // The engine keeps the model in memory, so a model switch only takes effect
    // after the process actually exits. Without waiting for the port to free up,
    // the restart would race the old instance and bind a different port.
    wait_for_shutdown(Duration::from_secs(8));
}

/// Waits until the ASR port stops responding, up to `timeout`.
fn wait_for_shutdown(timeout: Duration) {
    let deadline = std::time::Instant::now() + timeout;
    while std::time::Instant::now() < deadline {
        if !is_running() {
            return;
        }
        std::thread::sleep(Duration::from_millis(150));
    }
}

/// Restarts the ASR engine so it picks up the currently configured model.
///
/// Used after the user selects a different model: the engine reads the file
/// once at startup, so without this the switch would appear to do nothing.
pub async fn restart_server() -> Result<(), String> {
    stop_server();

    let started = tauri::async_runtime::spawn_blocking(|| {
        // Give the OS a moment to release the port before rebinding.
        std::thread::sleep(Duration::from_millis(400));
        spawn_pluely_asr()
    })
    .await
    .unwrap_or(false);

    if !started {
        return Err(
            "движок распознавания не запустился. Проверьте, что модель скачана, \
             а каталог движка указан верно."
                .to_string(),
        );
    }

    start_sidecar_watchdog();
    Ok(())
}

/// Whether speech recognition can actually run right now.
#[derive(Debug, Clone, Serialize)]
pub struct SttReadiness {
    /// An engine process is answering on its port.
    pub engine_running: bool,
    /// A model file was resolved.
    pub model_found: bool,
    /// Path of the model that would be loaded, when one was found.
    pub model_path: Option<String>,
    /// The resolved models directory, so the UI can point the user at it.
    pub models_dir: String,
    /// Why recognition is unavailable, when it is.
    pub reason: Option<String>,
}

/// Reports why recognition is or is not available.
///
/// The app can now start with no model at all — that is the point of a portable
/// build — so the UI needs a first-class way to tell the user what is missing
/// instead of showing a silent "offline" badge.
#[tauri::command]
pub fn stt_readiness() -> SttReadiness {
    let paths = crate::settings::resolved_paths();
    let model_path = find_model_path();
    let engine_running = is_running();

    let reason = match (&model_path, engine_running) {
        (Some(_), true) => None,
        (None, _) => Some(
            "Модель распознавания не найдена. Откройте «Настройки → Хранилище и модели» и скачайте подходящую."
                .to_string(),
        ),
        (Some(_), false) => Some(
            "Движок распознавания не запущен. Проверьте каталог движка в настройках хранилища."
                .to_string(),
        ),
    };

    SttReadiness {
        engine_running,
        model_found: model_path.is_some(),
        model_path,
        models_dir: paths.models_dir,
        reason,
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
