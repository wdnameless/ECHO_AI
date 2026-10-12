import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";
import rehypeKatex from "rehype-katex";
import { toHtml } from "hast-util-to-html";
import type { Root } from "hast";
import { sanitizeSchema } from "@/lib/sanitize-schema";

function renderMath(markdown: string): string {
  const processor = unified()
    .use(remarkParse)
    .use(remarkMath)
    .use(remarkRehype)
    .use(rehypeKatex)
    .use(sanitizeSchema);
  return toHtml(processor.runSync(processor.parse(markdown)) as Root);
}

vi.mock("streamdown", () => ({
  Streamdown: (props: Record<string, unknown>) => {
    (globalThis as { __capturedRemarkPlugins?: unknown }).__capturedRemarkPlugins =
      props.remarkPlugins;
    return null;
  },
}));

import MarkdownRenderer from "../renderer";

describe("MarkdownRenderer math rendering", () => {
  it("пробрасывает remark-math в Streamdown (иначе $$ выводятся текстом)", () => {
    render(<MarkdownRenderer>{"до $$15$$ секунд"}</MarkdownRenderer>);
    const plugins = (
      globalThis as { __capturedRemarkPlugins?: Array<unknown> }
    ).__capturedRemarkPlugins;
    expect(plugins).toBeDefined();
    expect(plugins).toContain(remarkMath);
  });

  it("цепочка remark-math + rehype-katex + sanitize не оставляет сырого $$", () => {
    const html = renderMath("до $$15$$ секунд");
    expect(html).toContain("katex");
    expect(html).not.toContain("$$");
  });
});
