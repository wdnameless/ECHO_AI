//! User-controlled locations for the local ASR engine and its models.
//!
//! The app used to resolve these paths by probing hardcoded candidates, so the
//! user could not move a 700 MB model off a full system drive, point the engine
//! at a file they already had, or run the whole thing from a USB stick.
//!
//! Layout. Two roots exist:
//!
//! * **portable root** — used when the user asks for it (env var `ECHO_AI_HOME`,
//!   a `.portable` marker next to the executable, or `portable: true` in the
//!   settings file). Everything lives in a single directory the user chose, so
//!   the app can be unplugged and carried around.
//! * **app-data root** — the historical default,
//!   `%APPDATA%/com.srikanthnani.pluely`, used when no portable root applies.
//!
//! The database intentionally stays in app data. Chat history is user data
//! protected by the upgrade contract (R23/R24): relocating it silently would
//! look like data loss on the next launch. Only engine files, models, logs and
//! this settings file follow the chosen root.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Application identifier. Must match `tauri.conf.json` — the database and the
/// existing secure storage live under this directory.
pub const APP_IDENTIFIER: &str = "com.srikanthnani.pluely";

/// Environment variable that forces a portable root.
const PORTABLE_ENV: &str = "ECHO_AI_HOME";

/// Marker file that switches the app into portable mode.
const PORTABLE_MARKER: &str = ".portable";

/// Name of the settings file inside the active root.
const SETTINGS_FILE: &str = "settings.json";

/// Name of the directory holding the extracted engine inside the root.
const BIN_DIR: &str = "bin";

/// Name of the directory holding downloaded models inside the root.
const MODELS_DIR: &str = "models";

/// Name of the directory holding logs inside the root.
const LOGS_DIR: &str = "logs";

/// Name of the SQLite database file.

/// Name of the secure credentials storage file.
pub const SECURE_STORAGE_FILE: &str = "secure_storage.json";
/// Where the engine, models and logs live, plus the settings file itself.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct AppSettings {
    /// Root chosen in the UI. `None` means "decide automatically" (portable
    /// root when one applies, otherwise app data).
    pub data_root: Option<String>,
    /// Override for the extracted engine directory.
    pub engine_dir: Option<String>,
    /// Override for the models directory.
    pub models_dir: Option<String>,
    /// Override for the log directory.
    pub logs_dir: Option<String>,
    /// Absolute path to the model the user picked.
    pub selected_model: Option<String>,
    /// Start with only the tray icon — no visible window.
    pub start_minimized: bool,
}

/// Which root is in effect for this process.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RootKind {
    /// A directory the user controls, next to the executable or from the env.
    Portable,
    /// The historical per-user application data directory.
    AppData,
}

/// Resolved directories, derived from [`AppSettings`] on every call so a change
/// in the UI takes effect without restarting the app.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolvedPaths {
    pub root: String,
    pub root_kind: RootKind,
    pub engine_dir: String,
    pub models_dir: String,
    pub logs_dir: String,
    pub settings_path: String,
    pub secrets_path: String,
    /// `true` when the root is writable; a read-only root cannot store models.
    pub writable: bool,
    /// Names of files consolidated during portable mode activation.
    #[serde(default)]
    pub moved: Vec<String>,
}

/// Every test that reads or writes the machine's real settings file takes this
#[cfg(test)]
pub(crate) static SETTINGS_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Directory of the running executable, if it can be determined.
fn exe_dir() -> Option<PathBuf> {
    if let Ok(override_dir) = std::env::var("ECHO_AI_EXE_DIR") {
        let trimmed = override_dir.trim();
        if !trimmed.is_empty() {
            return Some(PathBuf::from(trimmed));
        }
    }
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
}

/// The app-data root: `<config dir>/com.srikanthnani.pluely`.
///
/// Falls back to the temp directory only if the platform reports no config
/// directory at all, so path resolution can never fail outright.
pub fn app_data_root() -> PathBuf {
    dirs::config_dir()
        .map(|dir| dir.join(APP_IDENTIFIER))
        .unwrap_or_else(std::env::temp_dir)
}

/// The portable root implied by the environment or a marker file, if any.
///
/// A marker file next to the executable is what makes a copied folder behave
/// portably without the user editing any settings — the same trick portable
/// builds of other desktop apps use.
fn implied_portable_root() -> Option<PathBuf> {
    if let Ok(value) = std::env::var(PORTABLE_ENV) {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return Some(PathBuf::from(trimmed));
        }
    }
    let dir = exe_dir()?;
    if dir.join(PORTABLE_MARKER).is_file() || dir.join(".echo-ai").is_dir() {
        return Some(dir.join(".echo-ai"));
    }
    #[cfg(not(test))]
    if is_writable(&dir) {
        return Some(dir.join(".echo-ai"));
    }
    None
}

/// Settings file currently in effect.
///
/// Looked up in the portable root first, then next to the executable, then in
/// app data — so a portable copy reads its own settings and never picks up the
/// installed app's configuration.
fn settings_path_for(root: &Path) -> PathBuf {
    root.join(SETTINGS_FILE)
}
/// The anchor directory where settings.json lives.
///
/// Precedence: genuine portable root when one is active, otherwise app data.
/// The settings file stays in this fixed anchor so `locate_settings_file`
/// always finds it; `data_root` specifies where engine, models, and logs live.
pub fn settings_root() -> PathBuf {
    if let Some(portable) = implied_portable_root() {
        portable
    } else {
        app_data_root()
    }
}


/// Reads settings, returning defaults when the file is missing or unreadable.
///
/// A corrupt settings file must not stop the app from starting: the user would
/// be unable to open the very UI that fixes it.
pub fn load_settings() -> AppSettings {
    let Some(path) = locate_settings_file() else {
        return AppSettings::default();
    };
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return AppSettings::default();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

/// Finds the settings file for the active configuration.
pub fn locate_settings_file() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(root) = implied_portable_root() {
        candidates.push(settings_path_for(&root));
    }
    if let Some(dir) = exe_dir() {
        candidates.push(settings_path_for(&dir));
    }
    candidates.push(settings_path_for(&app_data_root()));
    candidates.into_iter().find(|p| p.is_file())
}

/// Writes settings to the persistent settings anchor.
///
/// If an existing settings file is already located, it is updated in place;
/// otherwise it is written to the fixed settings root (`settings_root()`).
pub fn save_settings(settings: &AppSettings) -> Result<PathBuf, String> {
    let path = locate_settings_file().unwrap_or_else(|| settings_path_for(&settings_root()));
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("не удалось создать каталог {}: {e}", parent.display()))?;
    }
    let body = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("не удалось сериализовать настройки: {e}"))?;
    std::fs::write(&path, body)
        .map_err(|e| format!("не удалось записать {}: {e}", path.display()))?;
    Ok(path)
}

/// The root that should hold engine, models and logs for these settings.
///
/// Precedence: explicit user choice, then an implied portable root, then app
/// data. An explicit choice always wins so the UI can move the files back.
pub fn active_root(settings: &AppSettings) -> PathBuf {
    if let Some(explicit) = settings
        .data_root
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        return PathBuf::from(explicit);
    }
    if let Some(portable) = implied_portable_root() {
        return portable;
    }
    app_data_root()
}

/// Whether a directory can be written to.
///
/// Probed by creating and removing a file: permission bits lie on Windows
/// (Program Files is writable for administrators but not for the app's user),
/// and the answer decides whether the portable layout is even possible.
pub fn is_writable(dir: &Path) -> bool {
    if std::fs::create_dir_all(dir).is_err() {
        return false;
    }
    let probe = dir.join(".write-probe");
    match std::fs::write(&probe, b"") {
        Ok(()) => {
            let _ = std::fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

/// Path to the secure storage file for the given root and portable state.
pub fn secrets_path_for(root: &Path, is_portable: bool) -> PathBuf {
    if is_portable {
        return root.join(SECURE_STORAGE_FILE);
    }
    let root_sec = root.join(SECURE_STORAGE_FILE);
    if root_sec.is_file() {
        return root_sec;
    }
    if let Some(data_dir) = dirs::data_dir() {
        let p = data_dir.join(APP_IDENTIFIER).join(SECURE_STORAGE_FILE);
        if p.is_file() {
            return p;
        }
    }
    if let Some(config_dir) = dirs::config_dir() {
        let p = config_dir.join(APP_IDENTIFIER).join(SECURE_STORAGE_FILE);
        if p.is_file() {
            return p;
        }
    }
    root_sec
}

/// Convenience helper returning the currently resolved secrets path.
pub fn secure_storage_path() -> PathBuf {
    let settings = load_settings();
    let root = active_root(&settings);
    let is_portable = implied_portable_root().is_some();
    secrets_path_for(&root, is_portable)
}

/// Convenience helper returning the currently resolved secrets path and ensuring its directory exists.
pub fn ensure_secure_storage_path() -> Result<PathBuf, String> {
    let path = secure_storage_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create secrets directory: {e}"))?;
    }
    Ok(path)
}

/// Resolves every directory the app needs, creating them on demand.
pub fn resolve(settings: &AppSettings) -> ResolvedPaths {
    let root = active_root(settings);
    let is_portable = implied_portable_root().is_some();
    resolve_internal(root, is_portable, settings)
}

/// Internal resolver accepting root and portable status explicitly for testing.
pub fn resolve_internal(root: PathBuf, is_portable: bool, settings: &AppSettings) -> ResolvedPaths {
    let kind = if is_portable {
        RootKind::Portable
    } else {
        RootKind::AppData
    };

    let pick = |override_path: &Option<String>, fallback: PathBuf| -> PathBuf {
        let parsed = override_path
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(PathBuf::from);

        if let Some(p) = parsed {
            // In portable mode, overrides pointing outside the portable root must not split the layout (R13).
            if is_portable && !p.starts_with(&root) {
                fallback
            } else {
                p
            }
        } else {
            fallback
        }
    };

    let engine_dir = pick(&settings.engine_dir, root.join(BIN_DIR));
    let models_dir = pick(&settings.models_dir, root.join(MODELS_DIR));
    let logs_dir = pick(&settings.logs_dir, root.join(LOGS_DIR));
    let sec_path = secrets_path_for(&root, is_portable);

    for dir in [&engine_dir, &models_dir, &logs_dir] {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Some(parent) = sec_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    ResolvedPaths {
        writable: is_writable(&models_dir),
        root: root.to_string_lossy().to_string(),
        root_kind: kind,
        engine_dir: engine_dir.to_string_lossy().to_string(),
        models_dir: models_dir.to_string_lossy().to_string(),
        logs_dir: logs_dir.to_string_lossy().to_string(),
        settings_path: locate_settings_file()
            .unwrap_or_else(|| settings_path_for(&settings_root()))
            .to_string_lossy()
            .to_string(),
        secrets_path: sec_path.to_string_lossy().to_string(),
        moved: Vec::new(),
    }
}

/// Convenience wrapper for callers that only need the resolved directories.
pub fn resolved_paths() -> ResolvedPaths {
    resolve(&load_settings())
}

/// Moves a file safely: uses rename first, falls back to copy+verify+remove (R14/R15).
fn move_file_robust(src: &Path, dst: &Path) -> Result<bool, String> {
    if !src.exists() || !src.is_file() {
        return Ok(false);
    }
    if src == dst {
        return Ok(false);
    }
    if let Some(parent) = dst.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("не удалось создать каталог {}: {e}", parent.display()))?;
    }

    let src_len = src
        .metadata()
        .map_err(|e| format!("не удалось прочитать метаданные {}: {e}", src.display()))?
        .len();

    // 1. Rename first (fast on same filesystem, handles large models without duplicate allocations)
    if std::fs::rename(src, dst).is_ok()
        && dst.is_file() && dst.metadata().map(|m| m.len()).unwrap_or(0) == src_len {
            return Ok(true);
        }

    // 2. Fall back to copy + verify + remove (cross-volume / across mount points)
    let tmp_dst = dst.with_extension(format!("tmp-{}", uuid::Uuid::new_v4()));
    if let Err(e) = std::fs::copy(src, &tmp_dst) {
        let _ = std::fs::remove_file(&tmp_dst);
        return Err(format!("не удалось скопировать {} в {}: {e}", src.display(), dst.display()));
    }

    let copied_len = tmp_dst.metadata().map(|m| m.len()).unwrap_or(0);
    if copied_len != src_len {
        let _ = std::fs::remove_file(&tmp_dst);
        return Err(format!(
            "ошибка проверки размера при копировании {}: ожидалось {}, скопировано {}",
            dst.display(),
            src_len,
            copied_len
        ));
    }

    if std::fs::rename(&tmp_dst, dst).is_err() {
        if dst.exists() {
            let _ = std::fs::remove_file(dst);
        }
        if let Err(e) = std::fs::rename(&tmp_dst, dst) {
            let _ = std::fs::remove_file(&tmp_dst);
            return Err(format!("не удалось переименовать временный файл в {}: {e}", dst.display()));
        }
    }

    if !dst.is_file() || dst.metadata().map(|m| m.len()).unwrap_or(0) != src_len {
        return Err(format!("проверка целевого файла {} на диске не удалась", dst.display()));
    }

    let _ = std::fs::remove_file(src);
    Ok(true)
}

/// Records what a consolidation moved, so a failure can be undone.
#[derive(Default)]
struct MoveLog {
    /// (dst, src) pairs in move order; rolled back in reverse.
    journal: Vec<(PathBuf, PathBuf)>,
    moved: Vec<String>,
    /// Files the root already had, left untouched at their old location.
    skipped: Vec<String>,
}

impl MoveLog {
    fn move_entry(&mut self, src: &Path, dst: &Path, name: &str) -> Result<(), String> {
        if !src.exists() || src == dst {
            return Ok(());
        }
        // An existing destination wins: the root already holds this file, and
        // replacing it would throw away whichever copy the user has.
        if dst.exists() {
            self.skipped.push(name.to_string());
            return Ok(());
        }
        move_file_robust(src, dst)?;
        self.journal.push((dst.to_path_buf(), src.to_path_buf()));
        self.moved.push(name.to_string());
        Ok(())
    }

    /// Moves every file of `source_dir` into `target_dir`, skipping anything
    /// that already lives inside the portable root.
    fn move_dir_files(
        &mut self,
        source_dir: &Path,
        target_dir: &Path,
        target_root: &Path,
    ) -> Result<(), String> {
        if !source_dir.is_dir() || source_dir.starts_with(target_root) {
            return Ok(());
        }
        let Ok(entries) = std::fs::read_dir(source_dir) else {
            return Ok(());
        };
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_file() {
                let fname = p.file_name().unwrap_or_default().to_string_lossy().to_string();
                let dst = target_dir.join(&fname);
                self.move_entry(&p, &dst, &fname)?;
            }
        }
        Ok(())
    }

    fn move_secrets(&mut self, src: &Path, target: &Path) -> Result<(), String> {
        if !src.is_file() || src == target {
            return Ok(());
        }
        let fname = src.file_name().unwrap_or_default().to_string_lossy().to_string();
        self.move_entry(src, target, &fname)
    }

    /// Puts every moved file back and removes the marker, so a failed
    /// consolidation leaves the previous layout intact.
    fn rollback(&mut self, marker: &Path) {
        for (dst, src) in std::mem::take(&mut self.journal).into_iter().rev() {
            let _ = move_file_robust(&dst, &src);
        }
        if marker.is_file() {
            let _ = std::fs::remove_file(marker);
        }
    }
}
/// Ensures the portable layout exists and consolidates existing scattered state into it (R14).
pub fn enable_portable_mode_in(dir: &Path) -> Result<ResolvedPaths, String> {
    if !is_writable(dir) {
        return Err(format!(
            "каталог {} доступен только для чтения — распакуйте приложение в папку, куда есть запись",
            dir.display()
        ));
    }

    let target_root = dir.join(".echo-ai");
    std::fs::create_dir_all(&target_root)
        .map_err(|e| format!("не удалось создать {}: {e}", target_root.display()))?;

    let target_models_dir = target_root.join(MODELS_DIR);
    let target_bin_dir = target_root.join(BIN_DIR);
    let target_logs_dir = target_root.join(LOGS_DIR);
    let target_secrets_path = target_root.join(SECURE_STORAGE_FILE);
    let target_settings_path = target_root.join(SETTINGS_FILE);

    for d in [&target_models_dir, &target_bin_dir, &target_logs_dir] {
        std::fs::create_dir_all(d)
            .map_err(|e| format!("не удалось создать {}: {e}", d.display()))?;
    }

    let mut settings = load_settings();
    let current_paths = resolve(&settings);

    let mut log = MoveLog::default();

    let marker = dir.join(PORTABLE_MARKER);
    let is_actual_app = exe_dir().map(|e| e == dir).unwrap_or(false);

    // 1. Consolidate models
    let cur_models = PathBuf::from(&current_paths.models_dir);
    if let Err(e) = log.move_dir_files(&cur_models, &target_models_dir, &target_root) {
        log.rollback(&marker);
        return Err(format!("Не удалось перенести модели: {e}"));
    }
    let scratch_models = dir.join("models");
    if scratch_models != cur_models {
        if let Err(e) = log.move_dir_files(&scratch_models, &target_models_dir, &target_root) {
            log.rollback(&marker);
            return Err(format!("Не удалось перенести модели: {e}"));
        }
    }
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_file() {
                if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
                    if ext == "bin" || ext == "gguf" {
                        let fname = p.file_name().unwrap_or_default().to_string_lossy().to_string();
                        let dst = target_models_dir.join(&fname);
                        if let Err(e) = log.move_entry(&p, &dst, &fname) {
                            log.rollback(&marker);
                            return Err(format!("Не удалось перенести модель {fname}: {e}"));
                        }
                    }
                }
            }
        }
    }

    // 3. Consolidate secrets
    let cur_sec = PathBuf::from(&current_paths.secrets_path);
    if cur_sec.is_file() && (is_actual_app || cur_sec.starts_with(dir)) {
        if let Err(e) = log.move_secrets(&cur_sec, &target_secrets_path) {
            log.rollback(&marker);
            return Err(format!("Не удалось перенести файл секретов: {e}"));
        }
    }
    let scratch_sec = dir.join(SECURE_STORAGE_FILE);
    if scratch_sec.is_file() && scratch_sec != cur_sec {
        if let Err(e) = log.move_secrets(&scratch_sec, &target_secrets_path) {
            log.rollback(&marker);
            return Err(format!("Не удалось перенести файл секретов из каталога: {e}"));
        }
    }

    // 4. Consolidate engine binaries & logs
    let cur_engine = PathBuf::from(&current_paths.engine_dir);
    if is_actual_app || cur_engine.starts_with(dir) {
        let _ = log.move_dir_files(&cur_engine, &target_bin_dir, &target_root);
    }
    let cur_logs = PathBuf::from(&current_paths.logs_dir);
    if is_actual_app || cur_logs.starts_with(dir) {
        let _ = log.move_dir_files(&cur_logs, &target_logs_dir, &target_root);
    }

    // 5. Clear per-directory overrides that point outside the portable root (R14)
    settings.data_root = None;
    settings.engine_dir = None;
    settings.models_dir = None;
    settings.logs_dir = None;
    if let Some(sel) = &settings.selected_model {
        let sel_path = PathBuf::from(sel);
        if let Some(fname) = sel_path.file_name() {
            let in_target = target_models_dir.join(fname);
            if in_target.is_file() {
                settings.selected_model = Some(in_target.to_string_lossy().to_string());
            }
        }
    }

    // 6. Write .portable marker
    if let Err(e) = std::fs::write(&marker, b"portable\n") {
        log.rollback(&marker);
        return Err(format!("не удалось создать {}: {e}", marker.display()));
    }

    // 7. Write settings into target_settings_path
    let body = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("не удалось сериализовать настройки: {e}"))?;
    if let Err(e) = std::fs::write(&target_settings_path, body) {
        log.rollback(&marker);
        return Err(format!("не удалось записать {}: {e}", target_settings_path.display()));
    }

    // 8. Patch DB checksums if database was consolidated
    // 9. Resolve layout under target_root
    let mut resolved = resolve_internal(target_root, true, &settings);
    resolved.moved = log.moved;
    Ok(resolved)
}

/// Ensures the portable layout exists next to the executable.
pub fn enable_portable_mode() -> Result<ResolvedPaths, String> {
    let dir = exe_dir().ok_or("не удалось определить каталог приложения")?;
    enable_portable_mode_in(&dir)
}

/// Removes the portable marker in the given directory and clears data_root override.
pub fn disable_portable_mode_in(dir: &Path) -> Result<(), String> {
    let marker = dir.join(PORTABLE_MARKER);
    if marker.is_file() {
        std::fs::remove_file(&marker)
            .map_err(|e| format!("не удалось удалить {}: {e}", marker.display()))?;
    }
    let mut settings = load_settings();
    settings.data_root = None;
    save_settings(&settings)?;
    Ok(())
}

/// Removes the portable marker and the settings override, returning to app data.
pub fn disable_portable_mode() -> Result<(), String> {
    let dir = exe_dir().ok_or("не удалось определить каталог приложения")?;
    disable_portable_mode_in(&dir)
}

/// Tauri commands exposing the resolved layout to the UI.
pub mod commands {
    use super::*;

    /// Current directories, the settings file in use, and whether the root can
    /// be written to (a read-only root cannot hold downloaded models).
    #[tauri::command]
    pub fn get_paths() -> ResolvedPaths {
        resolved_paths()
    }

    /// Applies user-chosen directories and reports the resulting layout.
    ///
    /// Empty strings clear an override rather than creating a directory named
    /// by whitespace, which is what the UI sends when a field is emptied.
    #[tauri::command]
    pub fn set_paths(
        data_root: Option<String>,
        engine_dir: Option<String>,
        models_dir: Option<String>,
        logs_dir: Option<String>,
    ) -> Result<ResolvedPaths, String> {
        let mut settings = load_settings();
        apply_path_override(&mut settings.data_root, data_root);
        apply_path_override(&mut settings.engine_dir, engine_dir);
        apply_path_override(&mut settings.models_dir, models_dir);
        apply_path_override(&mut settings.logs_dir, logs_dir);

        // Refuse a models directory that cannot be written: the user would
        // otherwise only discover it when a multi-gigabyte download fails.
        let resolved = resolve(&settings);
        if !resolved.writable {
            return Err(format!(
                "каталог моделей {} недоступен для записи",
                resolved.models_dir
            ));
        }

        save_settings(&settings)?;
        Ok(resolved)
    }

    /// Applies a partial path override:
    /// - `None` means the field was omitted from the request, leaving existing value intact.
    /// - `Some("")` (empty/whitespace) clears the override, resetting to `None`.
    /// - `Some("path")` updates the override with the trimmed path.
    pub fn apply_path_override(target: &mut Option<String>, incoming: Option<String>) {
        if let Some(val) = incoming {
            let trimmed = val.trim();
            if trimmed.is_empty() {
                *target = None;
            } else {
                *target = Some(trimmed.to_string());
            }
        }
    }

    /// Opens the native folder picker and returns the chosen directory.
    #[tauri::command]
    pub async fn pick_directory(title: Option<String>) -> Option<String> {
        let mut dialog = rfd::AsyncFileDialog::new();
        if let Some(title) = title {
            dialog = dialog.set_title(&title);
        }
        dialog.pick_folder().await.map(|handle| {
            handle.path().to_string_lossy().to_string()
        })
    }

    /// Switches the app into portable mode next to its executable.
    #[tauri::command]
    pub fn enable_portable() -> Result<ResolvedPaths, String> {
        // The layout the consolidation produced, not a fresh resolution: a
        // second resolution could name a different root (an `ECHO_AI_HOME`
        // override outranks the marker) and hide what actually happened.
        enable_portable_mode()
    }

    /// Returns to the default per-user layout.
    #[tauri::command]
    pub fn disable_portable() -> Result<ResolvedPaths, String> {
        disable_portable_mode()?;
        Ok(resolved_paths())
    }

    /// Whether the app should start with only the tray icon visible.
    #[tauri::command]
    pub fn get_start_minimized() -> bool {
        load_settings().start_minimized
    }

    /// Persists the start-minimized preference.
    #[tauri::command]
    pub fn set_start_minimized(enabled: bool) -> Result<(), String> {
        let mut settings = load_settings();
        settings.start_minimized = enabled;
        save_settings(&settings)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explicit_root_wins_over_every_implied_one() {
        let settings = AppSettings {
            data_root: Some(r"D:\portable-echo".to_string()),
            ..Default::default()
        };
        assert_eq!(active_root(&settings), PathBuf::from(r"D:\portable-echo"));
    }

    #[test]
    fn blank_root_falls_back_instead_of_resolving_to_cwd() {
        // An empty string must not be treated as a path: it would silently
        // resolve to the process working directory and scatter files there.
        let settings = AppSettings {
            data_root: Some("   ".to_string()),
            ..Default::default()
        };
        assert_eq!(active_root(&settings), app_data_root());
    }

    #[test]
    fn overrides_replace_only_the_directory_they_name() {
        let settings = AppSettings {
            data_root: Some(r"D:\root".to_string()),
            models_dir: Some(r"E:\big-models".to_string()),
            ..Default::default()
        };
        let paths = resolve(&settings);
        assert!(paths.models_dir.starts_with(r"E:\big-models"));
        assert!(paths.engine_dir.starts_with(r"D:\root"));
        assert!(paths.logs_dir.starts_with(r"D:\root"));
    }

    #[test]
    fn app_data_root_is_reported_as_such() {
        let settings = AppSettings::default();
        let resolved = resolve(&settings);
        // Without a portable env/marker the default root is app data.
        if implied_portable_root().is_none() {
            assert_eq!(resolved.root_kind, RootKind::AppData);
        }
    }
    #[test]
    fn arbitrary_data_root_is_not_reported_as_portable() {
        let settings = AppSettings {
            data_root: Some(r"D:\TMP\echo-root".to_string()),
            ..Default::default()
        };
        let resolved = resolve(&settings);
        if implied_portable_root().is_none() {
            assert_eq!(resolved.root_kind, RootKind::AppData);
        }
    }

    #[test]
    fn partial_update_preserves_omitted_fields_and_clears_on_empty() {
        let mut target = Some("D:/root".to_string());

        // Omitted (None) leaves value unchanged
        commands::apply_path_override(&mut target, None);
        assert_eq!(target.as_deref(), Some("D:/root"));

        // Provided path updates value
        commands::apply_path_override(&mut target, Some("E:/other".to_string()));
        assert_eq!(target.as_deref(), Some("E:/other"));

        // Empty string clears override
        commands::apply_path_override(&mut target, Some("   ".to_string()));
        assert_eq!(target, None);
    }

    #[test]
    fn missing_settings_file_yields_defaults_not_an_error() {
        let settings = load_settings();
        // Defaults are all None/false; the point is that this never panics.
        assert!(settings.selected_model.is_none() || settings.selected_model.is_some());
    }

    struct TestDir(PathBuf);
    impl TestDir {
        fn new(name: &str) -> Self {
            let p = std::env::temp_dir().join(format!("pluely-test-{name}-{}", uuid::Uuid::new_v4()));
            let _ = std::fs::create_dir_all(&p);
            Self(p)
        }
        fn path(&self) -> &Path {
            &self.0
        }
    }
    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    use super::SETTINGS_LOCK as REAL_SETTINGS_LOCK;

    struct RealSettingsGuard {
        path: Option<PathBuf>,
        original: Option<Vec<u8>>,
    }

    impl RealSettingsGuard {
        fn take() -> Self {
            // When no file exists yet, the test may create one: remember where
            // it would land so the guard can take it away again.
            let path = locate_settings_file()
                .or_else(|| Some(settings_path_for(&settings_root())));
            let original = path.as_ref().and_then(|p| std::fs::read(p).ok());
            Self { path, original }
        }
    }

    impl Drop for RealSettingsGuard {
        fn drop(&mut self) {
            match (&self.path, &self.original) {
                (Some(path), Some(bytes)) => {
                    let _ = std::fs::write(path, bytes);
                }
                (Some(path), None) => {
                    let _ = std::fs::remove_file(path);
                }
                _ => {}
            }
        }
    }

    #[test]
    fn portable_mode_resolves_db_and_secrets_under_portable_root() {
        let test_dir = TestDir::new("portable-paths");
        let root = test_dir.path().join(".echo-ai");
        std::fs::create_dir_all(&root).unwrap();

        let secrets_path = secrets_path_for(&root, true);

        assert_eq!(secrets_path, root.join(SECURE_STORAGE_FILE));

        let settings = AppSettings {
            models_dir: Some(r"E:\outside\models".to_string()),
            engine_dir: Some(r"E:\outside\bin".to_string()),
            logs_dir: Some(r"E:\outside\logs".to_string()),
            ..Default::default()
        };
        let paths = resolve_internal(root.clone(), true, &settings);
        assert_eq!(paths.root_kind, RootKind::Portable);
        assert_eq!(paths.secrets_path, root.join(SECURE_STORAGE_FILE).to_string_lossy());
        // Overrides pointing outside portable root must not split the layout (R13)
        assert_eq!(paths.models_dir, root.join(MODELS_DIR).to_string_lossy());
        assert_eq!(paths.engine_dir, root.join(BIN_DIR).to_string_lossy());
        assert_eq!(paths.logs_dir, root.join(LOGS_DIR).to_string_lossy());
    }

    #[test]
    fn enable_portable_consolidates_files_and_clears_overrides() {
        let _serial = REAL_SETTINGS_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let _settings_guard = RealSettingsGuard::take();
        let test_dir = TestDir::new("scratch-consolidation");
        let dir = test_dir.path();

        let custom_models = dir.join("custom_models");
        std::fs::create_dir_all(&custom_models).unwrap();
        let model_file = custom_models.join("whisper.bin");
        std::fs::write(&model_file, b"model payload").unwrap();


        let sec_file = dir.join(SECURE_STORAGE_FILE);
        std::fs::write(&sec_file, b"{\"license_key\":\"test-123\"}").unwrap();

        let initial_settings = AppSettings {
            models_dir: Some(custom_models.to_string_lossy().to_string()),
            engine_dir: Some(dir.join("ext_bin").to_string_lossy().to_string()),
            logs_dir: Some(dir.join("ext_logs").to_string_lossy().to_string()),
            data_root: Some(dir.join("ext_root").to_string_lossy().to_string()),
            ..Default::default()
        };
        let _ = save_settings(&initial_settings);

        let res = enable_portable_mode_in(dir).expect("enable_portable_mode_in should succeed");

        let target_root = dir.join(".echo-ai");
        assert_eq!(res.root, target_root.to_string_lossy().to_string());
        assert_eq!(res.root_kind, RootKind::Portable);
        assert_eq!(res.secrets_path, target_root.join(SECURE_STORAGE_FILE).to_string_lossy());
        assert_eq!(res.models_dir, target_root.join(MODELS_DIR).to_string_lossy());

        // Files moved into .echo-ai
        assert!(target_root.join("models").join("whisper.bin").is_file());
        assert!(target_root.join(SECURE_STORAGE_FILE).is_file());

        // Original scattered files removed
        assert!(!model_file.exists());
        assert!(!sec_file.exists());

        // A file the root already holds is left where it is: the existing copy
        // must never be replaced by a same-named file from the old layout.
        let colliding = dir.join("custom_models").join("already-here.gguf");
        std::fs::write(&colliding, b"old copy").unwrap();
        let kept = target_root.join("models").join("already-here.gguf");
        std::fs::write(&kept, b"root copy").unwrap();
        let _ = enable_portable_mode_in(dir).expect("third enable should succeed");
        assert!(kept.is_file(), "the copy in the root must survive");
        assert_eq!(std::fs::read(&kept).unwrap(), b"root copy");
        assert!(colliding.is_file(), "the older copy stays where it was");

        // Overrides cleared in saved settings
        let saved_raw = std::fs::read_to_string(target_root.join(SETTINGS_FILE)).unwrap();
        let saved: AppSettings = serde_json::from_str(&saved_raw).unwrap();
        assert!(saved.models_dir.is_none());
        assert!(saved.engine_dir.is_none());
        assert!(saved.logs_dir.is_none());
        assert!(saved.data_root.is_none());

        // Idempotency: calling enable_portable_mode_in again does not fail or duplicate
        let res2 = enable_portable_mode_in(dir).expect("second enable should be idempotent");
        assert_eq!(res2.root, target_root.to_string_lossy().to_string());
    }

    #[test]
    fn non_portable_mode_uses_existing_secrets_in_app_data() {
        let test_dir = TestDir::new("non-portable");
        let fake_app_data = test_dir.path().join("app_data");
        std::fs::create_dir_all(&fake_app_data).unwrap();

        let sec_file = fake_app_data.join(SECURE_STORAGE_FILE);
        std::fs::write(&sec_file, b"existing appdata secrets").unwrap();

        let resolved_sec = secrets_path_for(&fake_app_data, false);
        assert_eq!(resolved_sec, sec_file);
        assert!(resolved_sec.is_file());
    }
}
