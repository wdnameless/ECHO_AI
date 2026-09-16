//! Model catalogue and downloader for the local ASR engine.
//!
//! Until now the engine shipped with exactly one model, embedded in the
//! installer (751 MB of a 738 MB download). That made a portable single-exe
//! impossible and left the user no say in the trade-off between recognition
//! quality and disk footprint. This module exposes the published quantisations
//! of the bundled model so the app can fetch whichever the user picks, into
//! whichever directory they chose.
//!
//! Integrity. Every entry carries the SHA-256 published by Hugging Face for
//! that file (the LFS object id), which was checked against the copy that used
//! to ship inside the installer. A download is only accepted once its hash
//! matches, so a truncated or substituted file can never reach the engine.

use std::io::{Read, Seek, Write};
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::settings;

/// Hugging Face repository holding the published quantisations.
const MODEL_REPO: &str = "handy-computer/nemotron-3.5-asr-streaming-0.6b-gguf";

/// Immutable revision the paths are pinned to. Using a commit hash rather than
/// `main` keeps a re-download byte-identical to the hashes below.
const MODEL_REVISION: &str = "8139c4ec14bdc45c361adf8d57c27c28e7478272";

/// The generated catalogue, embedded at compile time.
///
/// Regenerate with `python scripts/gen_catalog.py`. It is produced from the
/// Hugging Face API — sizes, digests, capabilities and benchmarks all come from
/// the published repository — so it cannot drift from what is actually
/// available, and a newly published model appears on the next regeneration.
const CATALOG_JSON: &str = include_str!("model_catalog.json");

/// Capabilities reported by the model card.
#[derive(Debug, Clone, Serialize, serde::Deserialize)]
pub struct Capabilities {
    pub streaming: bool,
    pub translate: bool,
    pub lang_detect: bool,
    pub timestamps: String,
}

/// One downloadable quantisation of a model.
#[derive(Debug, Clone, Serialize, serde::Deserialize)]
pub struct ModelFile {
    pub filename: String,
    /// Quantisation label (`Q5_K_M`, `F16`, …).
    pub quant: String,
    pub size_bytes: u64,
    /// SHA-256 of the file contents; the trust anchor for a download.
    pub sha256: String,
}

/// A selectable speech-recognition model.
#[derive(Debug, Clone, Serialize, serde::Deserialize)]
pub struct ModelEntry {
    pub id: String,
    /// Hugging Face repository the files come from.
    pub repo: String,
    /// Commit the download URLs are pinned to, so a re-download is identical.
    pub revision: String,
    /// Model family (`whisper`, `parakeet`, `canary`, …).
    pub family: String,
    pub name: String,
    pub description: String,
    pub parameters: String,
    pub language_count: usize,
    pub languages: Vec<String>,
    pub capabilities: Capabilities,
    /// 0-100, derived from the published real-time factor.
    pub speed_score: Option<i64>,
    /// 0-100, derived from the published word error rate.
    pub accuracy_score: Option<i64>,
    /// Published word error rate, when the card reports one.
    pub wer: Option<f64>,
    pub wer_set: Option<String>,
    pub files: Vec<ModelFile>,
    /// Quantisation chosen by default for this model.
    pub default_file: String,
    pub recommended: bool,
}

/// The catalogue file as a whole.
#[derive(Debug, Clone, serde::Deserialize)]
struct Catalog {
    #[allow(dead_code)]
    catalog_version: u32,
    #[allow(dead_code)]
    generated_at: String,
    #[allow(dead_code)]
    source: String,
    models: Vec<ModelEntry>,
}

/// Parsed once: the file is a compile-time constant, so re-parsing per call
/// would waste work on every catalog request from the UI.
fn catalog() -> &'static Catalog {
    use std::sync::OnceLock;

    static PARSED: OnceLock<Catalog> = OnceLock::new();
    PARSED.get_or_init(|| {
        serde_json::from_str(CATALOG_JSON)
            .expect("model_catalog.json is generated and must parse")
    })
}

/// Every model the engine can load.
pub fn entries() -> &'static [ModelEntry] {
    &catalog().models
}

/// Finds a model by its catalogue id.
pub fn entry(id: &str) -> Option<&'static ModelEntry> {
    entries().iter().find(|e| e.id == id)
}

/// Download URL for one file, pinned to the model's revision.
pub fn download_url(model: &ModelEntry, file: &ModelFile) -> String {
    format!(
        "https://huggingface.co/{}/resolve/{}/{}",
        model.repo, model.revision, file.filename
    )
}

/// A model file found in the user's models directory.
#[derive(Debug, Clone, Serialize)]
pub struct InstalledModel {
    pub file_name: String,
    pub path: String,
    pub size_bytes: u64,
    /// Catalogue id when the file belongs to a known model.
    pub model_id: Option<String>,
    /// Quantisation label when the catalogue knows this file.
    pub quant: Option<String>,
}

/// Lists model files in the resolved models directory.
///
/// Any `.gguf` is reported, not just known variants: the engine accepts an
/// arbitrary path, so a model the user produced or downloaded by hand must be
/// selectable too.
pub fn list_installed() -> Vec<InstalledModel> {
    let dir = PathBuf::from(settings::resolved_paths().models_dir);
    // Named to avoid shadowing `entries()`, the catalogue accessor.
    let Ok(dir_entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };

    let mut found: Vec<InstalledModel> = dir_entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("gguf"))
        })
        .filter_map(|path| {
            let meta = std::fs::metadata(&path).ok()?;
            let file_name = path.file_name()?.to_string_lossy().to_string();
            let known = entries().iter().find_map(|model| {
                model
                    .files
                    .iter()
                    .find(|f| f.filename == file_name)
                    .map(|f| (model.id.clone(), f.quant.clone()))
            });
            let (model_id, quant) = match known {
                Some((id, quant)) => (Some(id), Some(quant)),
                None => (None, None),
            };
            Some(InstalledModel {
                model_id,
                quant,
                path: path.to_string_lossy().to_string(),
                size_bytes: meta.len(),
                file_name,
            })
        })
        .collect();

    found.sort_by(|a, b| a.file_name.cmp(&b.file_name));
    found
}

/// Where a catalogue file would be stored given the current settings.
pub fn target_path(file: &ModelFile) -> PathBuf {
    PathBuf::from(settings::resolved_paths().models_dir).join(&file.filename)
}

/// Whether the file is already present.
pub fn is_installed(file: &ModelFile) -> bool {
    target_path(file).is_file()
}

/// Finds the file entry a model's default quantisation refers to.
pub fn default_file_of(model: &ModelEntry) -> Option<&ModelFile> {
    model
        .files
        .iter()
        .find(|f| f.filename == model.default_file)
        .or_else(|| model.files.first())
}

/// Streams a response body to disk, reporting progress and resuming.
///
/// Writes into `<file>.part` and renames on success, so an interrupted download
/// can never leave a half-file the engine would try to load. The partial file is
/// kept between attempts and reused: a 2.5 GB model over a flaky link should not
/// start from zero because the connection dropped at 90%.
struct DownloadTarget {
    temp: PathBuf,
    final_path: PathBuf,
    file: std::fs::File,
    /// Bytes already on disk before this attempt.
    written: u64,
}

impl DownloadTarget {
    /// Opens the partial file, resuming when it already has content.
    fn open(final_path: PathBuf) -> Result<Self, String> {
        let dir = final_path
            .parent()
            .ok_or("некорректный путь к модели")?
            .to_path_buf();
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("не удалось создать {}: {e}", dir.display()))?;

        let temp = final_path.with_extension("gguf.part");
        let existing = std::fs::metadata(&temp).map(|m| m.len()).unwrap_or(0);

        // Append when resuming, truncate when starting over.
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .open(&temp)
            .map_err(|e| format!("не удалось создать {}: {e}", temp.display()))?;
        if existing > 0 {
            file.seek(std::io::SeekFrom::End(0))
                .map_err(|e| format!("ошибка доступа к {temp:?}: {e}"))?;
        }

        Ok(Self {
            temp,
            final_path,
            file,
            written: existing,
        })
    }

    /// Restarts from an empty file.
    ///
    /// Needed when the server ignores a range request: appending to a partial
    /// file would otherwise splice two copies of the model together.
    fn restart(final_path: PathBuf) -> Result<Self, String> {
        let temp = final_path.with_extension("gguf.part");
        let _ = std::fs::remove_file(&temp);
        Self::open(final_path)
    }

    fn write(&mut self, chunk: &[u8]) -> Result<(), String> {
        self.file
            .write_all(chunk)
            .map_err(|e| format!("ошибка записи: {e}"))?;
        self.written += chunk.len() as u64;
        Ok(())
    }

    /// Flushes and renames the completed file into place.
    fn finish(mut self) -> Result<PathBuf, String> {
        self.file.flush().map_err(|e| format!("ошибка записи: {e}"))?;
        self.file
            .sync_all()
            .map_err(|e| format!("ошибка записи: {e}"))?;
        drop(self.file);
        std::fs::rename(&self.temp, &self.final_path).map_err(|e| {
            format!("не удалось сохранить модель: {e}")
        })?;
        Ok(self.final_path)
    }

    /// Keeps the partial file, so the next attempt can resume.
    fn keep_partial(&self) -> u64 {
        self.written
    }
}

/// Progress reported while downloading.
pub type ProgressFn<'a> = &'a mut dyn FnMut(u64, u64);

/// How many times a failed transfer is retried before giving up.
const DOWNLOAD_ATTEMPTS: usize = 5;

/// Runs one HTTP attempt, resuming from whatever is already on disk.
///
/// Returns the number of bytes now on disk. `Ok(None)` means the server does not
/// honour range requests, so the caller should restart from scratch.
fn attempt(
    client: &reqwest::blocking::Client,
    url: &str,
    target: &mut DownloadTarget,
    total: u64,
    progress: ProgressFn<'_>,
) -> Result<u64, String> {
    let have = target.written;
    let mut request = client.get(url);

    if have > 0 {
        request = request.header("Range", format!("bytes={have}-"));
    }

    let mut response = request
        .send()
        .map_err(|e| format!("не удалось начать загрузку: {e}"))?;

    let status = response.status();

    // 416 means the partial file is already the whole thing; treat it as done
    // and let the caller verify the hash.
    if status == reqwest::StatusCode::RANGE_NOT_SATISFIABLE {
        return Ok(have);
    }

    if !status.is_success() {
        return Err(format!("сервер вернул {status}"));
    }

    // A 200 to a range request means the server ignored it and is resending
    // everything. Appending would corrupt the file, so start over.
    let resuming = have > 0 && status == reqwest::StatusCode::PARTIAL_CONTENT;
    if have > 0 && !resuming {
        let restart = DownloadTarget::restart(target.final_path.clone())?;
        *target = restart;
        progress(0, total);
    }

    let mut buffer = vec![0u8; 1 << 20];
    loop {
        match response.read(&mut buffer) {
            Ok(0) => break,
            Ok(n) => {
                target.write(&buffer[..n])?;
                progress(target.written, total);
            }
            Err(e) => {
                // Keep what arrived: the next attempt resumes from here.
                return Err(format!("{e}"));
            }
        }
    }

    Ok(target.written)
}

/// Downloads one catalogue file into the resolved models directory.
///
/// Blocks the calling thread; callers run this on a worker thread so the UI
/// stays responsive. Interrupted transfers resume instead of restarting, which
/// matters for the multi-gigabyte models.
pub fn download(
    model: &ModelEntry,
    file: &ModelFile,
    progress: ProgressFn<'_>,
) -> Result<PathBuf, String> {
    let target_path = target_path(file);
    if target_path.is_file() {
        return Ok(target_path);
    }

    let client = reqwest::blocking::Client::builder()
        .timeout(None)
        .build()
        .map_err(|e| format!("не удалось создать HTTP-клиент: {e}"))?;

    let url = download_url(model, file);
    let total = file.size_bytes;
    let mut last_error = String::new();

    for attempt_index in 0..DOWNLOAD_ATTEMPTS {
        let mut sink = DownloadTarget::open(target_path.clone())?;
        let before = sink.written;

        match attempt(&client, &url, &mut sink, total, progress) {
            Ok(written) => {
                // Nothing arrived and nothing was there before: the server is
                // answering but sending no body.
                if written == 0 {
                    last_error = "загрузка вернула пустой файл".to_string();
                    continue;
                }

                // The transfer ran to completion only when the size matches what
                // the catalogue declared; a short read means the connection
                // dropped and the next attempt should continue.
                if written < total {
                    last_error = format!(
                        "получено {written} из {total} байт, продолжаю загрузку"
                    );
                    continue;
                }

                let saved = sink.finish()?;

                // Hash the result and refuse anything that does not match the
                // published digest: a corrupted model would otherwise fail deep
                // inside the engine with an error nobody can interpret.
                let actual = sha256_file(&saved)?;
                if actual.eq_ignore_ascii_case(&file.sha256) {
                    return Ok(saved);
                }

                // A mismatch means the bytes are wrong, not merely incomplete.
                // Keeping them would make every retry fail the same way.
                let _ = std::fs::remove_file(&saved);
                last_error = format!(
                    "файл повреждён: ожидался SHA-256 {}, получен {actual}",
                    file.sha256
                );
            }
            Err(e) => {
                last_error = e;
                if sink.keep_partial() == before {
                    // No progress at all this round; a short pause keeps a broken
                    // link from being hammered.
                    std::thread::sleep(std::time::Duration::from_millis(700));
                }
            }
        }

        if attempt_index + 1 < DOWNLOAD_ATTEMPTS {
            eprintln!(
                "[models] попытка {} не удалась ({}), повторяю",
                attempt_index + 1,
                last_error
            );
        }
    }

    Err(format!(
        "не удалось скачать {} после {DOWNLOAD_ATTEMPTS} попыток: {last_error}",
        file.filename
    ))
}

/// SHA-256 of a file, streamed so a 2.5 GB variant does not need that much RAM.
pub fn sha256_file(path: &Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};

    let mut file = std::fs::File::open(path)
        .map_err(|e| format!("не удалось открыть {}: {e}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1 << 20];

    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|e| format!("ошибка чтения {}: {e}", path.display()))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }

    Ok(format!("{:x}", hasher.finalize()))
}

/// Deletes a model file from the models directory.
///
/// The path is taken from the listing rather than the UI so a crafted string
/// cannot delete anything outside the models directory.
pub fn delete(file_name: &str) -> Result<(), String> {
    let dir = PathBuf::from(settings::resolved_paths().models_dir);
    let candidate = dir.join(file_name);

    let canonical_dir = dir
        .canonicalize()
        .map_err(|e| format!("не удалось открыть {}: {e}", dir.display()))?;
    let canonical_file = candidate
        .canonicalize()
        .map_err(|e| format!("не удалось открыть {}: {e}", candidate.display()))?;

    if !canonical_file.starts_with(&canonical_dir) {
        return Err("файл лежит вне каталога моделей".to_string());
    }

    std::fs::remove_file(&canonical_file)
        .map_err(|e| format!("не удалось удалить {}: {e}", canonical_file.display()))
}

/// Tauri commands for browsing, downloading and selecting models.
#[tauri::command]
pub fn model_catalog() -> Vec<ModelEntry> {
    entries().to_vec()
}

/// Models already present in the models directory.
#[tauri::command]
pub fn list_models() -> Vec<InstalledModel> {
    list_installed()
}

/// The model the engine is currently pointed at.
#[tauri::command]
pub fn selected_model() -> Option<InstalledModel> {
    let settings = settings::load_settings();
    let path = PathBuf::from(settings.selected_model?);
    if !path.is_file() {
        return None;
    }
    let file_name = path.file_name()?.to_string_lossy().to_string();

    let known = entries().iter().find_map(|model| {
        model
            .files
            .iter()
            .find(|f| f.filename == file_name)
            .map(|f| (model.id.clone(), f.quant.clone()))
    });
    let (model_id, quant) = match known {
        Some((id, quant)) => (Some(id), Some(quant)),
        None => (None, None),
    };

    Some(InstalledModel {
        model_id,
        quant,
        size_bytes: std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0),
        path: path.to_string_lossy().to_string(),
        file_name,
    })
}

/// Points the engine at a model and restarts it on the new file.
///
/// Accepts either a catalogue id or a path to a `.gguf` the user supplied, so a
/// model produced elsewhere stays usable.
#[tauri::command]
pub async fn select_model(id_or_path: String) -> Result<InstalledModel, String> {
    let selector = id_or_path.trim();
    if selector.is_empty() {
        return Err("не указана модель".to_string());
    }

    let path = match entry(selector) {
        Some(model) => {
            let file = default_file_of(model)
                .ok_or_else(|| format!("у модели {} нет файлов", model.name))?;
            let target = target_path(file);
            if !target.is_file() {
                return Err(format!("модель {} ещё не скачана", file.filename));
            }
            target
        }
        None => {
            // A catalogue id that is really a quantisation of some model, so
            // "select q5_k_m" works the way the old flat list allowed.
            if let Some((model, file)) = entries().iter().find_map(|m| {
                m.files
                    .iter()
                    .find(|f| f.quant.eq_ignore_ascii_case(selector))
                    .map(|f| (m, f))
            }) {
                let target = target_path(file);
                if target.is_file() {
                    let mut settings = settings::load_settings();
                    settings.selected_model = Some(target.to_string_lossy().to_string());
                    settings::save_settings(&settings)?;
                    crate::handy_server::restart_server().await?;
                    return selected_model()
                        .ok_or_else(|| "модель не найдена после выбора".to_string());
                }
                return Err(format!("модель {} ещё не скачана", file.filename));
            }
            // A selector that is not a model id may be a file the user supplied.
            let candidate = PathBuf::from(selector);
            if !candidate.is_file() {
                return Err(format!("файл модели не найден: {selector}"));
            }
            candidate
        }
    };

    let mut settings = settings::load_settings();
    settings.selected_model = Some(path.to_string_lossy().to_string());
    settings::save_settings(&settings)?;

    // The engine loads the model at startup, so a change only takes effect
    // after a restart. Restarting here keeps the UI honest: picking a model and
    // getting silence would otherwise look like a broken download.
    crate::handy_server::restart_server().await?;

    selected_model().ok_or_else(|| "модель не найдена после выбора".to_string())
}

/// Reports download progress to the UI while a model is being fetched.
#[derive(Clone, Serialize)]
struct DownloadProgress {
    file_name: String,
    downloaded: u64,
    total: u64,
}

/// Downloads a catalogue model into the models directory.
///
/// Runs on a worker thread and emits `model-download-progress` events so the UI
/// can show a real progress bar instead of freezing for several gigabytes.
#[tauri::command]
pub async fn download_model(
    app: tauri::AppHandle,
    id: String,
    quant: Option<String>,
) -> Result<InstalledModel, String> {
    use tauri::Emitter;

    let model = entry(id.trim()).ok_or_else(|| format!("неизвестная модель: {id}"))?;

    // An explicit quantisation lets the UI offer the size/quality choice per
    // model; otherwise the catalogue's default is used.
    let file = match quant.as_deref().map(str::trim).filter(|q| !q.is_empty()) {
        Some(wanted) => model
            .files
            .iter()
            .find(|f| f.quant.eq_ignore_ascii_case(wanted))
            .ok_or_else(|| format!("у модели {} нет варианта {wanted}", model.name))?,
        None => default_file_of(model)
            .ok_or_else(|| format!("у модели {} нет файлов", model.name))?,
    };

    let app_handle = app.clone();
    let progress_name = file.filename.clone();
    let model_id = model.id.clone();
    let quant_label = file.quant.clone();

    let saved = tauri::async_runtime::spawn_blocking(move || {
        let mut last_emit = std::time::Instant::now();
        let result = download(model, file, &mut |downloaded, total| {
            // Throttle to ~10 Hz: emitting per 1 MB chunk would flood the
            // WebView with events the UI cannot render faster than this.
            if last_emit.elapsed() < std::time::Duration::from_millis(100) {
                return;
            }
            last_emit = std::time::Instant::now();
            let _ = app_handle.emit(
                "model-download-progress",
                DownloadProgress {
                    file_name: progress_name.clone(),
                    downloaded,
                    total,
                },
            );
        });
        result
    })
    .await
    .map_err(|e| format!("загрузка прервана: {e}"))??;

    let saved_name = saved
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| file.filename.clone());

    Ok(InstalledModel {
        model_id: Some(model_id),
        quant: Some(quant_label),
        size_bytes: std::fs::metadata(&saved).map(|m| m.len()).unwrap_or(0),
        path: saved.to_string_lossy().to_string(),
        file_name: saved_name,
    })
}

/// Deletes a model file by name, refusing paths outside the models directory.
#[tauri::command]
pub fn delete_model(file_name: String) -> Result<Vec<InstalledModel>, String> {
    delete(&file_name)?;

    // Clearing the selection keeps the engine from being pointed at a file
    // that no longer exists.
    let mut settings = settings::load_settings();
    if settings
        .selected_model
        .as_deref()
        .is_some_and(|p| p.ends_with(&file_name))
    {
        settings.selected_model = None;
        settings::save_settings(&settings)?;
    }

    Ok(list_installed())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_catalogue_parses_and_is_not_empty() {
        // The file is embedded at compile time and parsed on first use; a
        // malformed entry would otherwise panic at runtime inside the app.
        let all = entries();
        assert!(all.len() > 20, "catalogue looks truncated: {}", all.len());
    }

    #[test]
    fn every_entry_is_complete_enough_to_offer_and_download() {
        for model in entries() {
            assert!(!model.id.is_empty(), "entry without id: {model:?}");
            assert!(!model.family.is_empty(), "{}: no family", model.id);
            assert!(
                !model.revision.is_empty(),
                "{}: no pinned revision",
                model.id
            );
            assert!(!model.files.is_empty(), "{}: no files", model.id);
            assert!(
                model.files.iter().any(|f| f.filename == model.default_file),
                "{}: default file {} is not in the file list",
                model.id,
                model.default_file
            );
        }
    }

    #[test]
    fn every_file_has_a_size_and_a_sha256() {
        // Both are mandatory: the size drives the progress bar and the digest
        // is the only thing standing between the user and a corrupt download.
        for model in entries() {
            for file in &model.files {
                assert!(
                    file.size_bytes > 1_000_000,
                    "{}/{}: implausible size {}",
                    model.id,
                    file.filename,
                    file.size_bytes
                );
                assert_eq!(
                    file.sha256.len(),
                    64,
                    "{}/{}: not a SHA-256",
                    model.id,
                    file.filename
                );
                assert!(file.sha256.chars().all(|c| c.is_ascii_hexdigit()));
                assert!(file.filename.ends_with(".gguf"));
            }
        }
    }

    #[test]
    fn quantisations_are_ordered_smallest_first() {
        // The UI lists them in order; a mis-sorted list makes the size/quality
        // trade-off unreadable.
        for model in entries() {
            let sizes: Vec<u64> = model.files.iter().map(|f| f.size_bytes).collect();
            let mut sorted = sizes.clone();
            sorted.sort_unstable();
            assert_eq!(sizes, sorted, "{}: files not sorted", model.id);
        }
    }

    #[test]
    fn the_model_that_used_to_ship_is_still_offered() {
        // An existing install already has this exact file on disk; it must be
        // recognised rather than re-downloaded, and it must stay selectable.
        let model = entry("nemotron-3.5-asr-streaming-0.6b").expect("model must exist");
        assert!(model.recommended, "it should still be the default suggestion");
        let file = model
            .files
            .iter()
            .find(|f| f.quant == "Q8_0")
            .expect("Q8_0 must be offered");
        assert_eq!(
            file.sha256,
            "b94545b313b3223fda7b2857a52681da813935c2127643d1e9ff0c23d988089c"
        );
    }

    #[test]
    fn download_urls_are_pinned_to_a_commit_not_a_branch() {
        for model in entries() {
            let file = default_file_of(model).expect("default file");
            let url = download_url(model, file);
            assert!(
                url.contains(&model.revision),
                "{}: url does not pin the revision: {url}",
                model.id
            );
            assert!(
                !url.contains("/main/"),
                "{}: branch urls are not reproducible",
                model.id
            );
            assert!(url.starts_with("https://huggingface.co/"));
        }
    }

    #[test]
    fn recommended_models_come_first() {
        // The ordering is what the UI leans on for its default presentation.
        let recommended: Vec<bool> = entries().iter().map(|m| m.recommended).collect();
        let first_non_recommended = recommended.iter().position(|r| !r);
        if let Some(index) = first_non_recommended {
            assert!(
                !recommended[index..].iter().any(|r| *r),
                "recommended models must not be scattered after the others"
            );
        }
    }

    #[test]
    fn families_are_among_the_ones_the_engine_loads() {
        // Offering a model the engine cannot load would download gigabytes and
        // then fail with "unsupported architecture".
        const SUPPORTED: &[&str] = &[
            "whisper",
            "parakeet",
            "canary",
            "cohere",
            "voxtral",
            "moonshine",
            "granite",
            "qwen3",
            "gigaam",
            "sensevoice",
            "medasr",
            "moss",
            "nemotron",
            "fun-asr",
            "breeze",
        ];
        for model in entries() {
            assert!(
                SUPPORTED.contains(&model.family.as_str()),
                "{}: family {} is not loadable by the engine",
                model.id,
                model.family
            );
        }
    }

    #[test]
    fn deleting_outside_the_models_directory_is_refused() {
        // Traversal must not escape the models directory.
        let err = delete("../../../etc/passwd").expect_err("traversal must fail");
        assert!(!err.is_empty());
    }
}
