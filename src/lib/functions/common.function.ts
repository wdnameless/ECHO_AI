import { Message } from "@/types";

export function getByPath(obj: any, path: string): any {
  if (!path) return obj;
  return path
    .replace(/\[/g, ".")
    .replace(/\]/g, "")
    .split(".")
    .reduce((o, k) => (o || {})[k], obj);
}

export function setByPath(obj: any, path: string, value: any): void {
  const keys = path.split(".");
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i].replace(/\[(\d+)\]/g, ".$1");
    if (!current[key]) current[key] = /^\d+$/.test(keys[i + 1]) ? [] : {};
    current = current[key];
  }
  current[keys[keys.length - 1].replace(/\[(\d+)\]/g, ".$1")] = value;
}

export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(blob);
    reader.onloadend = () => {
      const base64data = (reader.result as string)?.split(",")[1] ?? "";
      resolve(base64data);
    };
    reader.onerror = reject;
  });
}

export function extractVariables(
  curl: string,
  includeAll = false
): { key: string; value: string }[] {
  if (typeof curl !== "string") {
    return [];
  }

  const regex = /\{\{([A-Z_]+)\}\}/g;
  const matches = curl?.match(regex) || [];
  const variables = matches
    .map((match) => {
      if (typeof match === "string") {
        return match.slice(2, -2);
      }
      return "";
    })
    .filter((v) => v !== "");

  const uniqueVariables = [...new Set(variables)];

  const doNotInclude = includeAll
    ? []
    : ["SYSTEM_PROMPT", "TEXT", "IMAGE", "AUDIO"];

  const filteredVariables = uniqueVariables?.filter(
    (variable) => !doNotInclude?.includes(variable)
  );

  return filteredVariables.map((variable) => ({
    key: variable?.toLowerCase()?.replace(/_/g, "_") || "",
    value: variable,
  }));
}

/**
 * Recursively processes a user message template to replace placeholders for text and images.
 * @param template The user message template object.
 * @param userMessage The user's text message.
 * @param imagesBase64 An array of base64 encoded images.
 * @returns The processed user message object.
 */
export function processUserMessageTemplate(
  template: any,
  userMessage: string,
  imagesBase64: string[] = []
): any {
  const escapeForJson = (value: string) =>
    JSON.stringify(value ?? "").slice(1, -1);

  // A function replacement, like `deepVariableReplacer`: a string replacement
  // expands `$`-tokens (`$&`, `` $` ``, `$'`, `$1`) in the user's own words, so
  // "платим $100 и $& важно" was spliced back into the template as `{{TEXT}}`.
  const templateStr = JSON.stringify(template).replace(
    /\{\{TEXT\}\}/g,
    () => escapeForJson(userMessage)
  );

  const result = JSON.parse(templateStr);

  const imageReplacer = (node: any): any => {
    if (Array.isArray(node)) {
      const imageTemplateIndex = node.findIndex((item) =>
        JSON.stringify(item).includes("{{IMAGE}}")
      );

      if (imageTemplateIndex > -1) {
        const imageTemplate = node[imageTemplateIndex];
        const imageParts =
          imagesBase64.length > 0
            ? imagesBase64
                .map((img) => {
                  const partStr = JSON.stringify(imageTemplate).replace(
                    /\{\{IMAGE\}\}/g,
                    // Function form: a base64 payload can contain `$`-tokens that
                    // a string replacement would expand into the template.
                    () => img
                  );
                  return JSON.parse(partStr);
                })
            : [];

        const finalArray = [
          ...node.slice(0, imageTemplateIndex),
          ...imageParts,
          ...node.slice(imageTemplateIndex + 1),
        ];
        return finalArray.map(imageReplacer);
      }
      return node.map(imageReplacer);
    } else if (node && typeof node === "object") {
      const newNode: { [key: string]: any } = {};
      for (const key in node) {
        newNode[key] = imageReplacer(node[key]);
      }
      return newNode;
    }
    return node;
  };

  return imageReplacer(result);
}

/**
 * Builds a dynamic messages array from a template, incorporating history and the current user message.
 * @param messagesTemplate The message template array from the cURL configuration.
 * @param history An array of previous messages in the conversation.
 * @param userMessage The user's current text message.
 * @param imagesBase64 An array of base64 encoded images for the current message.
 * @returns The fully constructed messages array.
 */
export function buildDynamicMessages(
  messagesTemplate: any[],
  history: Message[],
  userMessage: string,
  imagesBase64: string[] = []
): any[] {
  const userMessageTemplateIndex = messagesTemplate.findIndex((m) =>
    JSON.stringify(m).includes("{{TEXT}}")
  );

  if (userMessageTemplateIndex === -1) {
    return [...history, { role: "user", content: userMessage }]; // Fallback
  }

  const prefixMessages = messagesTemplate.slice(0, userMessageTemplateIndex);
  const suffixMessages = messagesTemplate.slice(userMessageTemplateIndex + 1);
  const userMessageTemplate = messagesTemplate[userMessageTemplateIndex];

  const newUserMessage = processUserMessageTemplate(
    userMessageTemplate,
    userMessage,
    imagesBase64
  );

  return [...prefixMessages, ...history, newUserMessage, ...suffixMessages];
}

/**
 * Recursively walks through an object and replaces variable placeholders.
 * @param node The object or value to process.
 * @param variables A key-value map of variables to replace.
 * @returns The processed object.
 */
export function deepVariableReplacer(
  node: any,
  variables: Record<string, string>
): any {
  if (typeof node === "string") {
    let result = node;
    for (const [key, value] of Object.entries(variables)) {
      // A FUNCTION replacement, not a string.
      //
      // `String.replace` expands `$`-tokens in a string replacement: `$&` becomes
      // the matched `{{TEXT}}`, `` $` `` and `$'` the surrounding text, `$1` a
      // capture group. User speech routinely contains `$` — prices, code, shell
      // snippets — so a message like "платим $100 и используем $& шаблон" had its
      // `$&` rewritten into the placeholder, splicing the template back into the
      // prompt. A function return value is inserted verbatim.
      result = result.replace(
        new RegExp(`\\{\\{${key}\\}\\}`, "g"),
        () => value
      );
    }
    return result;
  }
  if (Array.isArray(node)) {
    return node.map((item) => deepVariableReplacer(item, variables));
  }
  if (node && typeof node === "object") {
    const newNode: { [key: string]: any } = {};
    for (const key in node) {
      newNode[key] = deepVariableReplacer(node[key], variables);
    }
    return newNode;
  }
  return node;
}

/**
 * Extracts content from a streaming API response chunk by trying a series of common JSON paths.
 * This makes the system more resilient to variations in streaming formats.
 * @param chunk The parsed JSON object from a stream line.
 * @param defaultPath The default, non-streaming content path for the provider.
 * @returns The extracted text content, or null if not found.
 */
export function getStreamingContent(
  chunk: any,
  defaultPath: string
): string | null {
  // A set of possible paths to check for streaming content.
  // Using a Set automatically handles duplicates.
  const possiblePaths = new Set([
    // 1. First, try a common modification for OpenAI-like providers.
    defaultPath.replace(".message.", ".delta."),
    // 2. Then, add other common patterns.
    "choices[0].delta.content", // OpenAI, Groq, Mistral, Perplexity
    "candidates[0].content.parts[0].text", // Gemini
    "delta.text", // Claude
    "text", // Cohere
    // 3. Finally, use the original path as a fallback (for Gemini and others).
    defaultPath,
  ]);

  for (const path of possiblePaths) {
    // Skip empty or null paths
    if (!path) continue;

    const content = getByPath(chunk, path);

    // We only care about non-empty string content.
    // Some paths might resolve to objects (e.g., `choices[0].delta`), so we check the type.
    if (typeof content === "string" && content) {
      return content;
    }
  }

  // Return null if no content is found after trying all paths.
  return null;
}

/**
 * Canonicalizes variables dictionary by collapsing case-insensitive duplicate keys
 * into a single canonical UPPERCASE key (matching curl template placeholders like {{MODEL}}, {{API_KEY}}).
 *
 * Resolution rules per key group:
 * - If a group has conflicting values, lowercase key takes priority (fresh UI interaction / dropdown writes).
 * - Otherwise, any non-empty value is preserved.
 * - Groups with only empty values resolve to "".
 */
export function canonicalizeVariables(
  vars: Record<string, string> | undefined | null
): Record<string, string> {
  if (!vars || typeof vars !== "object") return {};

  // Group entries by normalized uppercase key:
  // canonicalKey -> Array<{ originalKey: string; value: string }>
  const groups = new Map<string, Array<{ originalKey: string; value: string }>>();

  for (const [k, v] of Object.entries(vars)) {
    const upper = k.toUpperCase();
    const entry = { originalKey: k, value: v ?? "" };
    const list = groups.get(upper);
    if (list) {
      list.push(entry);
    } else {
      groups.set(upper, [entry]);
    }
  }

  const result: Record<string, string> = {};

  for (const [upperKey, entries] of groups.entries()) {
    if (entries.length === 1) {
      // Keep single key normalized to uppercase canonical placeholder format
      result[upperKey] = entries[0].value;
      continue;
    }

    // Multiple case-variants present:
    // Check distinct non-empty values
    const nonEmpty = entries.filter((e) => e.value !== "");
    if (nonEmpty.length === 0) {
      result[upperKey] = "";
      continue;
    }

    const distinctValues = new Set(nonEmpty.map((e) => e.value));
    if (distinctValues.size === 1) {
      result[upperKey] = nonEmpty[0].value;
    } else {
      // Conflicting values: lowercase key takes priority (written by fresh UI interactions/dropdowns)
      const lowerMatch = nonEmpty.find(
        (e) => e.originalKey === e.originalKey.toLowerCase()
      );
      result[upperKey] = lowerMatch ? lowerMatch.value : nonEmpty[nonEmpty.length - 1].value;
    }
  }

  return result;
}

