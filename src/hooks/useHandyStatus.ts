import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface HandyStatus {
  online: boolean;
  model: string;
  checking: boolean;
}

/**
 * Polls the local Handy STT server health endpoint so the UI can show a
 * live green indicator + the currently selected model (Nemotron 3.5 ASR).
 */
export function useHandyStatus(pollMs: number = 5000) {
  const [status, setStatus] = useState<HandyStatus>({
    online: false,
    model: "",
    checking: true,
  });

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
    } catch {
      setStatus({ online: false, model: "", checking: false });
    }
  }, []);

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    refreshRef.current();
    const t = setInterval(() => refreshRef.current(), pollMs);
    return () => clearInterval(t);
  }, [pollMs]);

  return { ...status, refresh };
}
