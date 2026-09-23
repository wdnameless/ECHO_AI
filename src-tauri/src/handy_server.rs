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

/// Default port of the native engine, and the range it rebounds into when the
/// default one is taken.
const ENGINE_PORT: u16 = 9877;
const ENGINE_PORT_RANGE: std::ops::RangeInclusive<u16> = ENGINE_PORT..=9882;

/// Health of a loopback ASR service, as JSON.
///
/// An accepted TCP connection is not evidence of a working engine: any service
/// can own a port. The engine answers `{"status": "ok", ...}` on `/health`,
/// so that is what liveness means here.
fn health_body(port: u16) -> Option<serde_json::Value> {
    let addr: std::net::SocketAddr = format!("127.0.0.1:{port}").parse().ok()?;
    // Cheap gate first: a closed port costs one failed connect, not a request.
    TcpStream::connect_timeout(&addr, Duration::from_millis(150)).ok()?;

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_millis(700))
        .build()
        .ok()?;
    let body = client
        .get(format!("http://127.0.0.1:{port}/health"))
        .send()
        .ok()?
        .text()
        .ok()?;
    let value: serde_json::Value = serde_json::from_str(&body).ok()?;
    (value.get("status").and_then(|s| s.as_str()) == Some("ok")).then_some(value)
}

/// Port the native engine is serving on, if it is.
/// First port in the engine's range that nothing is listening on.
///
/// The engine used to be started on the default port unconditionally: with that
/// port already taken it died on startup and stayed offline until the other
/// process went away.
fn free_engine_port() -> Option<u16> {
    ENGINE_PORT_RANGE.into_iter().find(|port| !port_is_taken(*port))
}

fn port_is_taken(port: u16) -> bool {
    let Ok(addr) = format!("127.0.0.1:{port}").parse::<std::net::SocketAddr>() else {
        return false;
    };
    std::net::TcpStream::connect_timeout(&addr, Duration::from_millis(150)).is_ok()
}

fn native_engine_port() -> Option<u16> {
    let mut candidates: Vec<u16> = Vec::new();
    if let Some(port) = read_bound_asr_port() {
        candidates.push(port);
    }
    candidates.extend(ENGINE_PORT_RANGE);
    candidates
        .into_iter()
        .find(|port| health_body(*port).is_some())
}

/// Port the native engine is serving on. The renderer resolves its base URL
/// from this same answer, so both sides agree on where speech is sent.
pub fn serving_port() -> Option<u16> {
    native_engine_port()
}

fn is_running() -> bool {
    serving_port().is_some()
}

/// Read the port recorded in the asr-port file next to any known sidecar
/// location. Prefer the freshest mtime when several exist.
fn read_bound_asr_port() -> Option<u16> {
    let mut paths: Vec<std::path::PathBuf> = Vec::new();
    let resolved = crate::settings::resolved_paths();
    paths.push(std::path::PathBuf::from(&resolved.root).join("asr-port"));
    paths.push(std::path::PathBuf::from(&resolved.engine_dir).join("asr-port"));
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            paths.push(dir.join("asr-port"));
            paths.push(dir.join("resources").join("asr-port"));
            paths.push(dir.join(".echo-ai").join("asr-port"));
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
        if freshest.as_ref().is_none_or(|(cur, _)| ts > *cur) {
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


/// Records the child that owns the STT port, retiring whatever it replaces.
///
/// The replaced child is killed: only one server may serve, and a replaced one
/// would otherwise survive as an orphan holding its port. That is exactly how a
/// fallback python server ended up squatting on the legacy port long after the
/// engine had taken over, which made every later launch believe recognition was
/// already running.
fn track_server(child: Child) -> bool {
    if let Ok(mut guard) = STT_SERVER.lock() {
        if let Some(mut old) = guard.replace(child) {
            let _ = old.kill();
            let _ = old.wait();
        }
    }
    true
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
    let resolved = crate::settings::resolved_paths();
    #[cfg(target_os = "windows")]
    let spawn = {
        let port = free_engine_port().unwrap_or(ENGINE_PORT);
        let _ = std::fs::write(std::path::PathBuf::from(&resolved.root).join("asr-port"), port.to_string());
        let mut cmd = Command::new(&asr_bin);
        cmd.current_dir(&resolved.engine_dir);
        cmd.arg("--model")
            .arg(&model_path)
            .arg("--port")
            .arg(port.to_string())
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
            track_server(child)
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
            // Watch the engine, not "some ASR service": with the fallback
            // serving, a dead engine would otherwise look healthy forever. With
            // no model there is nothing to start, so staying quiet is correct.
            if native_engine_port().is_some() || find_model_path().is_none() {
                continue;
            }
            eprintln!("[tauri] watchdog: ASR engine is down, restarting...");
            if spawn_pluely_asr() {
                // Give the model a moment to load before next check.
                std::thread::sleep(Duration::from_secs(8));
            }
        }
    });
}

/// Start the local Handy STT server if it isn't already running.
pub fn ensure_server_running() {
    if native_engine_port().is_some() {
        start_sidecar_watchdog();
        return;
    }

    // Try starting the native pluely-asr GPU microservice first if available
    if spawn_pluely_asr() {
        start_sidecar_watchdog();
        return;
    }

    start_sidecar_watchdog();
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

/// Waits until the engine port stops responding, up to `timeout`.
///
/// Waits on the engine to shut down.
fn wait_for_shutdown(timeout: Duration) {
    let deadline = std::time::Instant::now() + timeout;
    while std::time::Instant::now() < deadline {
        if native_engine_port().is_none() {
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
pub async fn stt_readiness() -> SttReadiness {
    // `is_running` probes real sockets with a timeout, and a synchronous command
    // runs on the main thread: the window froze for up to a second every time the
    // speech panel asked. Same answer, off the UI thread.
    tauri::async_runtime::spawn_blocking(stt_readiness_blocking)
        .await
        .unwrap_or_else(|_| stt_readiness_blocking())
}

fn stt_readiness_blocking() -> SttReadiness {
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
pub async fn handy_server_status() -> bool {
    tauri::async_runtime::spawn_blocking(is_running)
        .await
        .unwrap_or(false)
}

/// Detailed status for the frontend: whether the service that the renderer will
/// actually use is up, plus the model it reports on `/health`.
#[tauri::command]
pub async fn handy_server_status_detailed() -> serde_json::Value {
    // Polled by the renderer; each call walks the port range with a timeout per
    // port, so it must not sit on the main thread.
    tauri::async_runtime::spawn_blocking(handy_server_status_detailed_blocking)
        .await
        .unwrap_or_else(|_| serde_json::json!({ "online": false, "model": "" }))
}

fn handy_server_status_detailed_blocking() -> serde_json::Value {
    let Some(port) = serving_port() else {
        return serde_json::json!({ "online": false, "model": "" });
    };
    // Extract the model name from the health payload.
    let model = health_body(port)
        .and_then(|v| match v.get("model") {
            Some(serde_json::Value::String(s)) => Some(s.clone()),
            Some(serde_json::Value::Object(o)) => {
                o.get("variant").and_then(|x| x.as_str()).map(str::to_string)
            }
            _ => None,
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

/// Port the ASR service is serving on right now, for the renderer to build its
/// base URL.
#[tauri::command]
pub async fn live_asr_port() -> Option<u16> {
    // Probing real sockets on the transcription hot path, so keep it off the
    // main thread.
    tauri::async_runtime::spawn_blocking(serving_port)
        .await
        .ok()
        .flatten()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read as _;
    use std::io::Write as _;
    use std::net::TcpListener;

    /// A loopback listener on an ephemeral port, plus the port it took.
    fn ephemeral_listener() -> (TcpListener, u16) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind loopback");
        let port = listener.local_addr().expect("local addr").port();
        (listener, port)
    }

    #[test]
    fn a_taken_engine_port_is_skipped() {
        // The engine used to be spawned on the default port unconditionally and
        // died on startup when something else held it, leaving speech offline.
        let (listener, taken) = ephemeral_listener();
        assert!(port_is_taken(taken), "the listener must look taken to the probe");

        // Whatever port comes back must not be the one already in use.
        let chosen = free_engine_port();
        assert_ne!(chosen, Some(taken), "a busy port came back as free");
        drop(listener);
        assert!(!port_is_taken(taken), "a released port must probe free again");
    }

    /// Serves canned HTTP responses on an ephemeral port, one per connection,
    /// for as long as the test process lives.
    fn serve(responder: impl Fn() -> String + Send + 'static) -> u16 {
        let (listener, port) = ephemeral_listener();
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let mut stream = stream;
                let mut buf = [0u8; 2048];
                let _ = stream.read(&mut buf); // request line is irrelevant here
                let _ = stream.write_all(responder().as_bytes());
            }
        });
        port
    }

    fn http_ok(body: &str) -> String {
        format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        )
    }

    /// The bug this guards: any service owning the port counted as a healthy
    /// engine. The app then reported recognition as ready, never started the
    /// engine, and the renderer posted into a port nothing served.
    #[test]
    fn a_listener_that_is_not_an_engine_is_not_healthy() {
        // Answers HTTP 200 with valid JSON, like a plain web service would.
        let port = serve(|| http_ok(r#"{"hello":"world"}"#));
        assert!(health_body(port).is_none());
    }

    #[test]
    fn a_listener_that_never_answers_is_not_healthy() {
        let (listener, port) = ephemeral_listener();
        std::thread::spawn(move || {
            // Accept and stay silent: the request must time out, not hang forever.
            if let Ok((_stream, _)) = listener.accept() {
                std::thread::sleep(Duration::from_secs(3));
            }
        });
        assert!(health_body(port).is_none());
    }

    #[test]
    fn the_native_engine_health_payload_is_healthy() {
        let port = serve(|| http_ok(r#"{"status":"ok","model":{"variant":"nemotron"}}"#));
        let body = health_body(port).expect("engine payload must be recognised");
        assert_eq!(
            body.get("model")
                .and_then(|m| m.get("variant"))
                .and_then(|v| v.as_str()),
            Some("nemotron")
        );
    }

    #[test]
    fn string_model_health_payload_is_healthy() {
        let port = serve(|| {
            http_ok(r#"{"status": "ok", "model": "small", "error": null}"#)
        });
        let body = health_body(port).expect("health payload must be recognised");
        assert_eq!(body.get("model").and_then(|m| m.as_str()), Some("small"));
    }
}
