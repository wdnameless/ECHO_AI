import React from "react";

/**
 * Markdown rendering, with the engine loaded on demand.
 *
 * This module is deliberately thin: it holds no heavy import at all, so the
 * `@/components` barrel can re-export it (73 modules import that barrel) without
 * dragging a markdown engine into their graph. The renderer — `streamdown`,
 * mermaid, `rehype-katex`, the KaTeX stylesheet, `sanitizeSchema` — lives in
 * `./renderer`, which nothing imports statically.
 *
 * Why it matters: with the imports here, the build emitted 12.6 MB of vendors
 * (9.1 MB shiki, 2.1 MB mermaid, 0.6 MB cytoscape, 0.5 MB onnx, 0.3 MB katex)
 * into `index.html` as `modulepreload`. The floating bar parses all of it before
 * it can paint, while rendering no markdown at all.
 */
const MarkdownRenderer = React.lazy(() => import("./renderer"));

interface MarkdownRendererProps {
  children: string;
  isStreaming?: boolean;
}

export function Markdown({
  children,
  isStreaming = false,
}: MarkdownRendererProps) {
  return (
    // Until the engine arrives the text is shown as plain preformatted content
    // rather than nothing, so a streaming answer is never blank.
    <React.Suspense
      fallback={<div className="whitespace-pre-wrap">{children}</div>}
    >
      <MarkdownRenderer isStreaming={isStreaming}>{children}</MarkdownRenderer>
    </React.Suspense>
  );
}
