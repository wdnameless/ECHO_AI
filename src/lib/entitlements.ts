export type Feature =
  | "dictation"
  | "meeting"
  | "localStt"
  | "byoKey"
  | "chatHistory"
  | "customPrompts"
  | "hostedApi"
  | "screenshot"
  | "selectionMode"
  | "themes"
  | "fonts"
  | "customShortcuts"
  | "promptGeneration"
  | "analytics"
  | "responseLength"
  | "language"
  | "autoScroll";

export type Tier = "free" | "pro";

export const FEATURE_TIER: Record<Feature, Tier> = {
  // Free (R15) - local core навсегда
  dictation: "free",
  meeting: "free",
  localStt: "free",
  byoKey: "free",
  chatHistory: "free",
  customPrompts: "free",

  // Pro (R16) - cloud and premium conveniences
  hostedApi: "pro",
  screenshot: "pro",
  selectionMode: "pro",
  themes: "pro",
  fonts: "pro",
  customShortcuts: "pro",
  promptGeneration: "pro",
  analytics: "pro",
  responseLength: "pro",
  language: "pro",
  autoScroll: "pro",
};

export interface CanUseFeatureOpts {
  isDevBuild?: boolean;
  hasLicense?: boolean;
}

/**
 * Единая точка проверки доступности возможностей приложения.
 * Поддерживает вызов как с объектом opts: { isDevBuild?: boolean, hasLicense?: boolean },
 * так и по сигнатуре интерфейсов: canUseFeature(feature, isDevBuild, hasLicense).
 */
export function canUseFeature(
  feature: Feature,
  optsOrIsDev?: CanUseFeatureOpts | boolean,
  hasLicenseArg?: boolean
): boolean {
  let isDev = false;
  let hasLicense = false;

  if (typeof optsOrIsDev === "boolean") {
    isDev = optsOrIsDev;
    hasLicense = Boolean(hasLicenseArg);
  } else if (optsOrIsDev && typeof optsOrIsDev === "object") {
    isDev = Boolean(optsOrIsDev.isDevBuild);
    hasLicense = Boolean(optsOrIsDev.hasLicense);
  } else {
    // Default fallback to environment dev check if available
    isDev = import.meta.env.DEV ?? false;
  }

  // Dev build opens everything
  if (isDev) {
    return true;
  }

  // Free tier is always available
  if (FEATURE_TIER[feature] === "free") {
    return true;
  }

  // Pro tier requires active license in release builds
  return hasLicense;
}

/**
 * Признак сборки для гейтов. Vite подставляет true в `vite dev` и false в
 * production-сборке, что совпадает с Rust-стороной: `check_license_status`
 * возвращает true только при `cfg!(debug_assertions)`.
 */
export function isDevBuild(): boolean {
  return import.meta.env.DEV;
}
