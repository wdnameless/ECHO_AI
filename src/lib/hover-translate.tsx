import { useEffect, useRef, useState } from "react";
import { fastTranslate } from "@/lib/fast-translator";

/**
 * Splits text into sentences (Latin + Cyrillic terminators, decimals kept).
 */
export function splitSentences(text: string): string[] {
  const parts = text
    .replace(/([.!?…])(\s|$)/g, "$1\u0001")
    .split("\u0001")
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [text];
}

const hoverCache = new Map<string, string>();

/** How long to hover before the tooltip appears. */
const SHOW_DELAY_MS = 300;
/** Clamp half-width keeps the 300px-wide panel inside the viewport. */
const PANEL_HALF = 156;

type Tip = { x: number; y: number; translation: string | null };

/**
 * HoverTranslate: renders text as sentence spans; hovering an English or
 * Russian sentence shows its translation (opposite language) in a compact
 * cursor tooltip.
 *
 * The tooltip is `pointer-events-none`, so it never blocks text selection.
 */
export const HoverTranslate = ({ text }: { text: string }) => {
  const [tip, setTip] = useState<Tip | null>(null);
  const timerRef = useRef<number | null>(null);
  // Generation counter: invalidates in-flight shows/translations once the
  // pointer leaves or moves to another sentence.
  const genRef = useRef(0);
  const sentences = splitSentences(text);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      genRef.current += 1;
    };
  }, []);

  const handleEnter = (
    sentence: string,
    ev: React.MouseEvent<HTMLSpanElement>
  ) => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const gen = ++genRef.current;

    const rect = ev.currentTarget.getBoundingClientRect();
    const x = Math.min(
      Math.max(rect.left + rect.width / 2, PANEL_HALF),
      window.innerWidth - PANEL_HALF
    );
    const y = rect.top - 6;

    timerRef.current = window.setTimeout(() => {
      if (genRef.current !== gen) return; // pointer left or moved on

      const cached = hoverCache.get(sentence);
      if (cached) {
        setTip({ x, y, translation: cached });
        return;
      }

      // In-flight: inline spinner dots (no skeleton block).
      setTip({ x, y, translation: null });
      fastTranslate(sentence)
        .then((translated) => {
          hoverCache.set(sentence, translated);
          if (genRef.current !== gen) return;
          setTip({ x, y, translation: translated });
        })
        .catch(() => {
          if (genRef.current !== gen) return;
          setTip(null);
        });
    }, SHOW_DELAY_MS);
  };

  const handleLeave = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    genRef.current += 1;
    setTip(null); // disappear instantly on mouseleave
  };

  return (
    <>
      {sentences.map((sentence, i) => (
        <span
          key={i}
          className="group cursor-default hover:underline hover:decoration-dotted hover:decoration-primary/30 hover:underline-offset-2"
          onMouseEnter={(ev) => handleEnter(sentence, ev)}
          onMouseLeave={handleLeave}
        >
          {sentence}
          {i < sentences.length - 1 ? " " : ""}
        </span>
      ))}
      {tip && (
        <span
          className="fixed z-50 -translate-x-1/2 -translate-y-full max-w-[300px] rounded-md border border-border/60 bg-background/95 p-1.5 text-[0.68em] leading-snug text-foreground shadow-sm pointer-events-none whitespace-pre-wrap"
          style={{ left: tip.x, top: tip.y }}
        >
          {tip.translation === null ? (
            <span
              role="status"
              className="flex items-center gap-1 py-0.5"
              aria-label="Перевод..."
            >
              <span className="h-1 w-1 rounded-full bg-muted-foreground/70 animate-pulse [animation-duration:1s]" />
              <span className="h-1 w-1 rounded-full bg-muted-foreground/70 animate-pulse [animation-duration:1s] [animation-delay:150ms]" />
              <span className="h-1 w-1 rounded-full bg-muted-foreground/70 animate-pulse [animation-duration:1s] [animation-delay:300ms]" />
            </span>
          ) : (
            tip.translation
          )}
        </span>
      )}
    </>
  );
};