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

/**
 * Проверяет хост перед отправкой и возвращает заголовки, допустимые к отправке.
 *
 * - хост доверенный → заголовки без изменений;
 * - недоверенный + подтверждение → заголовки без изменений, хост запоминается;
 * - недоверенный + отказ от ключа → секретные заголовки удалены;
 * - недоверенный + отмена/нет диалога → запрос запрещён (пустой результат
 *   отличает запрет от «отправки без ключа»).
 */
export async function resolveOutboundHeaders(
  url: string,
  headers: Record<string, string>
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

  if (isTrustedHost(url)) {
    return { allowed: true, headers, maxRedirections: 0 };
  }

  const host = normalizeHost(url);
  if (!host) {
    return { allowed: false, headers: {}, maxRedirections: 0 };
  }

  const secrets = listSecretHeaders(headers);

  if (!promptHandler) {
    return { allowed: false, headers: {}, maxRedirections: 0 };
  }

  const decision = await promptHandler({ host, secrets });

  if (decision === "trust") {
    trustHost(host);
    return { allowed: true, headers, maxRedirections: 0 };
  }

  if (decision === "without-secrets") {
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
