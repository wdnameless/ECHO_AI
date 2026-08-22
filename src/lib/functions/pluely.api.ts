import { invoke } from "@tauri-apps/api/core";
import { safeLocalStorage } from "../storage";
import { STORAGE_KEYS } from "@/config";

// Cached license check: `check_license_status` reads a file from disk via
// invoke on every call. Caching for 30s removes that round-trip from the
// hot path (every AI/STT request used to pay it before streaming started).
const LICENSE_CACHE_TTL_MS = 30_000;
let cachedResult: { value: boolean; at: number } | null = null;

// Helper function to check if Pluely API should be used
export async function shouldUsePluelyAPI(): Promise<boolean> {
  try {
    // Check if Pluely API is enabled in localStorage
    const pluelyApiEnabled =
      safeLocalStorage.getItem(STORAGE_KEYS.PLUELY_API_ENABLED) === "true";
    if (!pluelyApiEnabled) return false;

    if (cachedResult && Date.now() - cachedResult.at < LICENSE_CACHE_TTL_MS) {
      return cachedResult.value;
    }

    // Check if license is available
    const hasLicense = await invoke<boolean>("check_license_status");
    cachedResult = { value: hasLicense, at: Date.now() };
    return hasLicense;
  } catch (error) {
    console.warn("Failed to check Pluely API availability:", error);
    return false;
  }
}
