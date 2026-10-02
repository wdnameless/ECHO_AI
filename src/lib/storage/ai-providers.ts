import { STORAGE_KEYS } from "@/config";
import { TYPE_PROVIDER } from "@/types";
import { canonicalizeVariables } from "../functions/common.function";
import { safeLocalStorage } from "./helper";

/** Only configuration belongs in browser storage; credentials stay in the OS store. */
export function nonSecretAIProviderVariables(
  variables: Record<string, unknown> | undefined
): Record<string, string> {
  if (!variables || typeof variables !== "object" || Array.isArray(variables)) return {};
  return canonicalizeVariables(Object.fromEntries(
    Object.entries(variables).filter(([key, value]) => {
      if (typeof value !== "string") return false;
      const normalized = key.replace(/[^a-z0-9]/gi, "");
      return !/(?:apikey|token|secret|password|passwd|pwd|authorization|authentication|credentials?|signature)$/i.test(normalized) &&
        !/^(key|auth|sessionid|cookie2?)$/i.test(normalized);
    })
  ) as Record<string, string>);
}

export function getAIProviderVariables(providerId: string): Record<string, string> {
  try {
    const map = JSON.parse(safeLocalStorage.getItem(STORAGE_KEYS.AI_PROVIDER_VARIABLES) || "{}");
    return nonSecretAIProviderVariables(map?.[providerId]);
  } catch {
    return {};
  }
}

export function setAIProviderVariables(
  providerId: string,
  variables: Record<string, string>
): void {
  if (!providerId) return;
  let map: Record<string, Record<string, string>> = {};
  try {
    const parsed = JSON.parse(safeLocalStorage.getItem(STORAGE_KEYS.AI_PROVIDER_VARIABLES) || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      map = Object.fromEntries(Object.entries(parsed).map(([id, vars]) =>
        [id, nonSecretAIProviderVariables(vars as Record<string, unknown>)]
      ));
    }
  } catch { /* Invalid storage is replaced by the next valid configuration. */ }
  safeLocalStorage.setItem(STORAGE_KEYS.AI_PROVIDER_VARIABLES, JSON.stringify({
    ...map, [providerId]: nonSecretAIProviderVariables(variables),
  }));
}

export function getCustomAiProviders(): TYPE_PROVIDER[] {
  try {
    if (typeof window === "undefined") return [];
    const saved = localStorage.getItem(STORAGE_KEYS.CUSTOM_AI_PROVIDERS);
    if (!saved) return [];
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p: any) => p.id && p.isCustom && typeof p.curl === "string"
    );
  } catch (error) {
    console.error("Error retrieving custom AI providers:", error);
    return [];
  }
}

export function setCustomAiProviders(providers: TYPE_PROVIDER[]): void {
  try {
    if (typeof window === "undefined") return;
    localStorage.setItem(
      STORAGE_KEYS.CUSTOM_AI_PROVIDERS,
      JSON.stringify(providers)
    );
  } catch (error) {
    console.error("Error setting custom AI providers:", error);
  }
}

export function addCustomAiProvider(
  newProvider: Omit<TYPE_PROVIDER, "id" | "isCustom">
): TYPE_PROVIDER | null {
  try {
    const providers = getCustomAiProviders();
    const id = `custom-${Date.now()}-${Math.random()
      .toString(36)
      .substr(2, 9)}`;
    const provider: TYPE_PROVIDER = {
      ...newProvider,
      id,
      isCustom: true,
    };
    providers.push(provider);
    setCustomAiProviders(providers);
    return provider;
  } catch (error) {
    console.error("Error adding custom AI provider:", error);
    return null;
  }
}

export function updateCustomAiProvider(
  id: string,
  updates: Partial<TYPE_PROVIDER>
): boolean {
  try {
    const providers = getCustomAiProviders();
    const index = providers.findIndex((p) => p.id === id && p.isCustom);
    if (index === -1) return false;
    providers[index] = { ...providers[index], ...updates };
    setCustomAiProviders(providers);
    return true;
  } catch (error) {
    console.error("Error updating custom AI provider:", error);
    return false;
  }
}

export function removeCustomAiProvider(id: string): boolean {
  try {
    const providers = getCustomAiProviders();
    const filtered = providers.filter((p) => p.id !== id);
    if (filtered.length === providers.length) return false; // No removal happened
    setCustomAiProviders(filtered);
    return true;
  } catch (error) {
    console.error("Error removing custom AI provider:", error);
    return false;
  }
}
