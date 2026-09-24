import { invoke } from "@tauri-apps/api/core";
import { resetAsrBaseUrlCache } from "../asr-discovery";
import { resetAsrCapabilitiesCache } from "../asr-capabilities";

/**
 * Locations of the engine, models and logs, as resolved by the backend.
 *
 * `root` is either a directory the user controls (portable mode) or the
 * per-user application data directory. `writable` is a real write probe, not a
 * permission guess — a read-only root cannot hold downloaded models.
 */
export interface ResolvedPaths {
  root: string;
  root_kind: "portable" | "appdata";
  engine_dir: string;
  models_dir: string;
  logs_dir: string;
  settings_path: string;
  /** Secrets file in use, resolved the same way as the database. */
  secrets_path: string;
  /** Names of the files consolidated when portable mode was switched on. */
  moved?: string[];
  writable: boolean;
}

/** Capabilities reported by the model card. */
export interface ModelCapabilities {
  streaming: boolean;
  translate: boolean;
  lang_detect: boolean;
  timestamps: string;
}

/** One downloadable quantisation of a model. */
export interface ModelFile {
  filename: string;
  quant: string;
  size_bytes: number;
  sha256: string;
}

/** A model the user can download, with the published quality figures. */
export interface ModelEntry {
  id: string;
  repo: string;
  revision: string;
  family: string;
  name: string;
  description: string;
  parameters: string;
  language_count: number;
  languages: string[];
  capabilities: ModelCapabilities;
  /** 0-100, derived from the published real-time factor. */
  speed_score: number | null;
  /** 0-100, derived from the published word error rate. */
  accuracy_score: number | null;
  wer: number | null;
  wer_set: string | null;
  files: ModelFile[];
  default_file: string;
  recommended: boolean;
}

/** A model file present in the models directory. */
export interface InstalledModel {
  file_name: string;
  path: string;
  size_bytes: number;
  model_id: string | null;
  quant: string | null;
}

/** Progress payload emitted while a model downloads. */
export interface ModelDownloadProgress {
  file_name: string;
  downloaded: number;
  total: number;
}

export const getPaths = () => invoke<ResolvedPaths>("get_paths");

/**
 * Applies user-chosen directories. Empty strings clear an override rather than
 * creating a directory whose name is whitespace.
 */
export const setPaths = (paths: {
  data_root?: string | null;
  engine_dir?: string | null;
  models_dir?: string | null;
  logs_dir?: string | null;
}) => {
  const payload: Record<string, string | null> = {};
  if (paths.data_root !== undefined) payload.dataRoot = paths.data_root;
  if (paths.engine_dir !== undefined) payload.engineDir = paths.engine_dir;
  if (paths.models_dir !== undefined) payload.modelsDir = paths.models_dir;
  if (paths.logs_dir !== undefined) payload.logsDir = paths.logs_dir;
  return invoke<ResolvedPaths>("set_paths", payload);
};

/** Opens the native folder picker; resolves to `null` when cancelled. */
export const pickDirectory = (title?: string) =>
  invoke<string | null>("pick_directory", { title: title ?? null });

/** Switches to a directory next to the executable and returns the new layout. */
export const enablePortable = () => invoke<ResolvedPaths>("enable_portable");

/** Returns to the per-user application data layout. */
export const disablePortable = () => invoke<ResolvedPaths>("disable_portable");

export const getStartMinimized = () => invoke<boolean>("get_start_minimized");

export const setStartMinimized = (enabled: boolean) =>
  invoke<void>("set_start_minimized", { enabled });

/** Catalogue entries with their files, sizes, hashes and quality figures. */
export const modelCatalog = () => invoke<ModelEntry[]>("model_catalog");

/** Model files currently on disk. */
export const listModels = () => invoke<InstalledModel[]>("list_models");

/** The model the engine is pointed at, if it still exists. */
export const selectedModel = () =>
  invoke<InstalledModel | null>("selected_model");

/**
 * Downloads a model. Progress arrives as `model-download-progress` events; the
 * promise settles when the file is on disk and hash-verified. `quant` picks a
 * specific quantisation, otherwise the catalogue default is used.
 */
export const downloadModel = (id: string, quant?: string) =>
  invoke<InstalledModel>("download_model", { id, quant: quant ?? null });

/**
 * Selects a model by catalogue id or by absolute path, then restarts the engine.
 *
 * Both cached answers about the engine are dropped here: its port can change on
 * restart, and a different model may or may not implement the streaming
 * protocol. Keeping either cache meant the app kept using the previous model's
 * path — opening a socket a non-streamable model rejects, or skipping the socket
 * for one that needs it.
 */
export const selectModel = async (idOrPath: string) => {
  const model = await invoke<InstalledModel>("select_model", { idOrPath });
  resetAsrBaseUrlCache();
  resetAsrCapabilitiesCache();
  return model;
};

/** Deletes a model file; returns the remaining models. */
export const deleteModel = (fileName: string) =>
  invoke<InstalledModel[]>("delete_model", { fileName });

/** Formats a byte count for display. */
export function formatSize(bytes: number): string {
  if (bytes >= 1024 ** 3) {
    return `${(bytes / 1024 ** 3).toFixed(2)} ГБ`;
  }
  if (bytes >= 1024 ** 2) {
    return `${(bytes / 1024 ** 2).toFixed(0)} МБ`;
  }
  return `${(bytes / 1024).toFixed(0)} КБ`;
}

/** Whether speech recognition can run, and what is missing when it cannot. */
export interface SttReadiness {
  engine_running: boolean;
  model_found: boolean;
  model_path: string | null;
  models_dir: string;
  reason: string | null;
}

export const sttReadiness = () => invoke<SttReadiness>("stt_readiness");
