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

export interface SequentialSecretWriterOptions {
  /** Debounce delay in milliseconds (default: 500ms). */
  debounceMs?: number;
  /** Custom persistence writer (defaults to saveSecret). */
  saveFn?: (key: string, value: string) => Promise<void>;
  /** Custom removal handler (defaults to removeSecret). */
  removeFn?: (key: string) => Promise<void>;
}

/**
 * Guarded sequential writer for secrets (R12).
 * Guarantees:
 * 1. Debounced writes: rapid input does not hit disk/IPC on every keystroke.
 * 2. Strict serialization + monotonic sequence: writes to the same key never race or overwrite newer values.
 * 3. Flush on blur/unmount: pending secrets are never lost when changing focus or unmounting.
 */
export class SequentialSecretWriter {
  private readonly debounceMs: number;
  private readonly saveFn: (key: string, value: string) => Promise<void>;
  private readonly removeFn: (key: string) => Promise<void>;

  private seqCounter = 0;
  private pending = new Map<string, { value: string; seq: number }>();
  private timers = new Map<string, number | NodeJS.Timeout>();
  private lastExecutedSeqs = new Map<string, number>();
  private activePromises = new Map<string, Promise<void>>();
  constructor(options: SequentialSecretWriterOptions = {}) {
    this.debounceMs = options.debounceMs ?? 500;
    this.saveFn = options.saveFn ?? saveSecret;
    this.removeFn = options.removeFn ?? removeSecret;
  }

  /** Schedule a write. If immediate is true, flushes without waiting for debounce. */
  write(key: string, value: string, immediate: boolean = false): void {
    if (!key) return;

    this.seqCounter += 1;
    const currentSeq = this.seqCounter;
    this.pending.set(key, { value, seq: currentSeq });

    const existingTimer = this.timers.get(key);
    if (existingTimer !== undefined) {
      clearTimeout(existingTimer);
      this.timers.delete(key);
    }

    if (immediate) {
      void this.flush(key);
    } else {
      const timer = setTimeout(() => {
        this.timers.delete(key);
        void this.flush(key);
      }, this.debounceMs);
      this.timers.set(key, timer);
    }
  }

  /** Flush pending writes immediately. If targetKey is omitted, flushes all keys. */
  async flush(targetKey?: string): Promise<void> {
    if (targetKey !== undefined) {
      await this.flushKey(targetKey);
      return;
    }

    const keysToFlush = Array.from(
      new Set([
        ...this.pending.keys(),
        ...this.timers.keys(),
        ...this.activePromises.keys(),
      ])
    );
    await Promise.all(keysToFlush.map((k) => this.flushKey(k)));
  }

  private async flushKey(key: string): Promise<void> {
    const existingTimer = this.timers.get(key);
    if (existingTimer !== undefined) {
      clearTimeout(existingTimer);
      this.timers.delete(key);
    }

    const itemToExecute = this.pending.get(key);
    if (!itemToExecute) {
      const active = this.activePromises.get(key);
      if (active) await active;
      return;
    }

    this.pending.delete(key);

    const execute = async () => {
      const lastSeq = this.lastExecutedSeqs.get(key) ?? 0;
      if (itemToExecute.seq <= lastSeq) {
        return;
      }

      const trimmed = itemToExecute.value.trim();
      try {
        if (trimmed) {
          await this.saveFn(key, trimmed);
        } else {
          await this.removeFn(key);
        }
        this.lastExecutedSeqs.set(key, itemToExecute.seq);
      } catch (err) {
        console.error(`[SequentialSecretWriter] failed to persist secret for ${key}:`, err);
      }
    };

    const previousPromise = this.activePromises.get(key);
    const nextPromise = (async () => {
      if (previousPromise) {
        try {
          await previousPromise;
        } catch {
          // Ignore previous error to avoid blocking the queue
        }
      }
      await execute();
      const nextPending = this.pending.get(key);
      const currentLastSeq = this.lastExecutedSeqs.get(key) ?? 0;
      if (nextPending && nextPending.seq > currentLastSeq) {
        await this.flushKey(key);
      }
    })();

    this.activePromises.set(key, nextPromise);
    try {
      await nextPromise;
    } finally {
      if (this.activePromises.get(key) === nextPromise) {
        this.activePromises.delete(key);
      }
    }
  }

  /** Cancel pending writes without flushing. */
  cancel(targetKey?: string): void {
    if (targetKey !== undefined) {
      const timer = this.timers.get(targetKey);
      if (timer !== undefined) {
        clearTimeout(timer);
        this.timers.delete(targetKey);
      }
      this.pending.delete(targetKey);
      return;
    }

    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.pending.clear();
  }

  /** Clean up by flushing all pending writes and clearing timers. */
  async dispose(): Promise<void> {
    await this.flush();
  }

  getPending(key: string): { value: string; seq: number } | undefined {
    return this.pending.get(key);
  }

  getLastExecutedSeq(key: string): number {
    return this.lastExecutedSeqs.get(key) ?? 0;
  }
}

/**
 * Matches a literal bearer token inside a curl template.
 *
 * Placeholders (`{{API_KEY}}`) are excluded by the negative lookahead so an already
 * migrated template is left untouched.
 */
const LITERAL_BEARER = /(Bearer\s+)(?!\{\{)([^\s"'\\]+)/i;

/**
 * Auth headers that carry a key of their own (`x-api-key: sk-...`), which the
 * bearer pattern never saw: those templates kept a plaintext key in localStorage
 * while the sweep reported nothing to move.
 */
const LITERAL_AUTH_HEADER =
  /(-H\s+["']?(?:x-api-key|api-key|xi-api-key|openai-api-key)\s*:\s*)(?!\{\{)([^\s"']+)/i;

/** True when the template carries a real key instead of the placeholder. */
export function curlHasLiteralSecret(curl: string): boolean {
  return LITERAL_BEARER.test(curl || "") || LITERAL_AUTH_HEADER.test(curl || "");
}

/**
 * Moves a key that a curl template carries in plaintext into the secure store.
 *
 * Returns the sanitized template and the key that was found. Providers are stored
 * in localStorage, so a key embedded there is readable by anything running in the
 * webview — the whole point of keeping secrets out of it.
 */
export function extractLiteralSecret(curl: string): {
  curl: string;
  secret: string | null;
} {
  const source = curl || "";
  const bearer = LITERAL_BEARER.exec(source);
  if (bearer) {
    return {
      curl: source.replace(LITERAL_BEARER, "$1{{API_KEY}}"),
      secret: bearer[2],
    };
  }

  const header = LITERAL_AUTH_HEADER.exec(source);
  if (header) {
    return {
      curl: source.replace(LITERAL_AUTH_HEADER, "$1{{API_KEY}}"),
      secret: header[2],
    };
  }

  return { curl, secret: null };
}

/** Flag for the one-time curl-template sweep, separate from the variables sweep. */
const CURL_MIGRATION_FLAG = "curl_literal_secrets_migrated_v1";

/**
 * One-time sweep over stored custom AI providers.
 *
 * The older visual form wrote the key the user typed straight into the generated
 * curl, so those providers keep a plaintext key in localStorage until something
 * rewrites the template. Rewriting it requires no user action.
 */
export async function migrateCurlLiteralsToSecrets(): Promise<number> {
  if (safeLocalStorage.getItem(CURL_MIGRATION_FLAG) === "true") return 0;

  const raw = safeLocalStorage.getItem(STORAGE_KEYS.CUSTOM_AI_PROVIDERS);
  if (!raw) {
    safeLocalStorage.setItem(CURL_MIGRATION_FLAG, "true");
    return 0;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return 0;
  }
  if (!Array.isArray(parsed)) return 0;

  let migrated = 0;
  let changed = false;
  const pending: Promise<void>[] = [];
  const next = (parsed as Array<Record<string, unknown>>).map((entry) => {
    const id = typeof entry?.id === "string" ? entry.id : null;
    const curl = typeof entry?.curl === "string" ? entry.curl : "";
    if (!id || !curlHasLiteralSecret(curl)) return entry;
    const { curl: sanitized, secret } = extractLiteralSecret(curl);
    if (secret) {
      pending.push(saveSecret(secretKey.aiProvider(id), secret));
      migrated += 1;
      changed = true;
    }
    return { ...entry, curl: sanitized };
  });

  await Promise.all(pending);
  if (changed) {
    safeLocalStorage.setItem(STORAGE_KEYS.CUSTOM_AI_PROVIDERS, JSON.stringify(next));
  }
  safeLocalStorage.setItem(CURL_MIGRATION_FLAG, "true");
  return migrated;
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
  safeLocalStorage.removeItem(CURL_MIGRATION_FLAG);
}
