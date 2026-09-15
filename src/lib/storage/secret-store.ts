import { invoke } from "@tauri-apps/api/core";
import { STORAGE_KEYS } from "@/config";
import { safeLocalStorage } from "./helper";

/**
 * S4: доступ к секретам через защищённое хранилище бэкенда.
 *
 * Причина: ключи провайдеров и поисковых сервисов лежали в localStorage в
 * открытом виде, где их читает любой инжектированный скрипт. Права
 * `keychain:allow-*` были выданы, но `tauri-plugin-keychain` на desktop в
 * Rust — пустая заглушка (`Keychain<R>(AppHandle<R>)` без методов,
 * invoke_handler закомментирован), поэтому используется существующее
 * хранилище бэкенда `secure_storage.json`: файл в каталоге данных
 * приложения, за пределами WebView.
 *
 * В localStorage остаются только несекретные части настроек (id, имя,
 * модель, curl-шаблон), чтобы UI не приходилось переписывать.
 */

/** Схема ключей секретов. Значения никогда не пишутся в localStorage. */
export const secretKey = {
  aiProvider: (providerId: string) => `ai_provider:${providerId}:API_KEY`,
  sttProvider: (providerId: string) => `stt_provider:${providerId}:API_KEY`,
  webSearch: (service: "brave" | "exa" | "tavily") => `web_search:${service}`,
} as const;

interface StoredSecretItem {
  key: string;
  value: string;
}

export async function saveSecret(key: string, value: string): Promise<void> {
  if (!key) return;
  await invoke("secure_storage_save", {
    items: [{ key, value } satisfies StoredSecretItem],
  });
}

export async function getSecret(key: string): Promise<string | null> {
  if (!key) return null;
  try {
    const value = await invoke<string | null>("secure_storage_get_item", {
      key,
    });
    return value && value.length > 0 ? value : null;
  } catch (error) {
    console.warn("[secret-store] failed to read secret", error);
    return null;
  }
}

export async function removeSecret(key: string): Promise<void> {
  if (!key) return;
  await invoke("secure_storage_remove", { keys: [key] });
}

/** Метка, что миграция уже выполнена: повторно localStorage не сканируем. */
const MIGRATION_FLAG = "secrets_migrated_v1";

/** Провайдер в списке либо выбранный провайдер в настройках. */
interface MigratableProvider {
  id?: unknown;
  /** Присутствует у выбранного провайдера (SELECTED_*), а не в списке. */
  provider?: unknown;
  variables?: Record<string, unknown>;
}

/** Вынимает ключ из набора переменных провайдера, каким бы он ни был. */
function extractApiKey(variables: Record<string, unknown> | undefined): string | null {
  if (!variables) return null;
  for (const [name, value] of Object.entries(variables)) {
    if (typeof value !== "string" || !value) continue;
    const lower = name.toLowerCase();
    if (lower === "api_key" || lower === "apikey") {
      return value;
    }
  }
  return null;
}

/**
 * Убирает `API_KEY` из переменных провайдера, возвращая очищенную копию.
 * Секрет при этом не теряется — его нужно сохранить отдельно.
 */
function stripApiKey(
  variables: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (!variables) return {};
  const cleaned: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(variables)) {
    const lower = name.toLowerCase();
    if (lower !== "api_key" && lower !== "apikey") {
      cleaned[name] = value;
    }
  }
  return cleaned;
}

async function migrateProviderList(
  storageKey: string,
  keyFor: (id: string) => string
): Promise<number> {
  const raw = safeLocalStorage.getItem(storageKey);
  if (!raw) return 0;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return 0;
  }
  if (!Array.isArray(parsed)) return 0;

  let migrated = 0;
  let changed = false;
  const cleanedList = [];

  for (const entry of parsed as MigratableProvider[]) {
    const id = typeof entry?.id === "string" ? entry.id : null;
    const apiKey = extractApiKey(entry?.variables);
    if (id && apiKey) {
      await saveSecret(keyFor(id), apiKey);
      migrated += 1;
      changed = true;
      cleanedList.push({ ...entry, variables: stripApiKey(entry.variables) });
    } else {
      cleanedList.push(entry);
    }
  }

  if (changed) {
    safeLocalStorage.setItem(storageKey, JSON.stringify(cleanedList));
  }
  return migrated;
}

async function migrateSelectedProvider(
  storageKey: string,
  keyFor: (id: string) => string
): Promise<number> {
  const raw = safeLocalStorage.getItem(storageKey);
  if (!raw) return 0;

  let parsed: MigratableProvider;
  try {
    parsed = JSON.parse(raw) as MigratableProvider;
  } catch {
    return 0;
  }

  const id = typeof parsed?.provider === "string" ? parsed.provider : null;
  const apiKey = extractApiKey(parsed?.variables as Record<string, unknown>);
  if (!id || !apiKey) return 0;

  await saveSecret(keyFor(id), apiKey);
  safeLocalStorage.setItem(
    storageKey,
    JSON.stringify({ ...parsed, variables: stripApiKey(parsed.variables) })
  );
  return 1;
}

async function migrateWebSearch(): Promise<number> {
  const raw = safeLocalStorage.getItem(STORAGE_KEYS.WEB_SEARCH_SETTINGS);
  if (!raw) return 0;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return 0;
  }

  const mapping: Array<[string, "brave" | "exa" | "tavily"]> = [
    ["braveApiKey", "brave"],
    ["exaApiKey", "exa"],
    ["tavilyApiKey", "tavily"],
  ];

  let migrated = 0;
  let changed = false;
  const cleaned = { ...parsed };

  for (const [field, service] of mapping) {
    const value = parsed[field];
    if (typeof value === "string" && value) {
      await saveSecret(secretKey.webSearch(service), value);
      delete cleaned[field];
      migrated += 1;
      changed = true;
    }
  }

  if (changed) {
    safeLocalStorage.setItem(
      STORAGE_KEYS.WEB_SEARCH_SETTINGS,
      JSON.stringify(cleaned)
    );
  }

  // Ключи поиска больше не живут в localStorage, поэтому помечаем перенос
  // даже когда переносить было нечего: иначе диспетчер поиска будет заново
  // сканировать настройки на каждом запросе.
  safeLocalStorage.setItem(STORAGE_KEYS.WEB_SEARCH_KEYS_MIGRATED, "true");
  return migrated;
}

/**
 * Переносит секреты из localStorage в защищённое хранилище и удаляет их
 * оттуда. Идемпотентна: после первого успешного прохода помечается флагом,
 * чтобы не сканировать localStorage при каждом старте.
 *
 * Возвращает число перенесённых секретов.
 */
export async function migrateSecretsFromLocalStorage(): Promise<number> {
  if (safeLocalStorage.getItem(MIGRATION_FLAG) === "true") {
    return 0;
  }

  let migrated = 0;
  try {
    migrated += await migrateProviderList(
      STORAGE_KEYS.CUSTOM_AI_PROVIDERS,
      secretKey.aiProvider
    );
    migrated += await migrateProviderList(
      STORAGE_KEYS.CUSTOM_SPEECH_PROVIDERS,
      secretKey.sttProvider
    );
    migrated += await migrateSelectedProvider(
      STORAGE_KEYS.SELECTED_AI_PROVIDER,
      secretKey.aiProvider
    );
    migrated += await migrateSelectedProvider(
      STORAGE_KEYS.SELECTED_STT_PROVIDER,
      secretKey.sttProvider
    );
    migrated += await migrateWebSearch();
  } catch (error) {
    // Миграция не завершилась: флаг не ставим, попробуем при следующем старте.
    console.warn("[secret-store] secret migration incomplete", error);
    return migrated;
  }

  safeLocalStorage.setItem(MIGRATION_FLAG, "true");
  return migrated;
}

/** Только для тестов: сброс отметки о миграции. */
export function resetMigrationFlagForTests(): void {
  safeLocalStorage.removeItem(MIGRATION_FLAG);
}
