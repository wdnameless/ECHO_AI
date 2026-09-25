/**
 * The heavy markdown engine, isolated in its own module.
 *
 * Everything that costs real weight lives here — `streamdown` (which itself
 * depends on mermaid), `rehype-katex`, the KaTeX stylesheet and `sanitizeSchema`.
 * Nothing imports this file statically: `./index` reaches it only through
 * `React.lazy`, so the bundler keeps it out of the entry chunk.
 *
 * That separation is the whole point. While these imports sat in `./index`, the
 * `@/components` barrel re-exported them into the graph of 73 modules — including
 * the floating bar, which renders no markdown — and katex ended up in the startup
 * bundle (measured: entry 1604 KB vs 904 KB). They are only ever needed once an
 * answer is rendered.
 */
import React from "react";
import { Streamdown } from "streamdown";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { openUrl } from "@tauri-apps/plugin-opener";
import { sanitizeSchema } from "@/lib/sanitize-schema";

interface AnchorProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  children?: React.ReactNode;
  href?: string;
}

interface MarkdownRendererProps {
  children: string;
  isStreaming?: boolean;
}

/**
 * Ответы моделей и сниппеты веб-поиска — недоверенный ввод. Streamdown по
 * умолчанию подключает rehype-raw (интерпретирует HTML из ответа) и
 * rehype-harden, который обрабатывает только <a>/<img>. Мы переопределяем
 * набор rehype-плагинов: без raw HTML, с собственным санитайзером.
 * `rehypePlugins` — публичный проп Streamdown, поэтому переопределение
 * не требует патча библиотеки.
 *
 * remarkPlugins не трогаем: gfm/math/cjk на безопасность не влияют.
 */
type RehypePluginList = NonNullable<
  React.ComponentProps<typeof Streamdown>["rehypePlugins"]
>;

// SAFETY: `rehypeKatex` and `sanitizeSchema` are the two rehype plugins this
// renderer is configured with; streamdown declares an opaque parameter type for
// them, so the assertion bridges that declaration with the concrete plugin types
// without changing any runtime value.
const REHYPE_PLUGINS = [
  [rehypeKatex, { errorColor: "var(--color-muted-foreground)" }],
  sanitizeSchema,
] as unknown as RehypePluginList;

// Kept as a type so a component-map typo is a compile error, not a silent
// fallback to streamdown's default renderer.
type StreamdownComponents = NonNullable<
  React.ComponentProps<typeof Streamdown>["components"]
>;

const COMPONENTS = {
  a: ({ children, href, ...props }: AnchorProps) => {
    const handleClick = async (e: React.MouseEvent) => {
      e.preventDefault();
      if (!href) return;
      // Anything that is not a web link never reaches the OS opener: a relative
      // or bare path in a rendered answer would otherwise launch a local file or
      // a UNC share with no confirmation.
      if (!/^(https?:|mailto:)/i.test(href.trim())) {
        console.warn("[markdown] refusing to open non-web link:", href.slice(0, 80));
        return;
      }
      try {
        await openUrl(href);
      } catch (error) {
        console.error("Failed to open URL:", error);
      }
    };

    return (
      <a
        href={href}
        className="text-gray-600 underline underline-offset-2 hover:text-gray-800 dark:text-gray-300 dark:hover:text-gray-100 cursor-pointer"
        onClick={handleClick}
        {...props}
      >
        {children}
      </a>
    );
  },
} satisfies StreamdownComponents;

/** The renderer itself; loaded only through `React.lazy` from `./index`. */
export default function MarkdownRenderer({
  children,
  isStreaming = false,
}: MarkdownRendererProps) {
  return (
    <Streamdown
      isAnimating={isStreaming}
      shikiTheme={["github-light", "github-dark"]}
      components={COMPONENTS}
      rehypePlugins={REHYPE_PLUGINS}
      controls={{
        table: true,
        code: true,
        mermaid: {
          download: true,
          copy: true,
          fullscreen: false,
          panZoom: false,
        },
      }}
    >
      {children}
    </Streamdown>
  );
}
