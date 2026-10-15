import { safeLocalStorage } from "../storage";
import { STORAGE_KEYS } from "@/config";

// Helper function to check if Echo AI API should be used
export async function shouldUsePluelyAPI(): Promise<boolean> {
  try {
    // Check if Echo AI API is enabled in localStorage
    return safeLocalStorage.getItem(STORAGE_KEYS.PLUELY_API_ENABLED) === "true";
  } catch (error) {
    console.warn("Failed to check Echo AI API availability:", error);
    return false;
  }
}
