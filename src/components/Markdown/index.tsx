import React from "react";
import { Streamdown } from "streamdown";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { openUrl } from "@tauri-apps/plugin-opener";
import { sanitizeSchema } from "@/lib/sanitize-schema";

interface MarkdownRendererProps {
  children: string;
  isStreaming?: boolean;
}

interface AnchorProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  children?: React.ReactNode;
  href?: string;
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

const REHYPE_PLUGINS = [
  [rehypeKatex, { errorColor: "var(--color-muted-foreground)" }],
  sanitizeSchema,
] as unknown as RehypePluginList;

type StreamdownComponents = NonNullable<
  React.ComponentProps<typeof Streamdown>["components"]
>;

export function Markdown({
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

const COMPONENTS = {
  a: ({ children, href, ...props }: AnchorProps) => {
    const handleClick = async (e: React.MouseEvent) => {
      e.preventDefault();
      if (href) {
        try {
          await openUrl(href);
        } catch (error) {
          console.error("Failed to open URL:", error);
        }
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

