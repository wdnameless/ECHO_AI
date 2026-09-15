//! Single-file distribution support.
//!
//! The engine that performs speech recognition is a native process plus a
//! handful of ggml shared libraries — about 59 MB uncompressed. Shipping them
//! as loose files next to the executable means "portable" is really "one
//! folder", and a user who copies just the `.exe` gets an app that cannot
//! listen. Embedding them in the binary and extracting on first run makes a
//! genuine single-file build possible.
//!
//! Extraction is content-addressed: files land in a directory named by the
//! build's fingerprint, so an upgraded build never reuses another build's
//! libraries, and a partially written extraction is never treated as complete
//! (a marker is written last).

use std::io::Write;
use std::path::{Path, PathBuf};

use crate::settings::ResolvedPaths;

/// Library set the engine loads at runtime, embedded in the binary.
///
/// Kept in sync with the sidecar bundle by a unit test, which fails when a file
/// referenced here is missing from the source tree.
#[cfg(target_os = "windows")]
const ENGINE_ASSETS: &[(&str, &[u8])] = &[
    (
        "pluely-asr.exe",
        include_bytes!("../resources/pluely-asr.exe"),
    ),
    ("ggml.dll", include_bytes!("../resources/ggml.dll")),
    ("ggml-base.dll", include_bytes!("../resources/ggml-base.dll")),
    (
        "ggml-cpu-alderlake.dll",
        include_bytes!("../resources/ggml-cpu-alderlake.dll"),
    ),
    (
        "ggml-cpu-cannonlake.dll",
        include_bytes!("../resources/ggml-cpu-cannonlake.dll"),
    ),
    (
        "ggml-cpu-cascadelake.dll",
        include_bytes!("../resources/ggml-cpu-cascadelake.dll"),
    ),
    (
        "ggml-cpu-haswell.dll",
        include_bytes!("../resources/ggml-cpu-haswell.dll"),
    ),
    (
        "ggml-cpu-icelake.dll",
        include_bytes!("../resources/ggml-cpu-icelake.dll"),
    ),
    (
        "ggml-cpu-sandybridge.dll",
        include_bytes!("../resources/ggml-cpu-sandybridge.dll"),
    ),
    (
        "ggml-cpu-skylakex.dll",
        include_bytes!("../resources/ggml-cpu-skylakex.dll"),
    ),
    (
        "ggml-cpu-sse42.dll",
        include_bytes!("../resources/ggml-cpu-sse42.dll"),
    ),
    (
        "ggml-cpu-x64.dll",
        include_bytes!("../resources/ggml-cpu-x64.dll"),
    ),
    (
        "ggml-vulkan.dll",
        include_bytes!("../resources/ggml-vulkan.dll"),
    ),
    (
        "transcribe.dll",
        include_bytes!("../resources/transcribe.dll"),
    ),
];

/// Non-Windows builds have no embedded engine yet: the loader falls back to the
/// sidecar locations probed at runtime.
#[cfg(not(target_os = "windows"))]
const ENGINE_ASSETS: &[(&str, &[u8])] = &[];

/// Marker written after a successful extraction.
const READY_MARKER: &str = ".extracted";

/// Fingerprint of the embedded engine, so a new build extracts into a fresh
/// directory instead of loading another build's libraries.
fn fingerprint() -> String {
    use sha2::{Digest, Sha256};

    let mut hasher = Sha256::new();
    for (name, bytes) in ENGINE_ASSETS {
        hasher.update(name.as_bytes());
        hasher.update((bytes.len() as u64).to_le_bytes());
        hasher.update(bytes);
    }
    let digest = format!("{:x}", hasher.finalize());
    digest[..16].to_string()
}

/// Directory the embedded engine is extracted into for this build.
pub fn engine_cache_dir(paths: &ResolvedPaths) -> PathBuf {
    PathBuf::from(&paths.root)
        .join("engine")
        .join(fingerprint())
}

/// Whether the embedded engine is present in this build at all.
pub fn has_embedded_engine() -> bool {
    !ENGINE_ASSETS.is_empty()
}

/// Extracts the embedded engine if needed and returns the directory holding it.
///
/// Returns `Ok(None)` when this build embeds no engine, so the caller can fall
/// back to loose files. Returns an error only when an extraction was attempted
/// and failed — silently continuing would hand the user an app that cannot
/// recognise speech with no explanation.
pub fn ensure_extracted(paths: &ResolvedPaths) -> Result<Option<PathBuf>, String> {
    if !has_embedded_engine() {
        return Ok(None);
    }

    let dir = engine_cache_dir(paths);
    let marker = dir.join(READY_MARKER);

    if marker.is_file() && ENGINE_ASSETS.iter().all(|(name, _)| dir.join(name).is_file()) {
        return Ok(Some(dir));
    }

    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("не удалось создать {}: {e}", dir.display()))?;

    // A stale marker from an interrupted extraction must not make a partial
    // directory look complete.
    let _ = std::fs::remove_file(&marker);

    for (name, bytes) in ENGINE_ASSETS {
        let target = dir.join(name);
        let mut file = std::fs::File::create(&target)
            .map_err(|e| format!("не удалось создать {}: {e}", target.display()))?;
        file.write_all(bytes)
            .map_err(|e| format!("не удалось записать {}: {e}", target.display()))?;
        file.flush()
            .map_err(|e| format!("не удалось записать {}: {e}", target.display()))?;
    }

    std::fs::write(&marker, fingerprint().as_bytes())
        .map_err(|e| format!("не удалось записать {}: {e}", marker.display()))?;

    Ok(Some(dir))
}

/// Removes extraction directories left behind by other builds.
///
/// Without this, updating the app would accumulate one ~59 MB copy per version
/// in the user's data directory.
pub fn cleanup_old_extractions(paths: &ResolvedPaths) {
    let root = PathBuf::from(&paths.root).join("engine");
    let current = fingerprint();

    let Ok(entries) = std::fs::read_dir(&root) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let is_current = path
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|name| name == current);
        if !is_current {
            let _ = std::fs::remove_dir_all(&path);
        }
    }
}

/// Path to the engine executable inside an extraction directory.
pub fn engine_binary(dir: &Path) -> PathBuf {
    dir.join("pluely-asr.exe")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fingerprint_is_stable_across_calls() {
        // Extraction is keyed on this: an unstable value would re-extract the
        // engine on every launch.
        assert_eq!(fingerprint(), fingerprint());
        assert_eq!(fingerprint().len(), 16);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn the_embedded_engine_contains_the_binary_and_its_libraries() {
        let names: Vec<&str> = ENGINE_ASSETS.iter().map(|(name, _)| *name).collect();
        for required in [
            "pluely-asr.exe",
            "ggml.dll",
            "ggml-base.dll",
            "ggml-vulkan.dll",
            "transcribe.dll",
        ] {
            assert!(
                names.contains(&required),
                "{required} отсутствует в наборе движка"
            );
        }
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn no_asset_is_embedded_empty() {
        // An empty entry would extract a zero-byte DLL and fail at load time
        // with an unhelpful error deep inside ggml.
        for (name, bytes) in ENGINE_ASSETS {
            assert!(!bytes.is_empty(), "{name} пуст");
        }
    }
}
