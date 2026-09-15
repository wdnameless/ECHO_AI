import type { Root, Element, ElementContent } from "hast";
import type { Plugin } from "unified";

/**
 * S1: санитайзер разметки, приходящей из недоверенных источников (ответы
 * модели, сниппеты веб-поиска). Второй слой после отказа от raw HTML:
 * Streamdown по умолчанию тянет rehype-raw и ослабленный rehype-harden,
 * который обрабатывает только теги <a> и <img>.
 *
 * Политика:
 *  - запрещённые теги удаляются вместе с потомками;
 *  - любой атрибут, начинающийся с "on", удаляется;
 *  - атрибут style удаляется (CSS-инъекция);
 *  - href/src допускают только безопасные схемы.
 */

/** Теги, которые удаляются целиком вместе с содержимым. */
const FORBIDDEN_TAGS: Record<string, true> = {
  script: true,
  iframe: true,
  object: true,
  embed: true,
  form: true,
  textarea: true,
  select: true,
  option: true,
  button: true,
  link: true,
  meta: true,
  base: true,
  style: true,
  applet: true,
  frame: true,
  frameset: true,
};

/** Явный allowlist тегов: markdown-набор + разметка KaTeX и shiki. */
const ALLOWED_TAGS: Record<string, true> = {
  p: true, br: true, hr: true, em: true, strong: true, del: true,
  sup: true, sub: true,
  h1: true, h2: true, h3: true, h4: true, h5: true, h6: true,
  ul: true, ol: true, li: true,
  blockquote: true, pre: true, code: true,
  table: true, thead: true, tbody: true, tfoot: true, tr: true,
  th: true, td: true,
  a: true, img: true,
  div: true, span: true,
  // KaTeX
  math: true, semantics: true, annotation: true, mrow: true, mi: true,
  mo: true, mn: true, msup: true, msub: true, msubsup: true, mfrac: true,
  msqrt: true, mroot: true, mtext: true, mspace: true, munder: true,
  mover: true, munderover: true, mtable: true, mtr: true, mtd: true,
  mstyle: true, mpadded: true, mphantom: true, menclose: true,
  mmultiscripts: true, mprescripts: true, none: true, mglue: true,
  maction: true, merror: true, mglyph: true,
  svg: true, path: true, g: true, line: true, rect: true, circle: true,
  use: true, defs: true,
};

/** Схемы, допустимые в href/src. */
const ALLOWED_PROTOCOLS: Record<string, true> = {
  "http:": true,
  "https:": true,
  "mailto:": true,
  "blob:": true,
};

/** Проверка URL на безопасную схему. Относительные пути разрешены. */
function isSafeUrl(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  const value = raw.trim();
  if (value === "") return false;

  // Относительные и якорные ссылки безопасны.
  if (value.startsWith("#") || value.startsWith("/") || value.startsWith("./") || value.startsWith("../")) {
    return true;
  }

  // data: разрешаем только для изображений — проверяется вызывающей стороной.
  if (/^data:image\//i.test(value)) return true;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return ALLOWED_PROTOCOLS[parsed.protocol] === true;
}

/** Удаляет небезопасные атрибуты у элемента. */
function scrubProperties(node: Element): void {
  const props = node.properties;
  if (!props) return;

  for (const name of Object.keys(props)) {
    const lower = name.toLowerCase();

    // Любой обработчик события.
    if (lower.startsWith("on")) {
      delete props[name];
      continue;
    }

    // CSS-инъекция через style.
    if (lower === "style") {
      delete props[name];
      continue;
    }

    if (lower === "href" || lower === "src") {
      if (!isSafeUrl(props[name])) {
        delete props[name];
      }
      continue;
    }

    // srcset может нести второй URL в обход проверки src.
    if (lower === "srcset" || lower === "action" || lower === "formaction") {
      delete props[name];
      continue;
    }
  }
}

/**
 * Рекурсивно очищает детей узла и выбрасывает всё, что не прошло политику.
 *
 * Тег вне allowlist не удаляется вместе с содержимым: текст ответа модели
 * должен остаться видимым, поэтому «обёртка» снимается, а её дети
 * поднимаются на уровень выше — но уже проверенные. Именно на этом основан
 * второй слой: без рекурсивного прохода `<details><img onerror=…>` или
 * `<svg><foreignObject><img onload=…>` донесли бы живой обработчик до DOM.
 */
function sanitizeChildren(parent: Root | Element): void {
  const kept: ElementContent[] = [];

  for (const child of parent.children as ElementContent[]) {
    if (child.type !== "element") {
      kept.push(child);
      continue;
    }

    const element = child as Element;
    const tag = element.tagName.toLowerCase();

    // Запрещённый тег вырезается вместе со всем поддеревом.
    if (FORBIDDEN_TAGS[tag] === true) continue;

    // GFM task lists требуют <input type="checkbox" disabled>. Разрешаем
    // исключительно эту форму: интерактивные поля ввода остаются недоступны.
    if (tag === "input") {
      const props = element.properties ?? {};
      if (props.type !== "checkbox" || props.disabled === undefined) continue;
      scrubProperties(element);
      kept.push(element);
      continue;
    }

    // Обёртка вне allowlist: тег снимаем, детей поднимаем наверх.
    if (ALLOWED_TAGS[tag] !== true) {
      sanitizeChildren(element);
      kept.push(...(element.children as ElementContent[]));
      continue;
    }

    scrubProperties(element);
    sanitizeChildren(element);
    kept.push(element);
  }

  parent.children = kept as typeof parent.children;
}

/** Приводит тип свойства из hast (string | number | boolean | array). */
export const sanitizeSchema: Plugin<[], Root> = () => (tree: Root) => {
  sanitizeChildren(tree);
};

export { FORBIDDEN_TAGS, ALLOWED_TAGS, isSafeUrl };
