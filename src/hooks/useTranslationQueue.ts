import { useCallback, useEffect, useRef, useState } from "react";
import { fastTranslate } from "@/lib/fast-translator";

/** How long a failed row waits before it is retried. */
export const TRANSLATE_RETRY_BACKOFF_MS = 45_000;
/**
 * How often the queue re-runs so failed rows are picked up on their own.
 *
 * The queue only re-runs when its inputs change, so without this a row whose
 * translation failed sat on a dash until the next thing was said — indefinitely
 * on a quiet call.
 */
export const TRANSLATE_RETRY_TICK_MS = 15_000;

export interface TranslationEntry {
  /** Stable text of the row; the translation is keyed by it. */
  text: string;
  /**
   * Live rows are skipped: a streaming row renders without a translation
   * column, so translating partial text would burn the endpoint on something
   * nobody can see. Optional so a caller's entry type (which marks it optional)
   * is assignable without a cast.
   */
  streaming?: boolean;
  /** Used for priority: interviewer questions and AI answers first. */
  ts: number;
}

export interface UseTranslationQueueResult {
  /** Translated text by row key. */
  translations: Record<string, string>;
  /**
   * True when the row's translation has already failed.
   *
   * Drives the difference between "still waiting" (a spinner) and "no
   * translation available" (a dash).
   */
  hasFailed: (key: string) => boolean;
  /** Drop the record of a row, e.g. after the user edited its text. */
  forget: (key: string) => void;
}

/**
 * The translation queue.
 *
 * Extracted from `SubtitleFeed` because the queue's state was a ref AND a state
 * tick whose relationship was expressed nowhere, and both defects that reached
 * users came from exactly that coupling:
 *
 * - a failure bumped a state that was ALSO a dependency of the queue effect, so
 *   React tore the effect down and both in-flight workers were cancelled: the
 *   remaining rows in the queue were silently dropped;
 * - a result arriving during teardown was discarded without recording either a
 *   result or a failure, leaving the row on a spinner until the next utterance.
 *
 * Both are now internal to this hook, where the repaint trigger and the re-run
 * trigger are separate values with names that say so.
 *
 * Two workers run in parallel (even/odd offsets): the providers are per-request
 * rate-limited, and two in flight roughly halves the latency of a long queue.
 */
export function useTranslationQueue(
  entries: TranslationEntry[],
  enabled: boolean
): UseTranslationQueueResult {
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const translatedKeysRef = useRef<Set<string>>(new Set());
  const failedAtRef = useRef<Map<string, number>>(new Map());
  /**
   * Repaint trigger. A failure is recorded in a ref, and a ref change does not
   * re-render, so the dash would never replace the spinner. Bumping this state
   * repaints WITHOUT restarting the queue.
   */
  const [, setRepaint] = useState(0);
  /**
   * Queue re-run trigger, bumped ONLY by the retry interval.
   *
   * It must not be the repaint trigger: that was the bug that cancelled the
   * workers, because a state used to restart the queue was also being set from
   * inside it.
   */
  const [runId, setRunId] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const now = Date.now();
    const pending = entries
      .filter((e) => {
        const key = e.text.trim();
        // Only finished rows: a live row renders without a translation column,
        // so translating partial text would burn the endpoint on something
        // nobody can see.
        if (!key || e.streaming) return false;
        // A row that failed waits for its backoff instead of being re-selected
        // on every `entries` change (which is every new word on screen).
        const failedAt = failedAtRef.current.get(key);
        if (failedAt !== undefined && now - failedAt < TRANSLATE_RETRY_BACKOFF_MS) {
          return false;
        }
        return !translatedKeysRef.current.has(key) && translations[key] === undefined;
      })
      // Interviewer questions and AI answers first.
      .sort((a, b) => b.ts - a.ts);

    if (pending.length === 0) return;

    const worker = async (queue: typeof pending, offset: number) => {
      for (let i = offset; i < queue.length; i += 2) {
        if (cancelled) return;
        const key = queue[i].text.trim();
        translatedKeysRef.current.add(key);
        const translated = await fastTranslate(key);

        // A provider failure returns the input unchanged. This is evaluated
        // BEFORE the cancellation check so a torn-down effect cannot record a
        // good result as a failure.
        const usable = Boolean(translated) && translated.trim() !== key;

        if (cancelled) {
          // The effect was torn down while this request was in flight. Dropping
          // the result and deleting the key left the row in neither
          // `translations` nor `failedAt`, so nothing ever picked it up again
          // and it kept its spinner. Finish the bookkeeping instead: a good
          // result is stored, a failure is handed to the retry path.
          translatedKeysRef.current.delete(key);
          if (usable) {
            setTranslations((p) => ({ ...p, [key]: translated }));
          } else {
            failedAtRef.current.set(key, Date.now());
          }
          continue;
        }

        if (!usable) {
          translatedKeysRef.current.delete(key);
          failedAtRef.current.set(key, Date.now());
          // The failure lives in a ref: repaint so the row shows its dash.
          setRepaint((n) => n + 1);
          continue;
        }

        failedAtRef.current.delete(key);
        setTranslations((p) => ({ ...p, [key]: translated }));
      }
    };

    void worker(pending, 0);
    void worker(pending, 1);

    return () => {
      cancelled = true;
    };
  }, [entries, enabled, runId, translations]);

  // Keep the queue moving: clear expired failure marks, then re-run it.
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [key, at] of failedAtRef.current) {
        if (now - at >= TRANSLATE_RETRY_BACKOFF_MS) {
          failedAtRef.current.delete(key);
          changed = true;
        }
      }
      if (changed) setRunId((n) => n + 1);
    }, TRANSLATE_RETRY_TICK_MS);
    return () => clearInterval(id);
  }, [enabled]);

  const hasFailed = useCallback(
    (key: string) => failedAtRef.current.has(key.trim()),
    []
  );

  const forget = useCallback((key: string) => {
    const k = key.trim();
    translatedKeysRef.current.delete(k);
    failedAtRef.current.delete(k);
    setTranslations((p) => {
      if (!(k in p)) return p;
      const next = { ...p };
      delete next[k];
      return next;
    });
  }, []);

  return { translations, hasFailed, forget };
}
