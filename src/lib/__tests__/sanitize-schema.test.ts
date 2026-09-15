import { describe, it, expect } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import { toHtml } from "hast-util-to-html";
import { visit } from "unist-util-visit";
import type { Root, Element } from "hast";
import { sanitizeSchema } from "../sanitize-schema";

/**
 * Прогоняет markdown через пайплайн, аналогичный рендерингу ответов модели,
 * но с собственным санитайзером вместо ослабленного rehype-harden.
 * rehype-raw включён намеренно: тест доказывает, что санитайзер закрывает
 * raw HTML даже если тот дошёл до HAST.
 */
function render(markdown: string): string {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(sanitizeSchema);
  const tree = processor.runSync(processor.parse(markdown)) as Root;
  return toHtml(tree);
}

/** Собирает все имена атрибутов в дереве. */
function collectAttributes(html: string): string[] {
  const processor = unified()
    .use(remarkParse)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(sanitizeSchema);
  const tree = processor.runSync(processor.parse(html)) as Root;

  const names: string[] = [];
  visit(tree, "element", (node: Element) => {
    for (const name of Object.keys(node.properties ?? {})) {
      names.push(name.toLowerCase());
    }
  });
  return names;
}

describe("sanitizeSchema", () => {
  it("removes script tags with their content", () => {
    const html = render(`before <script>alert('xss')</script> after`);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert");
  });

  it("removes iframe tags", () => {
    const html = render(`<iframe src="https://evil.example"></iframe>`);
    expect(html).not.toContain("<iframe");
  });

  it("strips event handler attributes from img", () => {
    const html = render(`<img src="https://evil.example/x.png" onerror="alert(1)">`);
    expect(html).not.toMatch(/onerror/i);
  });

  it("strips event handler attributes from svg", () => {
    const html = render(`<svg onload="alert(1)"></svg>`);
    expect(html).not.toMatch(/onload/i);
  });

  it("strips event handler attributes from arbitrary elements", () => {
    const html = render(`<div onclick="alert(1)">click</div>`);
    expect(html).not.toMatch(/onclick/i);
  });

  it("blocks javascript: urls in links", () => {
    const html = render(`<a href="javascript:alert(1)">link</a>`);
    expect(html).not.toMatch(/javascript:/i);
  });

  it("blocks vbscript: and file: urls", () => {
    const html = render(`<a href="vbscript:msgbox(1)">a</a><a href="file:///c:/x">b</a>`);
    expect(html).not.toMatch(/vbscript:/i);
    expect(html).not.toMatch(/file:\/\//i);
  });

  it("strips style attributes", () => {
    const html = render(`<div style="background:url(javascript:alert(1))">x</div>`);
    expect(html).not.toMatch(/style=/i);
  });

  it("strips srcset to prevent bypassing src validation", () => {
    const html = render(`<img src="https://ok.example/a.png" srcset="javascript:alert(1)">`);
    expect(html).not.toMatch(/srcset/i);
  });

  it("keeps normal http and https links", () => {
    const html = render(`[site](https://example.com)`);
    expect(html).toContain("https://example.com");
  });

  it("keeps markdown structure", () => {
    const html = render(`# Title\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |`);
    expect(html).toContain("<h1>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<table>");
  });

  it("keeps inline code and pre blocks", () => {
    const html = render("Use `const x = 1;` here.\n\n```ts\nconst y = 2;\n```");
    expect(html).toContain("<code>");
    expect(html).toContain("<pre>");
  });

  it("never leaves any attribute starting with 'on'", () => {
    const html = render(
      `<img src="https://e.example/i.png" onerror="a" onload="b" onmouseover="c">` +
        `<div onfocus="d" onblur="e">f</div>`
    );
    const attrs = collectAttributes(html);
    expect(attrs.filter((name) => name.startsWith("on"))).toEqual([]);
  });

  it("removes interactive text inputs from untrusted markup", () => {
    const html = render(`<input type="text" name="password"><input type="password">`);
    expect(html).not.toContain("<input");
  });

  it("removes non-checkbox inputs even when disabled", () => {
    const html = render(`<input type="text" disabled>`);
    expect(html).not.toContain("<input");
  });

  it("keeps only disabled checkboxes for GFM task lists", () => {
    const html = render(`- [x] done`);
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*disabled/);
  });

  describe("allowlist wrappers cannot hide handlers", () => {
    it("strips handlers inside a tag that is not allowed", () => {
      const html = render(`<details open><img src="x" onerror="alert(1)"></details>`);
      expect(html).not.toContain("onerror");
      expect(collectAttributes(html).filter((n) => n.startsWith("on"))).toEqual([]);
    });

    it("strips handlers inside a disallowed tag nested in an allowed one", () => {
      const html = render(
        `<svg><foreignObject><img src="x" onload="alert(2)"></foreignObject></svg>`
      );
      expect(html).not.toContain("onload");
      expect(collectAttributes(html).filter((n) => n.startsWith("on"))).toEqual([]);
    });

    it("strips handlers several wrappers deep", () => {
      const html = render(
        `<details><summary><video><track onloadstart="alert(3)"></video></summary></details>`
      );
      expect(collectAttributes(html).filter((n) => n.startsWith("on"))).toEqual([]);
    });

    it("keeps the text of a stripped wrapper instead of dropping it", () => {
      const html = render(`<details><summary>Ответ модели</summary></details>`);
      expect(html).toContain("Ответ модели");
    });
  });
});
