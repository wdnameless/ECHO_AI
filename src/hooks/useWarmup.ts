import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getRagContext } from "@/lib/rag/context.storage";
import { warmProviderConnection } from "@/lib/host-trust-gate";

/**
 * Pre-interview warmup: engine + model + provider + RAG before the first
 * question pays the cold start.
 *
 * What it does, in order of cost:
 * 1. Engine: `start_handy_server` (already running = no-op, START_LOCK holds).
 * 2. Model: `stt_readiness` tells whether the selected model is on disk;
 *    the engine loads it on demand, not here.
 * 3. Provider: a gated, credential-free origin GET opens the TLS socket
 *    (aborted after 1.5s).
 * 4. RAG: `getRagContext("resume"/"job")` — primes the 30s in-memory cache.
 *    The TTL is short on purpose (context can be edited); a warmup that runs
 *    minutes before the question would expire, so the prompt build re-reads
 *    the cache as it goes — what we buy here is the DB round-trip, not the TTL.
 *
 * The button hides after a successful run and reappears when the model
 * switches (the switch restarts the engine, so the warm state is gone).
 * It never warms silently: a hidden button that half-warmed is worse than
 * a visible one.
 */

export type WarmupState = "idle" | "running" | "done" | "failed";

export interface WarmupResult {
  engineOnline: boolean;
  providerWarmed: boolean;
  ragCached: { resume: boolean; job: boolean };
}

export interface UseWarmupOptions {
  /** Active provider URL (from useQuestionPipeline's resolver). */
  providerUrl: string | null;
  /** Bump when the speech model switches; resets the warm state. */
  modelKey: string;
  /** Auto-warm at session start (default: true). */
  autoWarmOnMount?: boolean;
}

export function useWarmup({ providerUrl, modelKey, autoWarmOnMount = true }: UseWarmupOptions) {
  const [state, setState] = useState<WarmupState>("idle");
  const [doneAt, setDoneAt] = useState<number | null>(null);
  const [lastModelKey, setLastModelKey] = useState(modelKey);

  // Model switched since the last successful warmup: the engine restarted,
  // so the warm state is gone — offer the button again.
  const visible =
    state === "running" ||
    state === "idle" ||
    state === "failed" ||
    lastModelKey !== modelKey;

  const warm = useCallback(async (): Promise<WarmupResult> => {
    setState("running");
    try {
      // Engine + model first: the slowest cold start.
      invoke("start_handy_server").catch(() => {});
      const engineOnline: boolean = await invoke("handy_server_status_detailed")
        .then((v: unknown) => {
          const o = v as { online?: boolean };
          return Boolean(o?.online);
        })
        .catch(() => false);

      // Provider socket: the first answer used to pay the TLS handshake.
      let providerWarmed = false;
      if (providerUrl) {
        await warmProviderConnection(providerUrl)
          .then(() => {
            providerWarmed = true;
          })
          .catch(() => {});
      }

      // RAG: prime the cache (the 30s TTL is shorter than a real gap, but the
      // DB read is what we buy here; the prompt build re-reads as it goes).
      const [resume, job] = await Promise.all([
        getRagContext("resume").catch(() => null),
        getRagContext("job").catch(() => null),
      ]);

      const result: WarmupResult = {
        engineOnline,
        providerWarmed,
        ragCached: { resume: Boolean(resume), job: Boolean(job) },
      };

      const ok = engineOnline && (providerUrl ? providerWarmed : true);
      setState(ok ? "done" : "failed");
      if (ok) {
        setDoneAt(Date.now());
        setLastModelKey(modelKey);
      }
      return result;
    } catch {
      setState("failed");
      return { engineOnline: false, providerWarmed: false, ragCached: { resume: false, job: false } };
    }
  }, [providerUrl, modelKey]);

  useEffect(() => {
    if (autoWarmOnMount) {
      void warm();
    }
  }, [warm, autoWarmOnMount]);

  return { state, visible, warm, doneAt };
}
