import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { onStatus } from "@/lib/asr-status";

export interface HandyStatus {
  online: boolean;
  model: string;
  checking: boolean;
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
        setStatus({
          online: !!res?.online,
          model: res?.model || "",
          checking: false,
        });
      } catch (err) {
        console.warn("[handy-status]", err);
        if (!cancelled) {
          setStatus({ online: false, model: "", checking: false });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // WS-driven live updates.
  useEffect(
    () =>
      onStatus((s) => {
        setStatus((prev) => ({
          online: s.online,
          model: s.model || prev.model,
          checking: false,
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
      setStatus({
        online: !!res?.online,
        model: res?.model || "",
        checking: false,
      });
    } catch (err) {
      console.warn("[handy-status]", err);
      setStatus({ online: false, model: "", checking: false });
    }
  }, []);

  return { ...status, refresh };
}