import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

/**
 * Get the current application version from Tauri
 */
export const getAppVersion = async (): Promise<string> => {
  try {
    const version = await invoke<string>("get_app_version");
    return version;
  } catch (error) {
    console.error("Failed to get app version:", error);
    return "Unknown";
  }
};

/**
 * Version of the running build, or an empty string until it resolves.
 *
 * Every surface that shows the version used to repeat the same fetch effect;
 * this is the one place that knows the version is unavailable in a plain
 * browser (the invoke rejects there).
 */
export const useAppVersion = (): string => {
  const [version, setVersion] = useState<string>("");
  useEffect(() => {
    let cancelled = false;
    void getAppVersion().then((v) => {
      if (!cancelled && v !== "Unknown") setVersion(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return version;
};
