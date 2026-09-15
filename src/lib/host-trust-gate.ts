import { getHostOfCurlTemplate, isTrustedHost, trustHost } from "./trusted-hosts";

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
const SECRET_HEADER_PATTERN = /^(authorization|x-api-key|api-key|xi-api-key|openai-api-key)$/i;

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
): Promise<{ allowed: boolean; headers: Record<string, string> }> {
  if (isTrustedHost(url)) {
    return { allowed: true, headers };
  }

  const host = getHostOfCurlTemplate(`curl ${url}`) ?? url;
  const secrets = listSecretHeaders(headers);

  if (!promptHandler) {
    return { allowed: false, headers: {} };
  }

  const decision = await promptHandler({ host, secrets });

  if (decision === "trust") {
    trustHost(host);
    return { allowed: true, headers };
  }

  if (decision === "without-secrets") {
    const sanitized: Record<string, string> = {};
    for (const [name, value] of Object.entries(headers)) {
      if (!SECRET_HEADER_PATTERN.test(name.trim())) {
        sanitized[name] = value;
      }
    }
    return { allowed: true, headers: sanitized };
  }

  return { allowed: false, headers: {} };
}

/** Только для тестов: сброс зарегистрированного обработчика. */
export function resetHostTrustPromptForTests(): void {
  promptHandler = null;
}
