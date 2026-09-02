import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { onStatus } from "@/lib/asr-status";
import { onMetrics, getMetrics, type MetricsSnapshot } from "@/lib/metrics";

export interface HandyStatus {
  online: boolean;
  model: string;
  checking: boolean;
  metrics: MetricsSnapshot;
}

/**
 * Live pluely-asr status: one cold check at mount (Rust-side detailed
 * status), then WS-driven updates via the asr-status pub/sub store fed by
 * the open audio streams. No polling interval — the sidecar pushes
 * `sessions_in_use` on every frame, so the indicator is always fresher
 * than the old 5s poll with zero request load.
 */
export function useHandyStatus() {
  const [status, setStatus] = useState<HandyStatus>({
    online: false,
    model: "",
    checking: true,
    metrics: getMetrics(),
  });
  // One-shot cold check on mount (covers the "no stream open yet" case).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = (await invoke("handy_server_status_detailed")) as {
          online: boolean;
          model: string;
        };
        if (cancelled) return;
        // The sidecar knows its real model name; prefer it over the generic
        // Tauri-side answer when the WS has reported one.
        setStatus((prev) => ({
          ...prev,
          online: !!res?.online,
          model: res?.model || "",
          checking: false,
        }));
      } catch (err) {
        console.warn("[handy-status]", err);
        if (!cancelled) {
          setStatus((prev) => ({
            ...prev,
            online: false,
            model: "",
            checking: false,
          }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // WS-driven live updates.
  // WS-driven live updates for ASR status.
  useEffect(
    () =>
      onStatus((s) => {
        setStatus((prev) => ({
          ...prev,
          online: s.online,
          model: s.model || prev.model,
          checking: false,
        }));
      }),
    []
  );

  // Metrics live updates.
  useEffect(
    () =>
      onMetrics((m) => {
        setStatus((prev) => ({
          ...prev,
          metrics: m,
        }));
      }),
    []
  );
  const refresh = useCallback(async () => {
    try {
      const res = (await invoke("handy_server_status_detailed")) as {
        online: boolean;
        model: string;
      };
      setStatus((prev) => ({
        ...prev,
        online: !!res?.online,
        model: res?.model || "",
        checking: false,
      }));
    } catch (err) {
      console.warn("[handy-status]", err);
      setStatus((prev) => ({
        ...prev,
        online: false,
        model: "",
        checking: false,
      }));
    }
  }, []);

  return { ...status, refresh };
}