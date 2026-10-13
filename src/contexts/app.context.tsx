import {
  AI_PROVIDERS,
  STORAGE_KEYS,
} from "@/config";
import { safeLocalStorage, trackAppStart } from "@/lib";
import { getShortcutsConfig } from "@/lib/storage";
import {
  nonSecretAIProviderVariables,
  setAIProviderVariables,
} from "@/lib/storage/ai-providers";
import {
  migrateCurlLiteralsToSecrets,
  migrateSecretsFromLocalStorage,
} from "@/lib/storage/secret-store";
import { getCustomizableState } from "@/lib/storage";
import { IContextType, ScreenshotConfig, TYPE_PROVIDER } from "@/types";
import curl2Json from "@bany/curl-to-json";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { enable, disable } from "@tauri-apps/plugin-autostart";
import {
  ReactNode,
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  useProfilesStore,
  useAudioStore,
  useStealthStore,
} from "@/stores";

const validateAndProcessCurlProviders = (
  providersJson: string,
  providerType: "AI" | "STT"
): TYPE_PROVIDER[] => {
  try {
    const parsed = JSON.parse(providersJson);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((p) => {
        try {
          curl2Json(p.curl);
          return true;
        } catch {
          return false;
        }
      })
      .map((p) => {
        const provider = { ...p, isCustom: true };
        if (providerType === "STT" && provider.curl) {
          provider.curl = provider.curl.replace(/AUDIO_BASE64/g, "AUDIO");
        }
        return provider;
      });
  } catch (e) {
    console.warn(`Failed to parse custom ${providerType} providers`, e);
    return [];
  }
};

// Create the context
const AppContext = createContext<IContextType | undefined>(undefined);

// Create the provider component
export const AppProvider = ({ children }: { children: ReactNode }) => {
  // Profiles store facade
  const {
    systemPrompt,
    setSystemPrompt,
    promptProfiles,
    activeProfileId,
    selectPromptProfile,
    updatePromptProfile,
    createPromptProfile,
    deletePromptProfile,
    resetPromptProfile,
    refreshPromptProfiles,
    jobProfiles,
    activeJobProfileId,
    activeJobProfile,
    selectJobProfile,
    updateJobProfile,
    createJobProfile,
    deleteJobProfile,
    applyJobProfile,
    refreshJobProfiles,
    loadProfilesData,
  } = useProfilesStore();

  // Audio store facade
  const {
    selectedAudioDevices,
    setSelectedAudioDevices,
    allSttProviders,
    customSttProviders,
    selectedSttProvider,
    onSetSelectedSttProvider,
    loadAudioData,
  } = useAudioStore();

  // Stealth store facade
  const {
    customizable,
    toggleAppIconVisibility,
    toggleAlwaysOnTop,
    toggleAutostart,
    toggleStealthMode,
    setCursorType,
    loadStealthData,
  } = useStealthStore();

  // AI Providers
  const [customAiProviders, setCustomAiProviders] = useState<TYPE_PROVIDER[]>(
    []
  );
  const [selectedAIProvider, setSelectedAIProvider] = useState<{
    provider: string;
    variables: Record<string, string>;
  }>({
    provider: "",
    variables: {},
  });
  /** True when the selection was changed locally and still needs persisting. */
  const aiSelectionDirtyRef = useRef(false);

  const [screenshotConfiguration, setScreenshotConfiguration] =
    useState<ScreenshotConfig>({
      mode: "manual",
      autoPrompt: "Analyze this screenshot and provide insights",
      enabled: true,
    });

  const [hasActiveLicense, setHasActiveLicense] = useState<boolean>(false);
  const [supportsImages, setSupportsImagesState] = useState<boolean>(() => {
    const stored = safeLocalStorage.getItem(STORAGE_KEYS.SUPPORTS_IMAGES);
    return stored === null ? true : stored === "true";
  });

  // Wrapper to sync supportsImages to localStorage
  const setSupportsImages = useCallback((value: boolean) => {
    setSupportsImagesState(value);
    safeLocalStorage.setItem(STORAGE_KEYS.SUPPORTS_IMAGES, String(value));
  }, []);

  // Echo AI API State
  const [pluelyApiEnabled, setPluelyApiEnabledState] = useState<boolean>(
    safeLocalStorage.getItem(STORAGE_KEYS.PLUELY_API_ENABLED) === "true"
  );

  const getActiveLicenseStatus = useCallback(async (): Promise<boolean> => {
    try {
      const status = await invoke<boolean>("check_license_status");
      setHasActiveLicense(status);
      return status;
    } catch {
      setHasActiveLicense(false);
      return false;
    }
  }, []);

  useEffect(() => {
    const syncLicenseState = async () => {
      try {
        await invoke("set_license_status", {
          hasLicense: hasActiveLicense,
        });

        const config = getShortcutsConfig();
        await invoke("update_shortcuts", { config });
      } catch (error) {
        console.error("Failed to synchronize license state:", error);
      }
    };

    syncLicenseState();
  }, [hasActiveLicense]);

  // Function to load all data from storage
  const loadData = useCallback(() => {
    loadProfilesData();
    loadAudioData();
    loadStealthData();

    // Load screenshot configuration
    const savedScreenshotConfig = safeLocalStorage.getItem(
      STORAGE_KEYS.SCREENSHOT_CONFIG
    );
    if (savedScreenshotConfig) {
      try {
        const parsed = JSON.parse(savedScreenshotConfig);
        if (typeof parsed === "object" && parsed !== null) {
          setScreenshotConfiguration({
            mode: parsed.mode || "manual",
            autoPrompt:
              parsed.autoPrompt ||
              "Analyze this screenshot and provide insights",
            enabled: parsed.enabled !== undefined ? parsed.enabled : false,
          });
        }
      } catch {
        console.warn("Failed to parse screenshot configuration");
      }
    }

    // Load custom AI providers
    const savedAi = safeLocalStorage.getItem(STORAGE_KEYS.CUSTOM_AI_PROVIDERS);
    let aiList: TYPE_PROVIDER[] = [];
    if (savedAi) {
      aiList = validateAndProcessCurlProviders(savedAi, "AI");
    }
    setCustomAiProviders(aiList);

    // Load selected AI provider
    const savedSelectedAi = safeLocalStorage.getItem(
      STORAGE_KEYS.SELECTED_AI_PROVIDER
    );
    if (savedSelectedAi) {
      try {
        const parsedAi = JSON.parse(savedSelectedAi);
        if (parsedAi && typeof parsedAi === "object" && parsedAi.variables) {
          parsedAi.variables = nonSecretAIProviderVariables(parsedAi.variables);
          setAIProviderVariables(parsedAi.provider, parsedAi.variables);
        }
        setSelectedAIProvider(parsedAi);
      } catch {
        console.warn("Failed to parse selected AI provider");
      }
    } else {
      const defaultAi = {
        provider: "nullform-gateway",
        variables: {
          API_KEY: "",
          MODEL: "gemini-3.6-flash-low",
        },
      };
      setSelectedAIProvider(defaultAi);
      safeLocalStorage.setItem(
        STORAGE_KEYS.SELECTED_AI_PROVIDER,
        JSON.stringify(defaultAi)
      );
    }

    // Load Echo AI API enabled state
    const savedPluelyApiEnabled = safeLocalStorage.getItem(
      STORAGE_KEYS.PLUELY_API_ENABLED
    );
    if (savedPluelyApiEnabled !== null) {
      setPluelyApiEnabledState(savedPluelyApiEnabled === "true");
    }
  }, [loadProfilesData, loadAudioData, loadStealthData]);

  // Load data on mount
  useEffect(() => {
    const initializeApp = async () => {
      try {
        await migrateSecretsFromLocalStorage();
      } catch (error) {
        console.debug("Secret migration skipped:", error);
      }

      try {
        await migrateCurlLiteralsToSecrets();
      } catch (error) {
        console.debug("Curl secret sweep skipped:", error);
      }

      await getActiveLicenseStatus();

      try {
        const appVersion = await invoke<string>("get_app_version");
        const storage = await invoke<{
          instance_id: string;
        }>("secure_storage_get");
        await trackAppStart(appVersion, storage.instance_id || "");
      } catch (error) {
        console.debug("Failed to track app start:", error);
      }
    };

    loadData();
    initializeApp();
  }, [loadData, getActiveLicenseStatus]);


  useEffect(() => {
    const initializeAutostart = async () => {
      try {
        const autostartInitialized = safeLocalStorage.getItem(
          STORAGE_KEYS.AUTOSTART_INITIALIZED
        );

        if (!autostartInitialized) {
          const autostartEnabled = customizable?.autostart?.isEnabled ?? true;

          if (autostartEnabled) {
            await enable();
          } else {
            await disable();
          }

          safeLocalStorage.setItem(STORAGE_KEYS.AUTOSTART_INITIALIZED, "true");
        }
      } catch (error) {
        console.debug("Autostart initialization skipped:", error);
      }
    };

    initializeAutostart();
  }, [customizable?.autostart?.isEnabled]);

  // Listen for app icon hide/show events when window is toggled
  useEffect(() => {
    const handleAppIconVisibility = async (isVisible: boolean) => {
      try {
        await invoke("set_app_icon_visibility", { visible: isVisible });
      } catch (error) {
        console.error("Failed to set app icon visibility:", error);
      }
    };

    const unlistenHide = listen("handle-app-icon-on-hide", async () => {
      const currentState = getCustomizableState();
      if (!currentState.appIcon.isVisible) {
        await handleAppIconVisibility(false);
      }
    });

    const unlistenShow = listen("handle-app-icon-on-show", async () => {
      await handleAppIconVisibility(true);
    });

    return () => {
      unlistenHide.then((fn) => fn());
      unlistenShow.then((fn) => fn());
    };
  }, []);

  // Listen to storage events for real-time sync (e.g., multi-tab)
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === STORAGE_KEYS.SUPPORTS_IMAGES && e.newValue !== null) {
        setSupportsImagesState(e.newValue === "true");
      }

      if (
        e.key === STORAGE_KEYS.CUSTOM_AI_PROVIDERS ||
        e.key === STORAGE_KEYS.SELECTED_AI_PROVIDER ||
        e.key === STORAGE_KEYS.CUSTOM_SPEECH_PROVIDERS ||
        e.key === STORAGE_KEYS.SELECTED_STT_PROVIDER ||
        e.key === STORAGE_KEYS.SYSTEM_PROMPT ||
        e.key === STORAGE_KEYS.SCREENSHOT_CONFIG ||
        e.key === STORAGE_KEYS.CUSTOMIZABLE ||
        e.key === STORAGE_KEYS.SELECTED_AUDIO_DEVICES
      ) {
        loadData();
      }
    };
    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, [loadData]);

  // Sync selected AI to localStorage — only for changes made here.
  useEffect(() => {
    if (!selectedAIProvider.provider) return;
    if (!aiSelectionDirtyRef.current) return;
    const serialized = JSON.stringify(selectedAIProvider);
    if (safeLocalStorage.getItem(STORAGE_KEYS.SELECTED_AI_PROVIDER) === serialized) {
      return;
    }
    aiSelectionDirtyRef.current = false;
    safeLocalStorage.setItem(STORAGE_KEYS.SELECTED_AI_PROVIDER, serialized);
  }, [selectedAIProvider]);

  // Computed all AI providers
  const allAiProviders: TYPE_PROVIDER[] = useMemo(
    () => [...AI_PROVIDERS, ...customAiProviders],
    [customAiProviders]
  );

  // Check if the current AI provider/model supports images
  useEffect(() => {
    const checkImageSupport = async () => {
      if (pluelyApiEnabled) {
        try {
          const storage = await invoke<{
            selected_pluely_model?: string;
          }>("secure_storage_get");

          if (storage.selected_pluely_model) {
            const model = JSON.parse(storage.selected_pluely_model);
            const hasImageSupport = model.modality?.includes("image") ?? false;
            setSupportsImages(hasImageSupport);
          } else {
            setSupportsImages(false);
          }
        } catch {
          setSupportsImages(false);
        }
      } else {
        const provider = allAiProviders.find(
          (p) => p.id === selectedAIProvider.provider
        );
        if (provider) {
          const hasImageSupport = provider.curl?.includes("{{IMAGE}}") ?? false;
          setSupportsImages(hasImageSupport);
        } else {
          setSupportsImages(true);
        }
      }
    };

    checkImageSupport();
  }, [pluelyApiEnabled, selectedAIProvider.provider, allAiProviders, setSupportsImages]);

  const onSetSelectedAIProvider = useCallback(
    ({
      provider,
      variables,
    }: {
      provider: string;
      variables: Record<string, string>;
    }) => {
      if (provider && !allAiProviders.some((p) => p.id === provider)) {
        console.warn(`Invalid AI provider ID: ${provider}`);
        return;
      }

      if (!pluelyApiEnabled) {
        const selectedProvider = allAiProviders.find((p) => p.id === provider);
        if (selectedProvider) {
          const hasImageSupport =
            selectedProvider.curl?.includes("{{IMAGE}}") ?? false;
          setSupportsImages(hasImageSupport);
        } else {
          setSupportsImages(true);
        }
      }

      const canonicalVars = nonSecretAIProviderVariables(variables);
      setAIProviderVariables(provider, canonicalVars);
      aiSelectionDirtyRef.current = true;
      setSelectedAIProvider((prev) => ({
        ...prev,
        provider,
        variables: canonicalVars,
      }));
    },
    [allAiProviders, pluelyApiEnabled, setSupportsImages]
  );

  const setPluelyApiEnabled = useCallback(
    async (enabled: boolean) => {
      setPluelyApiEnabledState(enabled);
      safeLocalStorage.setItem(STORAGE_KEYS.PLUELY_API_ENABLED, String(enabled));

      if (enabled) {
        try {
          const storage = await invoke<{
            selected_pluely_model?: string;
          }>("secure_storage_get");

          if (storage.selected_pluely_model) {
            const model = JSON.parse(storage.selected_pluely_model);
            const hasImageSupport = model.modality?.includes("image") ?? false;
            setSupportsImages(hasImageSupport);
          } else {
            setSupportsImages(false);
          }
        } catch (error) {
          console.debug("Failed to check Echo AI model image support:", error);
          setSupportsImages(false);
        }
      } else {
        const provider = allAiProviders.find(
          (p) => p.id === selectedAIProvider.provider
        );
        if (provider) {
          const hasImageSupport = provider.curl?.includes("{{IMAGE}}") ?? false;
          setSupportsImages(hasImageSupport);
        } else {
          setSupportsImages(true);
        }
      }

      loadData();
    },
    [setSupportsImages, allAiProviders, selectedAIProvider.provider, loadData]
  );

  // Create the context value (memoized facade over stores and local state)
  const value: IContextType = useMemo(
    () => ({
      systemPrompt,
      setSystemPrompt,
      allAiProviders,
      customAiProviders,
      selectedAIProvider,
      onSetSelectedAIProvider,
      allSttProviders,
      customSttProviders,
      selectedSttProvider,
      onSetSelectedSttProvider,
      screenshotConfiguration,
      setScreenshotConfiguration,
      customizable,
      toggleAppIconVisibility,
      toggleAlwaysOnTop,
      toggleAutostart,
      toggleStealthMode,
      loadData,
      pluelyApiEnabled,
      setPluelyApiEnabled,
      hasActiveLicense,
      setHasActiveLicense,
      getActiveLicenseStatus,
      selectedAudioDevices,
      setSelectedAudioDevices,
      setCursorType,
      supportsImages,
      setSupportsImages,
      promptProfiles,
      refreshPromptProfiles,
      activeProfileId,
      selectPromptProfile,
      updatePromptProfile,
      createPromptProfile,
      deletePromptProfile,
      resetPromptProfile,
      jobProfiles,
      activeJobProfileId,
      activeJobProfile,
      selectJobProfile,
      updateJobProfile,
      createJobProfile,
      deleteJobProfile,
      applyJobProfile,
      refreshJobProfiles,
    }),
    [
      systemPrompt,
      setSystemPrompt,
      allAiProviders,
      customAiProviders,
      selectedAIProvider,
      onSetSelectedAIProvider,
      allSttProviders,
      customSttProviders,
      selectedSttProvider,
      onSetSelectedSttProvider,
      screenshotConfiguration,
      setScreenshotConfiguration,
      customizable,
      toggleAppIconVisibility,
      toggleAlwaysOnTop,
      toggleAutostart,
      toggleStealthMode,
      loadData,
      pluelyApiEnabled,
      setPluelyApiEnabled,
      hasActiveLicense,
      setHasActiveLicense,
      getActiveLicenseStatus,
      selectedAudioDevices,
      setSelectedAudioDevices,
      setCursorType,
      supportsImages,
      setSupportsImages,
      promptProfiles,
      refreshPromptProfiles,
      activeProfileId,
      selectPromptProfile,
      updatePromptProfile,
      createPromptProfile,
      deletePromptProfile,
      resetPromptProfile,
      jobProfiles,
      activeJobProfileId,
      activeJobProfile,
      selectJobProfile,
      updateJobProfile,
      createJobProfile,
      deleteJobProfile,
      applyJobProfile,
      refreshJobProfiles,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

// Create a hook to access the context
export const useApp = () => {
  const context = useContext(AppContext);

  if (!context) {
    throw new Error("useApp must be used within a AppProvider");
  }

  return context;
};
