import { useEffect, useState } from "react";
import { useApp } from "@/contexts";
import { STORAGE_KEYS } from "@/config/constants";
import { getAIProviderVariables } from "@/lib/storage/ai-providers";
import { resolveProviderModel } from "@/lib/functions/ai-response.function";

type ProviderSelection = {
  provider: string;
  variables: Record<string, string>;
};

/**
 * Single source of provider/badge state for overlay surfaces.
 *
 * Priority: cross-window sync > live active provider > selected provider.
 * Previously duplicated verbatim in speech/index.tsx and SubtitleFeed.tsx,
 * which desynced the two dropdowns (StorageEvent never fires in the window
 * that wrote localStorage).
 */
export function useEffectiveProvider(
  propActiveProviderId?: string,
  propOnSetSelectedAIProvider?: (selection: ProviderSelection) => void
) {
  const {
    selectedAIProvider,
    allAiProviders,
    onSetSelectedAIProvider: contextOnSetSelectedAIProvider,
  } = useApp();
  const effectiveSetSelectedAIProvider =
    propOnSetSelectedAIProvider || contextOnSetSelectedAIProvider;
  const [syncedProviderId, setSyncedProviderId] = useState<string | null>(null);

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEYS.SELECTED_AI_PROVIDER && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          if (parsed?.provider) {
            setSyncedProviderId(parsed.provider);
            effectiveSetSelectedAIProvider?.({
              provider: parsed.provider,
              variables: parsed.variables || getAIProviderVariables(parsed.provider),
            });
          }
        } catch {}
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [effectiveSetSelectedAIProvider]);

  // Live failover wins over a stale manual pick. A failover moves ONLY the
  // live prop (the store keeps the configured provider), while a manual or
  // cross-window pick moves the synced/store value — so the prop wins only
  // when it diverges from BOTH. Without this, the badge kept showing the dead
  // provider while generation already ran on the next one.
  const storeProviderId = selectedAIProvider?.provider;
  const isLiveFailover =
    !!propActiveProviderId &&
    propActiveProviderId !== syncedProviderId &&
    propActiveProviderId !== storeProviderId;
  const effectiveProviderId = isLiveFailover
    ? propActiveProviderId
    : syncedProviderId || propActiveProviderId || storeProviderId || "";
  const effectiveProvider = allAiProviders?.find((p) => p.id === effectiveProviderId);
  const effectiveModel = resolveProviderModel(
    effectiveProvider || allAiProviders?.find((p) => p.id === selectedAIProvider?.provider),
    selectedAIProvider?.provider === effectiveProviderId
      ? selectedAIProvider
      : { provider: effectiveProviderId, variables: getAIProviderVariables(effectiveProviderId) }
  );

  const handleSelectProvider = (providerId: string) => {
    const vars = getAIProviderVariables(providerId);
    setSyncedProviderId(providerId);
    effectiveSetSelectedAIProvider?.({ provider: providerId, variables: vars });
  };

  return {
    effectiveProviderId,
    effectiveProvider,
    effectiveModel,
    allAiProviders,
    handleSelectProvider,
  };
}
