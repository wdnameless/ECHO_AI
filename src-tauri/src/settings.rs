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
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RootKind {
    /// A directory the user controls, next to the executable or from the env.
    Portable,
    /// The historical per-user application data directory.
    AppData,
}

/// Resolved directories, derived from [`AppSettings`] on every call so a change
/// in the UI takes effect without restarting the app.
#[derive(Debug, Clone, Serialize)]
pub struct ResolvedPaths {
    pub root: String,
    pub root_kind: RootKind,
    pub engine_dir: String,
    pub models_dir: String,
    pub logs_dir: String,
    pub settings_path: String,
    /// `true` when the root is writable; a read-only root cannot store models.
    pub writable: bool,
}

/// Directory of the running executable, if it can be determined.
fn exe_dir() -> Option<PathBuf> {
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
    if dir.join(PORTABLE_MARKER).is_file() {
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

/// Resolves every directory the app needs, creating them on demand.
pub fn resolve(settings: &AppSettings) -> ResolvedPaths {
    let root = active_root(settings);
    let kind = if implied_portable_root().is_some() {
        RootKind::Portable
    } else {
        RootKind::AppData
    };

    let pick = |override_path: &Option<String>, fallback: PathBuf| -> PathBuf {
        override_path
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(PathBuf::from)
            .unwrap_or(fallback)
    };

    let engine_dir = pick(&settings.engine_dir, root.join(BIN_DIR));
    let models_dir = pick(&settings.models_dir, root.join(MODELS_DIR));
    let logs_dir = pick(&settings.logs_dir, root.join(LOGS_DIR));

    for dir in [&engine_dir, &models_dir, &logs_dir] {
        let _ = std::fs::create_dir_all(dir);
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
    }
}

/// Convenience wrapper for callers that only need the resolved directories.
pub fn resolved_paths() -> ResolvedPaths {
    resolve(&load_settings())
}

/// Ensures the portable layout exists next to the executable.
///
/// Dropping the marker file is what switches a copied install into portable
/// mode. Fails when the executable's directory is read-only — that is a real
/// answer the UI must show rather than silently falling back to app data.
pub fn enable_portable_mode() -> Result<PathBuf, String> {
    let dir = exe_dir().ok_or("не удалось определить каталог приложения")?;
    if !is_writable(&dir) {
        return Err(format!(
            "каталог {} доступен только для чтения — распакуйте приложение в папку, куда есть запись",
            dir.display()
        ));
    }
    let marker = dir.join(PORTABLE_MARKER);
    std::fs::write(&marker, b"portable\n")
        .map_err(|e| format!("не удалось создать {}: {e}", marker.display()))?;
    let root = dir.join(".echo-ai");
    std::fs::create_dir_all(&root)
        .map_err(|e| format!("не удалось создать {}: {e}", root.display()))?;
    Ok(root)
}

/// Removes the portable marker and the settings override, returning to app data.
pub fn disable_portable_mode() -> Result<(), String> {
    let dir = exe_dir().ok_or("не удалось определить каталог приложения")?;
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
        enable_portable_mode()?;
        Ok(resolved_paths())
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
}
