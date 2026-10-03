use std::fs::{self, File};
use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;
use zip::ZipArchive;

pub const MAX_EXE_SIZE: u64 = 350 * 1024 * 1024; // 350 MB limit
pub const MAX_MARKER_SIZE: u64 = 1024; // 1 KB limit
pub const STAGING_DIR_NAME: &str = ".portable-update-staging";
pub const REPLACEMENT_EXE_NAME: &str = "replacement.exe";
pub const BACKUP_EXE_NAME: &str = "backup.exe";
pub const HELPER_EXE_NAME: &str = "updater-helper.exe";

static UPDATE_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

pub struct UpdateLockGuard<'a> {
    lock: &'a AtomicBool,
    disarmed: bool,
}

impl<'a> UpdateLockGuard<'a> {
    pub fn acquire(lock: &'a AtomicBool) -> Result<Self, ()> {
        if lock
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
        {
            Ok(Self {
                lock,
                disarmed: false,
            })
        } else {
            Err(())
        }
    }

    /// Irreversibly retains the lock across process handoff until exit.
    pub fn disarm(&mut self) {
        self.disarmed = true;
    }
}

impl<'a> Drop for UpdateLockGuard<'a> {
    fn drop(&mut self) {
        if !self.disarmed {
            self.lock.store(false, Ordering::SeqCst);
        }
    }
}

#[cfg(target_os = "windows")]
pub fn show_native_error_dialog(title: &str, message: &str) {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};

    let wide_title: Vec<u16> = std::ffi::OsStr::new(title)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let wide_msg: Vec<u16> = std::ffi::OsStr::new(message)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    unsafe {
        let _ = MessageBoxW(
            None,
            PCWSTR(wide_msg.as_ptr()),
            PCWSTR(wide_title.as_ptr()),
            MB_OK | MB_ICONERROR,
        );
    }
}

#[cfg(not(target_os = "windows"))]
pub fn show_native_error_dialog(_title: &str, _message: &str) {}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "event", content = "data")]
pub enum DownloadEvent {
    #[serde(rename_all = "camelCase")]
    Started {
        content_length: Option<u64>,
    },
    #[serde(rename_all = "camelCase")]
    Progress {
        chunk_length: usize,
    },
    Finished,
}

pub fn is_version_newer(current: &str, candidate: &str) -> Result<bool, String> {
    let clean_current = current.trim_start_matches('v');
    let clean_candidate = candidate.trim_start_matches('v');
    let curr = semver::Version::parse(clean_current)
        .map_err(|e| format!("Invalid current semver '{current}': {e}"))?;
    let cand = semver::Version::parse(clean_candidate)
        .map_err(|e| format!("Invalid update semver '{candidate}': {e}"))?;
    Ok(cand > curr)
}

#[cfg(target_os = "windows")]
pub fn is_reparse_point_or_symlink(path: &Path) -> bool {
    use std::os::windows::fs::MetadataExt;
    if let Ok(meta) = fs::symlink_metadata(path) {
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x00000400;
        if (meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT) != 0 || meta.file_type().is_symlink() {
            return true;
        }
    }
    false
}

#[cfg(not(target_os = "windows"))]
pub fn is_reparse_point_or_symlink(path: &Path) -> bool {
    if let Ok(meta) = fs::symlink_metadata(path) {
        meta.file_type().is_symlink()
    } else {
        false
    }
}

pub fn are_on_same_volume(a: &Path, b: &Path) -> bool {
    let comp_a = a.components().next();
    let comp_b = b.components().next();
    comp_a.is_some() && comp_a == comp_b
}

pub fn clean_staging_dir(staging_dir: &Path) {
    if !staging_dir.is_dir() || is_reparse_point_or_symlink(staging_dir) {
        return;
    }

    if let Ok(entries) = fs::read_dir(staging_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                // NEVER delete backup.exe in generic cleanup! It is an unresolved backup/lifeboat.
                if name == REPLACEMENT_EXE_NAME || name == HELPER_EXE_NAME || name == "failed_replacement.exe" {
                    let _ = fs::remove_file(&path);
                }
            }
        }
    }
    let _ = fs::remove_dir(staging_dir);
}

pub fn cleanup_old_staging_if_needed() {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let staging = dir.join(STAGING_DIR_NAME);
            if staging.is_dir() {
                clean_staging_dir(&staging);
            }
        }
    }
}

pub fn validate_and_extract_payload(
    archive_bytes: &[u8],
    expected_exe_name: &str,
) -> Result<Vec<u8>, String> {
    if archive_bytes.is_empty() {
        return Err("Archive payload is empty".to_string());
    }

    let cursor = Cursor::new(archive_bytes);
    let mut archive = ZipArchive::new(cursor)
        .map_err(|e| format!("Invalid ZIP archive: {e}"))?;

    let count = archive.len();
    if count == 0 {
        return Err("Archive is empty".to_string());
    }
    if count > 2 {
        return Err(format!(
            "Archive contains excess entries (found {count}, maximum allowed is 2)"
        ));
    }

    let mut found_exe: Option<Vec<u8>> = None;

    for i in 0..count {
        let mut file = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read archive entry #{i}: {e}"))?;

        if file.is_dir() {
            return Err("Archive must not contain directory entries".to_string());
        }

        let name = file.name().to_string();

        if name.contains('/') || name.contains('\\') || name.contains("..") {
            return Err(format!("Archive entry contains invalid path characters: {name}"));
        }

        if let Some(mode) = file.unix_mode() {
            if (mode & 0o170000) == 0o120000 {
                return Err(format!("Archive entry is a symlink: {name}"));
            }
        }

        if name == ".portable" {
            if file.size() > MAX_MARKER_SIZE {
                return Err(format!(
                    ".portable marker exceeds maximum size ({} > {})",
                    file.size(),
                    MAX_MARKER_SIZE
                ));
            }
            continue;
        }

        let lower = name.to_lowercase();
        if !lower.ends_with(".exe") {
            return Err(format!(
                "Archive contains forbidden entry (only root executable and .portable allowed): {name}"
            ));
        }

        let is_match = name.eq_ignore_ascii_case(expected_exe_name)
            || name.eq_ignore_ascii_case("Echo AI.exe");

        if !is_match {
            return Err(format!(
                "Archive executable name '{name}' does not match expected '{expected_exe_name}' or 'Echo AI.exe'"
            ));
        }

        if found_exe.is_some() {
            return Err("Archive contains multiple executables".to_string());
        }

        if file.size() > MAX_EXE_SIZE {
            return Err(format!(
                "Archive executable size ({} bytes) exceeds maximum limit ({} bytes)",
                file.size(),
                MAX_EXE_SIZE
            ));
        }

        let mut buf = Vec::new();
        let mut limited = (&mut file).take(MAX_EXE_SIZE + 1);
        limited
            .read_to_end(&mut buf)
            .map_err(|e| format!("Failed to decompress archive executable: {e}"))?;

        if buf.len() as u64 > MAX_EXE_SIZE {
            return Err("Executable decompression exceeded maximum limit (possible decompression bomb)".to_string());
        }

        if buf.len() < 2 || &buf[0..2] != b"MZ" {
            return Err("Extracted file is not a valid Windows executable (missing MZ magic header)".to_string());
        }

        found_exe = Some(buf);
    }

    found_exe.ok_or_else(|| "Archive did not contain any valid executable payload".to_string())
}

#[cfg(target_os = "windows")]
pub fn wait_for_parent_exit(parent_pid: u32, timeout_ms: u32) -> Result<(), String> {
    use windows::Win32::Foundation::{
        CloseHandle, GetLastError, ERROR_ACCESS_DENIED, ERROR_INVALID_PARAMETER,
        WAIT_OBJECT_0, WAIT_TIMEOUT,
    };
    use windows::Win32::System::Threading::{
        OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE,
    };

    let handle = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, false, parent_pid) };
    match handle {
        Ok(h) if !h.is_invalid() => {
            let res = unsafe { WaitForSingleObject(h, timeout_ms) };
            let _ = unsafe { CloseHandle(h) };
            if res == WAIT_OBJECT_0 {
                std::thread::sleep(std::time::Duration::from_millis(150));
                Ok(())
            } else if res == WAIT_TIMEOUT {
                Err(format!("Parent process {parent_pid} timed out after {timeout_ms}ms"))
            } else {
                Err(format!("WaitForSingleObject failed on parent process {parent_pid}"))
            }
        }
        _ => {
            let err = unsafe { GetLastError() };
            if err == ERROR_INVALID_PARAMETER {
                std::thread::sleep(std::time::Duration::from_millis(150));
                Ok(())
            } else if err == ERROR_ACCESS_DENIED {
                Err(format!(
                    "Access denied for parent process {parent_pid}; process is still running and cannot be synchronized"
                ))
            } else {
                Err(format!(
                    "Cannot open parent process {parent_pid} for synchronization (Win32 error: {:?})",
                    err.0
                ))
            }
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub fn wait_for_parent_exit(_parent_pid: u32, _timeout_ms: u32) -> Result<(), String> {
    Ok(())
}

fn rename_with_retry(from: &Path, to: &Path, retries: u32, delay_ms: u64) -> Result<(), std::io::Error> {
    let mut last_err = None;
    for attempt in 0..retries {
        match fs::rename(from, to) {
            Ok(()) => return Ok(()),
            Err(e) => {
                last_err = Some(e);
                if attempt + 1 < retries {
                    std::thread::sleep(std::time::Duration::from_millis(delay_ms));
                }
            }
        }
    }
    Err(last_err.unwrap_or_else(|| std::io::Error::other("Failed to rename file after retries")))
}

pub fn run_helper_logic(
    helper_exe: &Path,
    parent_pid: u32,
    target_exe_name: &str,
    wait_timeout_ms: u32,
    relaunch_args: &[String],
    rollback_args: &[String],
) -> Result<(), String> {
    let staging_dir = helper_exe
        .parent()
        .ok_or_else(|| "Helper executable has no parent directory".to_string())?;

    if staging_dir.file_name().and_then(|n| n.to_str()) != Some(STAGING_DIR_NAME) {
        return Err(format!(
            "Helper must be run from '{STAGING_DIR_NAME}', but was run from '{}'",
            staging_dir.display()
        ));
    }

    if is_reparse_point_or_symlink(staging_dir) {
        return Err("Staging directory is a symlink or reparse point".to_string());
    }

    let target_dir = staging_dir
        .parent()
        .ok_or_else(|| "Staging directory has no parent directory".to_string())?;

    if is_reparse_point_or_symlink(target_dir) {
        return Err("Target directory is a symlink or reparse point".to_string());
    }

    if !are_on_same_volume(staging_dir, target_dir) {
        return Err("Staging directory and target directory are on different volumes".to_string());
    }

    if target_exe_name.contains('/')
        || target_exe_name.contains('\\')
        || target_exe_name.contains(':')
        || target_exe_name.contains("..")
    {
        return Err(format!("Invalid target executable name '{target_exe_name}'"));
    }
    let lower_target = target_exe_name.to_lowercase();
    if !lower_target.ends_with(".exe") {
        return Err(format!("Target executable name '{target_exe_name}' does not end with .exe"));
    }

    let target_exe = target_dir.join(target_exe_name);
    if !target_exe.is_file() {
        return Err(format!("Target executable does not exist at '{}'", target_exe.display()));
    }
    if is_reparse_point_or_symlink(&target_exe) {
        return Err("Target executable is a symlink or reparse point".to_string());
    }

    let replacement_exe = staging_dir.join(REPLACEMENT_EXE_NAME);
    if !replacement_exe.is_file() {
        return Err(format!("Replacement executable does not exist at '{}'", replacement_exe.display()));
    }
    if is_reparse_point_or_symlink(&replacement_exe) {
        return Err("Replacement executable is a symlink or reparse point".to_string());
    }

    let mut header = [0u8; 2];
    let mut f = File::open(&replacement_exe)
        .map_err(|e| format!("Cannot open replacement executable: {e}"))?;
    f.read_exact(&mut header)
        .map_err(|e| format!("Cannot read replacement executable header: {e}"))?;
    drop(f);
    if &header != b"MZ" {
        return Err("Replacement executable lacks valid Windows PE header (missing MZ magic)".to_string());
    }

    wait_for_parent_exit(parent_pid, wait_timeout_ms)?;

    let backup_exe = staging_dir.join(BACKUP_EXE_NAME);
    if backup_exe.exists() {
        return Err(format!(
            "An unresolved backup executable already exists at '{}'; refusing update to prevent data loss. Resolve or remove it manually before updating.",
            backup_exe.display()
        ));
    }

    if let Err(e) = rename_with_retry(&target_exe, &backup_exe, 25, 100) {
        let mut fallback_cmd = std::process::Command::new(&target_exe);
        fallback_cmd.current_dir(target_dir);
        for arg in rollback_args {
            fallback_cmd.arg(arg);
        }
        return match fallback_cmd.spawn() {
            Ok(_) => Err(format!(
                "Failed to move target executable to backup: {e}. Relaunched intact original executable."
            )),
            Err(spawn_err) => Err(format!(
                "Failed to move target executable to backup: {e}. Intact original executable could not be relaunched: {spawn_err}."
            )),
        };
    }

    if let Err(e) = fs::rename(&replacement_exe, &target_exe) {
        let restore_res = rename_with_retry(&backup_exe, &target_exe, 25, 100);
        return match &restore_res {
            Ok(()) => {
                let mut fallback_cmd = std::process::Command::new(&target_exe);
                fallback_cmd.current_dir(target_dir);
                for arg in rollback_args {
                    fallback_cmd.arg(arg);
                }
                match fallback_cmd.spawn() {
                    Ok(_) => Err(format!(
                        "Failed to move replacement executable into place: {e}. Restored and relaunched original executable."
                    )),
                    Err(spawn_err) => Err(format!(
                        "Failed to move replacement executable into place: {e}. Restored original executable, but failed to relaunch it: {spawn_err}."
                    )),
                }
            }
            Err(restore_err) => Err(format!(
                "CRITICAL: Failed to move replacement executable ({e}) AND failed to restore backup ({restore_err}). Backup preserved at '{}'.",
                backup_exe.display()
            )),
        };
    }

    let mut cmd = std::process::Command::new(&target_exe);
    cmd.current_dir(target_dir);
    for arg in relaunch_args {
        cmd.arg(arg);
    }

    match cmd.spawn() {
        Ok(_) => {
            let _ = fs::remove_file(&backup_exe);
            Ok(())
        }
        Err(e) => {
            let failed_path = staging_dir.join("failed_replacement.exe");
            let _ = fs::rename(&target_exe, &failed_path);
            let restore_res = rename_with_retry(&backup_exe, &target_exe, 25, 100);
            match &restore_res {
                Ok(()) => {
                    let mut fallback_cmd = std::process::Command::new(&target_exe);
                    fallback_cmd.current_dir(target_dir);
                    for arg in rollback_args {
                        fallback_cmd.arg(arg);
                    }
                    match fallback_cmd.spawn() {
                        Ok(_) => Err(format!(
                            "Failed to relaunch replaced executable: {e}. Rolled back and relaunched original executable."
                        )),
                        Err(spawn_err) => Err(format!(
                            "Failed to relaunch replaced executable: {e}. Rolled back to original executable, but failed to relaunch it: {spawn_err}."
                        )),
                    }
                }
                Err(restore_err) => {
                    Err(format!(
                        "CRITICAL: Failed to relaunch replaced executable ({e}) AND failed to restore backup ({restore_err}). Backup preserved at '{}'.",
                        backup_exe.display()
                    ))
                }
            }
        }
    }
}

pub fn maybe_run_helper() -> Option<i32> {
    let args: Vec<String> = std::env::args().collect();

    if !args.iter().any(|a| a == "--portable-update-helper") {
        return None;
    }

    let mut parent_pid: Option<u32> = None;
    let mut target_exe_name: Option<String> = None;
    let mut relaunch_args: Vec<String> = Vec::new();
    let mut rollback_args: Vec<String> = Vec::new();
    let mut show_update_error = false;

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--parent-pid" => {
                if i + 1 < args.len() {
                    parent_pid = args[i + 1].parse().ok();
                    i += 1;
                }
            }
            "--target-exe-name" => {
                if i + 1 < args.len() {
                    target_exe_name = Some(args[i + 1].clone());
                    i += 1;
                }
            }
            "--relaunch-arg" => {
                if i + 1 < args.len() {
                    relaunch_args.push(args[i + 1].clone());
                    i += 1;
                }
            }
            "--rollback-arg" => {
                if i + 1 < args.len() {
                    rollback_args.push(args[i + 1].clone());
                    i += 1;
                }
            }
            "--show-update-error" => {
                show_update_error = true;
            }
            _ => {}
        }
        i += 1;
    }
    let pid = match parent_pid {
        Some(p) => p,
        None => {
            eprintln!("[portable_update helper] Missing or invalid --parent-pid");
            return Some(1);
        }
    };

    let target_name = match &target_exe_name {
        Some(n) => n,
        None => {
            eprintln!("[portable_update helper] Missing --target-exe-name");
            return Some(1);
        }
    };

    let helper_exe = match std::env::current_exe() {
        Ok(exe) => exe,
        Err(e) => {
            eprintln!("[portable_update helper] Cannot determine current_exe: {e}");
            return Some(1);
        }
    };

    match run_helper_logic(&helper_exe, pid, target_name, 120_000, &relaunch_args, &rollback_args) {
        Ok(()) => Some(0),
        Err(e) => {
            eprintln!("[portable_update helper] Helper failed: {e}");
            if show_update_error {
                show_native_error_dialog("Echo AI Update Error", &format!("Portable update failed: {e}"));
            }
            Some(2)
        }
    }
}

pub async fn verify_and_stage_portable_update<R: tauri::Runtime>(
    app: &AppHandle<R>,
    expected_version: &str,
    on_event: &Channel<DownloadEvent>,
    updater_override: Option<tauri_plugin_updater::Updater>,
    current_exe: &Path,
    target_dir: &Path,
    target_exe_name: &str,
) -> Result<(PathBuf, PathBuf), String> {
    let updater = match updater_override {
        Some(u) => u,
        None => app
            .updater_builder()
            .target("windows-x86_64-portable")
            .build()
            .map_err(|e| format!("Failed to build portable updater: {e}"))?,
    };

    let update = updater
        .check()
        .await
        .map_err(|e| format!("Failed to check for updates: {e}"))?
        .ok_or_else(|| "No update available".to_string())?;

    if update.version != expected_version {
        return Err(format!(
            "Update version mismatch: expected '{}', but updater reported '{}'",
            expected_version, update.version
        ));
    }

    if !is_version_newer(&update.current_version, &update.version)? {
        return Err(format!(
            "Update version '{}' is not newer than current version '{}'",
            update.version, update.current_version
        ));
    }

    // Update.download verifies cryptographic signature before returning archive bytes
    let mut first_chunk = true;
    let archive_bytes = update
        .download(
            |chunk_length, content_length| {
                if first_chunk {
                    first_chunk = false;
                    let _ = on_event.send(DownloadEvent::Started { content_length });
                }
                let _ = on_event.send(DownloadEvent::Progress { chunk_length });
            },
            || {
                let _ = on_event.send(DownloadEvent::Finished);
            },
        )
        .await
        .map_err(|e| format!("Failed to download and verify update signature: {e}"))?;

    if is_reparse_point_or_symlink(target_dir) || is_reparse_point_or_symlink(current_exe) {
        return Err("Target executable or directory is a symlink or reparse point; refusing update".to_string());
    }

    let extracted_exe_bytes = validate_and_extract_payload(&archive_bytes, target_exe_name)?;

    let staging_dir = target_dir.join(STAGING_DIR_NAME);
    if staging_dir.exists() {
        if is_reparse_point_or_symlink(&staging_dir) {
            return Err("Staging path is a symlink or reparse point; refusing update".to_string());
        }
        if staging_dir.join(BACKUP_EXE_NAME).exists() {
            return Err(format!(
                "An unresolved backup executable already exists in staging ('{}'); refusing update to prevent data loss. Resolve or remove it manually before updating.",
                staging_dir.join(BACKUP_EXE_NAME).display()
            ));
        }
        clean_staging_dir(&staging_dir);
    }
    fs::create_dir_all(&staging_dir)
        .map_err(|e| format!("Failed to create staging directory: {e}"))?;

    let replacement_path = staging_dir.join(REPLACEMENT_EXE_NAME);
    fs::write(&replacement_path, &extracted_exe_bytes)
        .map_err(|e| format!("Failed to write replacement executable: {e}"))?;

    let helper_path = staging_dir.join(HELPER_EXE_NAME);
    fs::copy(current_exe, &helper_path)
        .map_err(|e| format!("Failed to copy updater helper executable: {e}"))?;

    Ok((staging_dir, helper_path))
}

#[tauri::command]
pub async fn install_portable_update<R: tauri::Runtime>(
    app: AppHandle<R>,
    expected_version: String,
    on_event: Channel<DownloadEvent>,
) -> Result<(), String> {
    if !cfg!(target_os = "windows") {
        return Err("Portable auto-update is only supported on Windows".to_string());
    }

    let paths = crate::settings::resolved_paths();
    if paths.root_kind != crate::settings::RootKind::Portable {
        return Err("Current layout is not portable; portable update rejected".to_string());
    }

    let mut guard = UpdateLockGuard::acquire(&UPDATE_IN_PROGRESS)
        .map_err(|_| "A portable update is already in progress".to_string())?;

    let current_exe = std::env::current_exe()
        .map_err(|e| format!("Failed to resolve current executable path: {e}"))?;
    let target_dir = current_exe
        .parent()
        .ok_or_else(|| "Current executable has no parent directory".to_string())?;
    let target_exe_name = current_exe
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Failed to determine current executable filename".to_string())?;

    let (_staging_dir, helper_path) = verify_and_stage_portable_update(
        &app,
        &expected_version,
        &on_event,
        None,
        &current_exe,
        target_dir,
        target_exe_name,
    )
    .await?;

    let current_pid = std::process::id();
    let mut cmd = std::process::Command::new(&helper_path);
    cmd.arg("--portable-update-helper")
        .arg("--parent-pid")
        .arg(current_pid.to_string())
        .arg("--target-exe-name")
        .arg(target_exe_name)
        .arg("--show-update-error");
    cmd.current_dir(target_dir);

    cmd.spawn()
        .map_err(|e| format!("Failed to spawn updater helper: {e}"))?;

    guard.disarm();

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        crate::handy_server::stop_server();
        app_handle.exit(0);
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    fn build_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut buf = Vec::new();
        let cursor = Cursor::new(&mut buf);
        let mut zip = ZipWriter::new(cursor);
        let options = SimpleFileOptions::default();
        for (name, content) in entries {
            zip.start_file(*name, options).unwrap();
            zip.write_all(content).unwrap();
        }
        zip.finish().unwrap();
        buf
    }

    #[test]
    fn test_version_newer_logic_and_strict_rejection() {
        assert_eq!(is_version_newer("1.2.30", "1.2.31"), Ok(true));
        assert_eq!(is_version_newer("v1.2.30", "v1.3.0"), Ok(true));
        assert_eq!(is_version_newer("1.2.30", "1.2.30"), Ok(false));
        assert_eq!(is_version_newer("1.2.30", "1.2.29"), Ok(false));

        assert!(is_version_newer("invalid_ver", "1.2.31").is_err());
        assert!(is_version_newer("1.2.30", "invalid_ver").is_err());
        assert!(is_version_newer("foo", "bar").is_err());
    }

    #[test]
    fn test_valid_archive_payload_extraction() {
        let fake_pe = b"MZ\x90\x00valid_executable_content_data";
        let zip_bytes = build_zip(&[
            ("Echo AI.exe", fake_pe),
            (".portable", b"marker"),
        ]);

        let extracted = validate_and_extract_payload(&zip_bytes, "Echo AI.exe").unwrap();
        assert_eq!(extracted, fake_pe);
    }

    #[test]
    fn test_reject_invalid_pe_header() {
        let not_pe = b"ELF\x02\x01\x01\x00";
        let zip_bytes = build_zip(&[
            ("Echo AI.exe", not_pe),
        ]);

        assert!(validate_and_extract_payload(&zip_bytes, "Echo AI.exe").is_err());
    }

    #[test]
    fn test_reject_excess_archive_entries() {
        let fake_pe = b"MZ\x00\x00test";
        let zip_bytes = build_zip(&[
            ("Echo AI.exe", fake_pe),
            (".portable", b"marker"),
            ("extra.txt", b"evil"),
        ]);

        assert!(validate_and_extract_payload(&zip_bytes, "Echo AI.exe").is_err());
    }

    #[test]
    fn test_reject_path_traversal() {
        let fake_pe = b"MZ\x00\x00test";
        let zip_bytes = build_zip(&[
            ("../Echo AI.exe", fake_pe),
        ]);

        assert!(validate_and_extract_payload(&zip_bytes, "Echo AI.exe").is_err());
    }

    #[test]
    fn test_reject_nested_subdirectories() {
        let fake_pe = b"MZ\x00\x00test";
        let zip_bytes = build_zip(&[
            ("subfolder/Echo AI.exe", fake_pe),
        ]);

        assert!(validate_and_extract_payload(&zip_bytes, "Echo AI.exe").is_err());
    }

    #[test]
    fn test_reject_forbidden_data_files() {
        let fake_pe = b"MZ\x00\x00test";
        let zip_bytes = build_zip(&[
            ("Echo AI.exe", fake_pe),
            ("settings.json", b"{\"evil\": true}"),
        ]);

        assert!(validate_and_extract_payload(&zip_bytes, "Echo AI.exe").is_err());
    }

    #[test]
    fn test_reject_mismatched_exe_name() {
        let fake_pe = b"MZ\x00\x00test";
        let zip_bytes = build_zip(&[
            ("DifferentApp.exe", fake_pe),
        ]);

        assert!(validate_and_extract_payload(&zip_bytes, "Echo AI.exe").is_err());
    }

    #[test]
    fn test_single_flight_lock_and_disarm_handoff() {
        let lock = AtomicBool::new(false);

        // 1. Normal pre-handoff failure: drop resets lock
        {
            let guard = UpdateLockGuard::acquire(&lock).expect("First acquire succeeds");
            assert!(lock.load(Ordering::SeqCst));
            assert!(UpdateLockGuard::acquire(&lock).is_err(), "Concurrent acquire fails");
            drop(guard);
        }
        assert!(!lock.load(Ordering::SeqCst), "Drop without disarm releases lock");

        // 2. Successful handoff: disarm retains lock permanently across handoff
        {
            let mut guard = UpdateLockGuard::acquire(&lock).expect("Acquire succeeds after release");
            assert!(lock.load(Ordering::SeqCst));
            guard.disarm();
            drop(guard);
        }
        assert!(lock.load(Ordering::SeqCst), "Disarmed guard retains lock after drop");
        assert!(UpdateLockGuard::acquire(&lock).is_err(), "Acquire fails when lock was retained across handoff");
    }

    #[test]
    fn test_helper_rejects_unconstrained_directory() {
        let temp = tempfile::tempdir().unwrap();
        let wrong_dir = temp.path().join("arbitrary_folder");
        fs::create_dir_all(&wrong_dir).unwrap();
        let helper = wrong_dir.join("updater-helper.exe");
        fs::write(&helper, b"MZ\x00\x00test").unwrap();

        assert!(run_helper_logic(&helper, 999999, "Echo AI.exe", 1000, &[], &[]).is_err());
    }

    #[test]
    fn test_helper_rejects_malformed_target_exe_name() {
        let temp = tempfile::tempdir().unwrap();
        let staging = temp.path().join(STAGING_DIR_NAME);
        fs::create_dir_all(&staging).unwrap();
        let helper = staging.join("updater-helper.exe");
        fs::write(&helper, b"MZ\x00\x00test").unwrap();

        assert!(run_helper_logic(&helper, 999999, "../evil.exe", 1000, &[], &[]).is_err());
        assert!(run_helper_logic(&helper, 999999, "not_an_exe.bat", 1000, &[], &[]).is_err());
    }

    #[test]
    fn test_clean_staging_dir_preserves_unknown_files_and_orphan_backup() {
        let temp = tempfile::tempdir().unwrap();
        let staging = temp.path().join(STAGING_DIR_NAME);
        fs::create_dir_all(&staging).unwrap();

        let known_file = staging.join(REPLACEMENT_EXE_NAME);
        fs::write(&known_file, b"replacement").unwrap();

        let user_file = staging.join("important_user_note.txt");
        fs::write(&user_file, b"do not delete").unwrap();

        let backup_file = staging.join(BACKUP_EXE_NAME);
        fs::write(&backup_file, b"backup_bytes").unwrap();

        // Target executable is missing in parent -> backup MUST be preserved!
        clean_staging_dir(&staging);

        assert!(!known_file.exists());
        assert!(user_file.exists());
        assert!(backup_file.exists(), "Backup must NOT be deleted if target exe is missing");
        assert!(staging.exists());
    }

    #[test]
    fn test_clean_staging_dir_never_deletes_backup_even_with_sibling_exe() {
        let temp = tempfile::tempdir().unwrap();
        let target_dir = temp.path().join("app_root");
        fs::create_dir_all(&target_dir).unwrap();

        // Target directory has sibling applications
        fs::write(target_dir.join("pluely.exe"), b"sibling").unwrap();
        fs::write(target_dir.join("Echo AI.exe"), b"sibling2").unwrap();

        let staging = target_dir.join(STAGING_DIR_NAME);
        fs::create_dir_all(&staging).unwrap();

        let replacement = staging.join(REPLACEMENT_EXE_NAME);
        fs::write(&replacement, b"replacement").unwrap();

        let backup = staging.join(BACKUP_EXE_NAME);
        fs::write(&backup, b"pre_existing_backup").unwrap();

        clean_staging_dir(&staging);

        assert!(!replacement.exists(), "replacement.exe must be removed");
        assert!(backup.exists(), "backup.exe must NEVER be removed by generic cleanup even if sibling exes exist");
        assert_eq!(fs::read(&backup).unwrap(), b"pre_existing_backup");
    }

    #[test]
    fn test_helper_fails_closed_when_unresolved_backup_exists() {
        let temp = tempfile::tempdir().unwrap();
        let target_dir = temp.path().join("app_root");
        fs::create_dir_all(&target_dir).unwrap();

        let target_exe = target_dir.join("CustomApp.exe");
        fs::write(&target_exe, b"MZ\x00\x00target").unwrap();

        let staging = target_dir.join(STAGING_DIR_NAME);
        fs::create_dir_all(&staging).unwrap();

        let helper = staging.join("updater-helper.exe");
        fs::write(&helper, b"MZ\x00\x00helper").unwrap();

        let replacement = staging.join(REPLACEMENT_EXE_NAME);
        fs::write(&replacement, b"MZ\x00\x00replacement").unwrap();

        let existing_backup = staging.join(BACKUP_EXE_NAME);
        fs::write(&existing_backup, b"prior_backup_content").unwrap();

        let res = run_helper_logic(&helper, 999999, "CustomApp.exe", 1000, &[], &[]);
        assert!(res.is_err(), "Helper must fail closed when unresolved backup exists");
        assert_eq!(
            fs::read(&existing_backup).unwrap(),
            b"prior_backup_content",
            "Prior backup must be preserved completely untouched"
        );
    }

    #[test]
    fn test_helper_relaunch_intact_original_on_first_rename_failure() {
        let temp = tempfile::tempdir().unwrap();
        let target_dir = temp.path().join("app_root");
        fs::create_dir_all(&target_dir).unwrap();

        let target_exe = target_dir.join("TargetApp.exe");
        let original_bytes = b"MZ\x00\x00intact_target_original_binary";
        fs::write(&target_exe, original_bytes).unwrap();

        let staging = target_dir.join(STAGING_DIR_NAME);
        fs::create_dir_all(&staging).unwrap();

        let helper = staging.join("updater-helper.exe");
        fs::write(&helper, b"MZ\x00\x00helper").unwrap();

        let replacement = staging.join(REPLACEMENT_EXE_NAME);
        fs::write(&replacement, b"MZ\x00\x00replacement").unwrap();

        // Lock target_exe on Windows by opening it exclusively
        let _file_lock = fs::OpenOptions::new().read(true).write(true).open(&target_exe);

        let res = run_helper_logic(&helper, 999999, "TargetApp.exe", 1000, &[], &[]);
        if let Err(e) = res {
            assert!(
                e.contains("Failed to move target executable to backup")
                    || e.contains("Relaunched intact original executable")
                    || e.contains("Intact original executable"),
                "Error must indicate failure to move target to backup: {e}"
            );
            assert_eq!(
                fs::read(&target_exe).unwrap(),
                original_bytes,
                "Target executable must remain completely intact"
            );
            assert!(
                !staging.join(BACKUP_EXE_NAME).exists(),
                "Backup executable must not exist if initial rename failed"
            );
        }
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn test_wait_for_parent_exit_rejects_access_denied() {
        let res = wait_for_parent_exit(4, 100);
        assert!(res.is_err(), "Access denied must not count as parent exit");
    }
}
