import { useState, useEffect, useCallback } from "react";
import {
  fillerManager,
  FillerManagerConfig,
  FillerState,
} from "@/lib/filler-manager";

export interface UseFillerManagerReturn {
  activeFiller: string | null;
  isPlaying: boolean;
  status: FillerState["status"];
  latencyMs: number;
  config: FillerManagerConfig;
  updateConfig: (newConfig: Partial<FillerManagerConfig>) => void;
  startMonitoring: (onTrigger?: (phrase: string) => void) => void;
  stop: () => void;
}

export function useFillerManager(): UseFillerManagerReturn {
  const [state, setState] = useState<FillerState>(fillerManager.getState());
  const [config, setConfig] = useState<FillerManagerConfig>(
    fillerManager.getConfig()
  );

  useEffect(() => {
    const unsubscribe = fillerManager.subscribe((nextState) => {
      setState(nextState);
    });
    return unsubscribe;
  }, []);

  const updateConfig = useCallback((newConfig: Partial<FillerManagerConfig>) => {
    fillerManager.updateConfig(newConfig);
    setConfig(fillerManager.getConfig());
  }, []);

  const startMonitoring = useCallback((onTrigger?: (phrase: string) => void) => {
    fillerManager.startMonitoring(onTrigger);
  }, []);

  const stop = useCallback(() => {
    fillerManager.stop();
  }, []);

  return {
    activeFiller: state.activeFiller,
    isPlaying: state.isPlaying,
    status: state.status,
    latencyMs: state.latencyMs,
    config,
    updateConfig,
    startMonitoring,
    stop,
  };
}
