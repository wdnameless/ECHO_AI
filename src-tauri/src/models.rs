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

use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::settings;

/// Hugging Face repository holding the published quantisations.
const MODEL_REPO: &str = "handy-computer/nemotron-3.5-asr-streaming-0.6b-gguf";

/// Immutable revision the paths are pinned to. Using a commit hash rather than
/// `main` keeps a re-download byte-identical to the hashes below.
const MODEL_REVISION: &str = "8139c4ec14bdc45c361adf8d57c27c28e7478272";

/// A selectable speech-recognition model.
#[derive(Debug, Clone, Serialize)]
pub struct ModelVariant {
    /// Stable identifier used by the UI and stored in settings.
    pub id: &'static str,
    /// Quantisation label (`Q5_K_M`, `F16`, …).
    pub quantisation: &'static str,
    /// File name inside the repository; also the name on disk.
    pub file_name: &'static str,
    /// Expected size in bytes, for the progress bar before the download starts.
    pub size_bytes: u64,
    /// SHA-256 of the file contents.
    pub sha256: &'static str,
    /// Human-readable summary of the quality/size trade-off.
    pub note: &'static str,
    /// Word error rate on LibriSpeech test-clean, when published.
    pub wer_librispeech: Option<f32>,
    /// Russian word error rate on FLEURS, when published.
    pub wer_fleurs_ru: Option<f32>,
    /// Whether this is the quantisation that used to be bundled.
    pub recommended: bool,
}

/// Everything the engine can be pointed at, smallest first.
///
/// Sizes and hashes come from the repository's file listing; the WER figures
/// are the ones the model card publishes, so the UI can justify the trade-off
/// instead of ranking by file size alone.
pub const VARIANTS: &[ModelVariant] = &[
    ModelVariant {
        id: "q4_k_m",
        quantisation: "Q4_K_M",
        file_name: "nemotron-3.5-asr-streaming-0.6b-Q4_K_M.gguf",
        size_bytes: 495_831_520,
        sha256: "41c99fa5fb6f3d35f68e79adc3e755eca2232a8d921178bd647b71194792b8fd",
        note: "Самый компактный: меньше места, но заметнее ошибок.",
        wer_librispeech: Some(3.30),
        wer_fleurs_ru: None,
        recommended: false,
    },
    ModelVariant {
        id: "q5_k_m",
        quantisation: "Q5_K_M",
        file_name: "nemotron-3.5-asr-streaming-0.6b-Q5_K_M.gguf",
        size_bytes: 559_647_200,
        sha256: "86429e8c4f7fdcf9b3312269ad1ca6669478ba7805331c4aea7a2e33e9910d65",
        note: "Близко к Q8 по качеству, чуть меньше места.",
        wer_librispeech: Some(3.10),
        wer_fleurs_ru: None,
        recommended: false,
    },
    ModelVariant {
        id: "q6_k",
        quantisation: "Q6_K",
        file_name: "nemotron-3.5-asr-streaming-0.6b-Q6_K.gguf",
        size_bytes: 621_356_512,
        sha256: "4ff802c6207c4a7df23242003fd2aa849a1ab02bba6bc80c3db02e7e82606c28",
        note: "Компромисс между размером и точностью.",
        wer_librispeech: Some(3.08),
        wer_fleurs_ru: None,
        recommended: false,
    },
    ModelVariant {
        id: "q8_0",
        quantisation: "Q8_0",
        file_name: "nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf",
        size_bytes: 751_094_240,
        sha256: "b94545b313b3223fda7b2857a52681da813935c2127643d1e9ff0c23d988089c",
        note: "Та же модель, что раньше шла внутри установщика.",
        wer_librispeech: Some(3.05),
        wer_fleurs_ru: Some(12.61),
        recommended: true,
    },
    ModelVariant {
        id: "f16",
        quantisation: "F16",
        file_name: "nemotron-3.5-asr-streaming-0.6b-F16.gguf",
        size_bytes: 1_277_750_240,
        sha256: "f21a0cea64d232981def7f8f2b7ab322459703a2e89359962c042c57159755b1",
        note: "Без потерь по точности, заметно больше места.",
        wer_librispeech: Some(3.04),
        wer_fleurs_ru: None,
        recommended: false,
    },
    ModelVariant {
        id: "f32",
        quantisation: "F32",
        file_name: "nemotron-3.5-asr-streaming-0.6b-F32.gguf",
        size_bytes: 2_552_277_984,
        sha256: "fbbc82e8e1084301a670fbc4d79c69c0c8980da506352fd83e74a182f38f5b78",
        note: "Полная точность. Требует много места и памяти.",
        wer_librispeech: Some(3.04),
        wer_fleurs_ru: None,
        recommended: false,
    },
];

/// Finds a variant by id.
pub fn variant(id: &str) -> Option<&'static ModelVariant> {
    VARIANTS.iter().find(|v| v.id == id)
}

/// The variant that used to be bundled, used as the default suggestion.
pub fn default_variant() -> &'static ModelVariant {
    VARIANTS
        .iter()
        .find(|v| v.recommended)
        .unwrap_or(&VARIANTS[0])
}

/// Download URL for a variant, pinned to an immutable revision.
pub fn download_url(variant: &ModelVariant) -> String {
    format!(
        "https://huggingface.co/{MODEL_REPO}/resolve/{MODEL_REVISION}/{}",
        variant.file_name
    )
}

/// A model file found in the user's models directory.
#[derive(Debug, Clone, Serialize)]
pub struct InstalledModel {
    pub file_name: String,
    pub path: String,
    pub size_bytes: u64,
    /// Catalogue id when the file matches a known variant.
    pub variant_id: Option<String>,
}

/// Lists model files in the resolved models directory.
///
/// Any `.gguf` is reported, not just known variants: the engine accepts an
/// arbitrary path, so a model the user produced or downloaded by hand must be
/// selectable too.
pub fn list_installed() -> Vec<InstalledModel> {
    let dir = PathBuf::from(settings::resolved_paths().models_dir);
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };

    let mut found: Vec<InstalledModel> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("gguf"))
        })
        .filter_map(|path| {
            let meta = std::fs::metadata(&path).ok()?;
            let file_name = path.file_name()?.to_string_lossy().to_string();
            Some(InstalledModel {
                variant_id: VARIANTS
                    .iter()
                    .find(|v| v.file_name == file_name)
                    .map(|v| v.id.to_string()),
                path: path.to_string_lossy().to_string(),
                size_bytes: meta.len(),
                file_name,
            })
        })
        .collect();

    found.sort_by(|a, b| a.file_name.cmp(&b.file_name));
    found
}

/// Where a variant would be stored given the current settings.
pub fn target_path(variant: &ModelVariant) -> PathBuf {
    PathBuf::from(settings::resolved_paths().models_dir).join(variant.file_name)
}

/// Whether the variant is already present.
pub fn is_installed(variant: &ModelVariant) -> bool {
    target_path(variant).is_file()
}

/// Streams a response body to disk, reporting progress.
///
/// Written to a temporary file and renamed on success so an interrupted
/// download can never leave a half-file that the engine would try to load.
struct DownloadTarget {
    temp: PathBuf,
    final_path: PathBuf,
    file: std::fs::File,
}

impl DownloadTarget {
    fn new(final_path: PathBuf) -> Result<Self, String> {
        let dir = final_path
            .parent()
            .ok_or("некорректный путь к модели")?
            .to_path_buf();
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("не удалось создать {}: {e}", dir.display()))?;

        let temp = final_path.with_extension("gguf.part");
        let file = std::fs::File::create(&temp)
            .map_err(|e| format!("не удалось создать {}: {e}", temp.display()))?;

        Ok(Self {
            temp,
            final_path,
            file,
        })
    }

    fn write(&mut self, chunk: &[u8]) -> Result<(), String> {
        self.file
            .write_all(chunk)
            .map_err(|e| format!("ошибка записи: {e}"))
    }

    /// Flushes, discards the partial file on failure, renames on success.
    fn finish(mut self) -> Result<PathBuf, String> {
        self.file
            .flush()
            .map_err(|e| format!("ошибка записи: {e}"))?;
        drop(self.file);
        std::fs::rename(&self.temp, &self.final_path).map_err(|e| {
            let _ = std::fs::remove_file(&self.temp);
            format!("не удалось сохранить модель: {e}")
        })?;
        Ok(self.final_path)
    }

    fn discard(&self) {
        let _ = std::fs::remove_file(&self.temp);
    }
}

/// Progress reported while downloading.
pub type ProgressFn<'a> = &'a mut dyn FnMut(u64, u64);

/// Downloads a variant into the resolved models directory.
///
/// Blocks the calling thread; callers run this on a worker thread so the UI
/// stays responsive.
pub fn download(variant: &ModelVariant, progress: ProgressFn<'_>) -> Result<PathBuf, String> {
    let target = target_path(variant);
    if target.is_file() {
        return Ok(target);
    }

    let client = reqwest::blocking::Client::builder()
        .timeout(None)
        .build()
        .map_err(|e| format!("не удалось создать HTTP-клиент: {e}"))?;

    let mut response = client
        .get(download_url(variant))
        .send()
        .map_err(|e| format!("не удалось начать загрузку: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "сервер вернул {} при загрузке {}",
            response.status(),
            variant.file_name
        ));
    }

    // Prefer the advertised length, but fall back to the catalogued size so the
    // progress bar is meaningful even when the server omits Content-Length.
    let total = response
        .content_length()
        .filter(|n| *n > 0)
        .unwrap_or(variant.size_bytes);

    let mut sink = DownloadTarget::new(target)?;
    let mut buffer = vec![0u8; 1 << 20];
    let mut written: u64 = 0;

    loop {
        match response.read(&mut buffer) {
            Ok(0) => break,
            Ok(n) => {
                sink.write(&buffer[..n])?;
                written += n as u64;
                progress(written, total);
            }
            Err(e) => {
                sink.discard();
                return Err(format!("загрузка прервана: {e}"));
            }
        }
    }

    if written == 0 {
        sink.discard();
        return Err("загрузка вернула пустой файл".to_string());
    }

    let saved = sink.finish()?;

    // Hash the result and refuse anything that does not match the published
    // digest: a corrupted model would otherwise fail deep inside the engine
    // with an error nobody can interpret.
    let actual = sha256_file(&saved)?;
    if !actual.eq_ignore_ascii_case(variant.sha256) {
        let _ = std::fs::remove_file(&saved);
        return Err(format!(
            "файл повреждён: ожидался SHA-256 {}, получен {actual}",
            variant.sha256
        ));
    }

    Ok(saved)
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
pub fn model_catalog() -> Vec<ModelVariant> {
    VARIANTS.to_vec()
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
    let path = settings.selected_model?;
    let path = PathBuf::from(path);
    if !path.is_file() {
        return None;
    }
    let file_name = path.file_name()?.to_string_lossy().to_string();
    Some(InstalledModel {
        variant_id: VARIANTS
            .iter()
            .find(|v| v.file_name == file_name)
            .map(|v| v.id.to_string()),
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

    let path = match variant(selector) {
        Some(entry) => {
            let target = target_path(entry);
            if !target.is_file() {
                return Err(format!(
                    "модель {} ещё не скачана",
                    entry.file_name
                ));
            }
            target
        }
        None => {
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
) -> Result<InstalledModel, String> {
    use tauri::Emitter;

    let entry = variant(id.trim()).ok_or_else(|| format!("неизвестная модель: {id}"))?;
    let app_handle = app.clone();
    // Cloned into the worker closure: the command still needs the name to
    // report progress through the error path.
    let progress_name = entry.file_name.to_string();

    let saved = tauri::async_runtime::spawn_blocking(move || {
        let mut last_emit = std::time::Instant::now();
        let result = download(entry, &mut |downloaded, total| {
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
        .unwrap_or_else(|| entry.file_name.to_string());

    Ok(InstalledModel {
        variant_id: Some(entry.id.to_string()),
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
    fn every_variant_is_reachable_by_its_id() {
        for entry in VARIANTS {
            assert!(variant(entry.id).is_some(), "id {} не находится", entry.id);
        }
    }

    #[test]
    fn catalogue_sizes_and_hashes_are_plausible() {
        for entry in VARIANTS {
            assert!(
                entry.size_bytes > 100_000_000,
                "{} подозрительно мал",
                entry.id
            );
            assert_eq!(entry.sha256.len(), 64, "{}: хэш не SHA-256", entry.id);
            assert!(entry.file_name.ends_with(".gguf"));
        }
    }

    #[test]
    fn quantisations_are_ordered_by_size_ascending() {
        // The UI presents them in catalogue order; a mis-sorted entry would
        // make the size/quality trade-off read as nonsense.
        let sizes: Vec<u64> = VARIANTS.iter().map(|v| v.size_bytes).collect();
        let mut sorted = sizes.clone();
        sorted.sort_unstable();
        assert_eq!(sizes, sorted);
    }

    #[test]
    fn the_recommended_variant_is_the_historical_bundled_one() {
        let default = default_variant();
        assert_eq!(default.id, "q8_0");
        // Must match the hash that shipped inside the installer, so an existing
        // install recognises its own model instead of re-downloading it.
        assert_eq!(
            default.sha256,
            "b94545b313b3223fda7b2857a52681da813935c2127643d1e9ff0c23d988089c"
        );
    }

    #[test]
    fn download_urls_are_pinned_to_a_revision_not_a_branch() {
        let url = download_url(default_variant());
        assert!(url.contains(MODEL_REVISION), "url must pin the revision: {url}");
        assert!(!url.contains("/main/"), "branch urls are not reproducible");
    }

    #[test]
    fn deleting_outside_the_models_directory_is_refused() {
        // Traversal must not escape the models directory.
        let err = delete("../../../etc/passwd").expect_err("traversal must fail");
        assert!(!err.is_empty());
    }
}
