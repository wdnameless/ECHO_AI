import { isTrustedHost, trustHost, normalizeHost } from "./trusted-hosts";
/**
 * S2: шлюз подтверждения для исходящих запросов на недоверенный хост.
 *
 * Запросы к AI-провайдерам стриминговые, поэтому блокирующий диалог посреди
 * потока недопустим: подтверждение запрашивается ДО отправки, а шлюз
 * возвращает решение в виде промиса.
 *
 * Если UI-слушатель не зарегистрирован (headless-вызов, тест), шлюз
 * закрывается: запрос не отправляется. Fail closed — ключ не может утечь
 * на чужой хост молча.
 */

export interface HostTrustRequest {
  host: string;
  secrets: string[];
}

export type HostTrustDecision = "trust" | "without-secrets" | "deny";

type TrustPrompt = (request: HostTrustRequest) => Promise<HostTrustDecision>;

let promptHandler: TrustPrompt | null = null;

/**
 * Регистрирует обработчик, который показывает диалог подтверждения.
 * Возвращает функцию отписки.
 */
export function setHostTrustPrompt(handler: TrustPrompt): () => void {
  promptHandler = handler;
  return () => {
    if (promptHandler === handler) {
      promptHandler = null;
    }
  };
}

/** Имена заголовков, несущих учётные данные. */
const SECRET_HEADER_PATTERN =
  /^(authorization|cookie|cookie2|proxy-authorization|www-authenticate)$|api[_-]?key|token|secret|auth/i;
/**
 * Возвращает имена заголовков, содержащих учётные данные, без их значений.
 * Значения в диалог не попадают никогда.
 */
export function listSecretHeaders(headers: Record<string, string>): string[] {
  return Object.keys(headers).filter((name) => SECRET_HEADER_PATTERN.test(name.trim()));
}

function isCredentialField(name: string): boolean {
  const normalized = name.replace(/[^a-z0-9]/gi, "");
  return /(?:apikey|token|secret|password|passwd|pwd|authorization|authentication|credentials?|signature)$/i.test(normalized) ||
    /^(key|auth|sessionid)$/i.test(normalized);
}

function listPayloadSecrets(body: string | FormData | null | undefined): string[] {
  const names = new Set<string>();
  const inspect = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    for (const [name, child] of Object.entries(value)) {
      if (isCredentialField(name)) names.add(`body:${name}`);
      inspect(child);
    }
  };
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    body.forEach((_value, name) => {
      if (isCredentialField(name)) names.add(`form:${name}`);
    });
  } else if (typeof body === "string") {
    try {
      inspect(JSON.parse(body));
    } catch {
      // Inspect form field names, never credential words inside message text.
      if (/^[^\s=&]+=[\s\S]*$/.test(body)) {
        new URLSearchParams(body).forEach((_value, name) => {
          if (isCredentialField(name)) names.add(`body:${name}`);
        });
      }
    }
  }
  return [...names];
}

/**
 * Проверяет хост перед отправкой и возвращает заголовки, допустимые к отправке.
 *
 * - хост доверенный → заголовки без изменений;
 * - недоверенный + подтверждение → заголовки без изменений, хост запоминается;
 * - недоверенный + отказ от ключа → секретные заголовки удалены; URL/тело с ключом запрещены;
 * - недоверенный + отмена/нет диалога → запрос запрещён (пустой результат
 *   отличает запрет от «отправки без ключа»).
 */
export async function resolveOutboundHeaders(
  url: string,
  headers: Record<string, string>,
  body?: string | FormData | null
): Promise<{ allowed: boolean; headers: Record<string, string>; maxRedirections: number }> {
  // A URL that is not absolute http(s) has no host we could trust, and asking
  // about it is how a garbage entry got into the trust list: a request URL that
  // had lost its origin (`null/v1/asr/transcribe`) fell through to the `?? url`
  // fallback below, so the dialog offered the whole URL as the "host", the user
  // pressed "trust", and `normalizeHost` stored the literal `null` in
  // `trusted_hosts`.
  //
  // This check MUST come before `isTrustedHost`: that stored `null` entry made
  // `isTrustedHost("null/v1/asr/transcribe")` true, so the broken request passed
  // the gate silently and its response was shown as speech. A scheme-less URL is
  // a broken request, not an untrusted host — fail closed.
  if (!/^https?:\/\//i.test(url.trim())) {
    return { allowed: false, headers: {}, maxRedirections: 0 };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { allowed: false, headers: {}, maxRedirections: 0 };
  }
  const payloadSecrets = listPayloadSecrets(body);
  if (parsed.username) payloadSecrets.push("URL username");
  if (parsed.password) payloadSecrets.push("URL password");
  parsed.searchParams.forEach((_value, name) => {
    if (isCredentialField(name)) payloadSecrets.push(`query:${name}`);
  });

  if (isTrustedHost(url)) {
    return { allowed: true, headers, maxRedirections: 0 };
  }

  const host = normalizeHost(url);
  if (!host) {
    return { allowed: false, headers: {}, maxRedirections: 0 };
  }

  const secrets = [...new Set([...listSecretHeaders(headers), ...payloadSecrets])];

  if (!promptHandler) {
    return { allowed: false, headers: {}, maxRedirections: 0 };
  }

  const decision = await promptHandler({ host, secrets });

  if (decision === "trust") {
    trustHost(host);
    return { allowed: true, headers, maxRedirections: 0 };
  }

  if (decision === "without-secrets") {
    if (payloadSecrets.length > 0) {
      return { allowed: false, headers: {}, maxRedirections: 0 };
    }
    const sanitized: Record<string, string> = {};
    for (const [name, value] of Object.entries(headers)) {
      if (!SECRET_HEADER_PATTERN.test(name.trim())) {
        sanitized[name] = value;
      }
    }
    return { allowed: true, headers: sanitized, maxRedirections: 0 };
  }

  return { allowed: false, headers: {}, maxRedirections: 0 };
}

/**
 * Проверяет, направлен ли редирект на другой хост.
 */
export function isCrossHostRedirect(fromUrl: string, toUrl: string): boolean {
  const fromHost = normalizeHost(fromUrl);
  const toHost = normalizeHost(toUrl);
  return Boolean(fromHost && toHost && fromHost !== toHost);
}

/**
 * Проверяет доверие к хосту при редиректе (R13).
 *
 * Если целевой хост совпадает с исходным:
 * - разрешает запрос с текущими заголовками.
 * Если целевой хост отличается (cross-host redirect):
 * - если целевой хост доверенный → заголовки сохраняются;
 * - если недоверенный: запрашивает подтверждение через promptHandler;
 *   - "trust" → запоминает хост, оставляет заголовки;
 *   - "without-secrets" → удаляет все секретные заголовки;
 *   - "deny" или нет обработчика → запрещает запрос (fail closed).
 */
export async function resolveRedirect(
  sourceUrl: string,
  targetUrl: string,
  headers: Record<string, string>
): Promise<{ allowed: boolean; headers: Record<string, string>; maxRedirections: number }> {
  let resolvedTargetUrl = targetUrl;
  try {
    resolvedTargetUrl = new URL(targetUrl, sourceUrl).toString();
  } catch {
    resolvedTargetUrl = targetUrl;
  }

  if (!isCrossHostRedirect(sourceUrl, resolvedTargetUrl)) {
    return { allowed: true, headers, maxRedirections: 0 };
  }

  return resolveOutboundHeaders(resolvedTargetUrl, headers);
}

/** Только для тестов: сброс зарегистрированного обработчика. */
export function resetHostTrustPromptForTests(): void {
  promptHandler = null;
}

/**
 * Единственный путь наружу: гейт доверия, затем запрос.
 *
 * ЗАЧЕМ ЭТО ЗДЕСЬ. Гейт был «глубоким модулем», который вызывали три раза из
 * шести: `ai-response`, `models` и `stt` его спрашивали, а веб-поиск, переводчик
 * и кнопка Test в настройках уходили в сеть напрямую через `tauriFetch`. При
 * этом `capabilities` разрешают `http://**` и `https://**`, то есть гейт —
 * единственный контроль исходящего трафика, и он не применялся. Хуже: Tavily
 * кладёт ключ в ТЕЛО запроса, а гейт умеет вырезать только заголовки.
 *
 * Обёртка переносит решение в одну точку. Забыть её можно так же, как забыть
 * вызов гейта, но теперь у модуля, которому нужна сеть, есть ровно один
 * очевидный способ её получить, и он безопасен по умолчанию: без зарегистрированного
 * обработчика подтверждения запрос не уйдёт (fail closed).
 *
 * `maxRedirections: 0` — часть контракта: иначе плагин следует за 30x и уводит
 * запрос с ключом на хост, который никто не подтверждал.
 */
export async function gatedFetch(
  url: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string | FormData | null;
    signal?: AbortSignal;
  } = {},
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>
): Promise<Response> {
  const headers = init.headers ?? {};
  const trust = await resolveOutboundHeaders(url, headers, init.body);
  if (!trust.allowed) {
    throw new Error("Запрос отменён: хост не входит в список доверенных.");
  }

  // Ленивый импорт: модуль тянет Tauri-плагин, а гейт используется и в тестах,
  // и в чистой логике доверия, где плагина нет.
  const doFetch =
    fetchImpl ??
    (await import("@tauri-apps/plugin-http")).fetch;
  init.signal?.throwIfAborted();
  return doFetch(url, {
    method: init.method ?? "GET",
    headers: trust.headers,
    body: init.body,
    signal: init.signal,
    redirect: "error",
    // Плагин читает эту опцию; браузерный fetch её игнорирует.
    maxRedirections: trust.maxRedirections,
  } as RequestInit);
}

/** Warm only the origin: provider paths, userinfo, query and body never leave. */
export async function warmProviderConnection(
  providerUrl: string,
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>
): Promise<void> {
  const parsed = new URL(providerUrl);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Provider warmup requires an HTTP(S) origin.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await gatedFetch(`${parsed.origin}/`, { signal: controller.signal }, fetchImpl);
    await response.body?.cancel();
  } finally {
    clearTimeout(timeout);
  }
}
