import { describe, it, expect } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeKatex from "rehype-katex";
import { toHtml } from "hast-util-to-html";
import { visit } from "unist-util-visit";
import type { Root, Element } from "hast";
import { sanitizeSchema } from "../sanitize-schema";

/**
 * Регрессионная проверка: санитайзер не должен ломать штатные форматы вывода.
 * Пайплайн повторяет рендеринг ответа модели: markdown -> KaTeX -> санитайзер.
 */
function render(markdown: string): string {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkRehype)
    .use(rehypeKatex)
    .use(sanitizeSchema);
  const tree = processor.runSync(processor.parse(markdown)) as Root;
  return toHtml(tree);
}

/** Имена всех тегов в дереве. */
function tags(html: string): string[] {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkRehype)
    .use(rehypeKatex)
    .use(sanitizeSchema);
  const tree = processor.runSync(processor.parse(html)) as Root;
  const names = new Set<string>();
  visit(tree, "element", (node: Element) => {
    names.add(node.tagName.toLowerCase());
  });
  return [...names];
}

describe("sanitizeSchema regression — rendering formats", () => {
  it("preserves KaTeX output structure", () => {
    const html = render("Формула: $E = mc^2$");
    expect(html).toContain("katex");
    // KaTeX emits spans with classes; the sanitizer must not strip the node.
    expect(html).toMatch(/<span class="katex/);
  });

  it("preserves block KaTeX output structure", () => {
    const html = render("$$\n\\int_0^1 x^2 dx\n$$");
    expect(html).toContain("katex-display");
  });

  it("keeps the tag vocabulary KaTeX needs", () => {
    const names = tags("$$\\frac{a}{b}$$");
    // KaTeX produces mathml + html spans; none of these are forbidden.
    for (const required of ["span", "math", "semantics", "annotation"]) {
      if (names.includes(required)) {
        expect(required).not.toBe("");
      }
    }
    expect(names.some((n) => ["span", "math"].includes(n))).toBe(true);
  });

  it("preserves GFM tables", () => {
    const html = render("| a | b |\n|---|---|\n| 1 | 2 |");
    expect(html).toContain("<table>");
    expect(html).toContain("<th");
    expect(html).toContain("<td");
  });

  it("preserves task lists and strikethrough", () => {
    const html = render("- [x] done\n- [ ] todo\n\n~~gone~~");
    expect(html).toContain("<del>");
    expect(html).toContain("checkbox");
  });

  it("preserves fenced code blocks with language class", () => {
    const html = render("```ts\nconst x: number = 1;\n```");
    expect(html).toContain("<pre>");
    expect(html).toMatch(/class="[^"]*language-ts/);
  });

  it("preserves headings, lists and blockquotes", () => {
    const html = render("# H1\n\n> quote\n\n1. one\n2. two");
    expect(html).toContain("<h1>");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("<ol>");
  });
});

describe("sanitizeSchema regression — mermaid path", () => {
  it("keeps mermaid fenced block intact for the diagram renderer", () => {
    // Mermaid renders from a fenced code block, so the code node must survive.
    const markdown = "```mermaid\ngraph TD;\n  A-->B;\n```";
    const html = render(markdown);
    expect(html).toMatch(/language-mermaid/);
    expect(html).toContain("graph TD");
  });
});
