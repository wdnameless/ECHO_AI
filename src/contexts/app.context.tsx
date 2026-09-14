import {
  AI_PROVIDERS,
  DEFAULT_SYSTEM_PROMPT,
  SPEECH_TO_TEXT_PROVIDERS,
  STORAGE_KEYS,
} from "@/config";
import { canonicalizeVariables, getPlatform, safeLocalStorage, trackAppStart } from "@/lib";
import { getShortcutsConfig } from "@/lib/storage";
import {
  getCustomizableState,
  setCustomizableState,
  updateAppIconVisibility,
  updateAlwaysOnTop,
  updateAutostart,
  updateStealthMode,
  CustomizableState,
  DEFAULT_CUSTOMIZABLE_STATE,
  CursorType,
  updateCursorType,
} from "@/lib/storage";
import { IContextType, ScreenshotConfig, TYPE_PROVIDER } from "@/types";
import {
  applyProfileToStorage,
  getActiveProfile,
  getActiveProfileId,
  getPromptProfiles,
  PromptProfile,
  savePromptProfiles,
  setActiveProfileId,
} from "@/lib/storage/prompt-profiles";
import {
  applyJobProfileToStorage,
  getActiveJobProfileId,
  getJobProfiles,
  JobProfile,
  saveJobProfiles,
  setActiveJobProfileId,
} from "@/lib/storage/job-profiles";
import curl2Json from "@bany/curl-to-json";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { enable, disable } from "@tauri-apps/plugin-autostart";
import {
  ReactNode,
  createContext,
  useContext,
  useCallback,
  useEffect,
  useState,
} from "react";

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
        } catch (e) {
          return false;
        }

        return true;
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
  const [systemPrompt, setSystemPrompt] = useState<string>(
    safeLocalStorage.getItem(STORAGE_KEYS.SYSTEM_PROMPT) ||
      DEFAULT_SYSTEM_PROMPT
  );

  // Prompt profiles (Interview / General / custom)
  const [promptProfiles, setPromptProfiles] = useState<PromptProfile[]>(() =>
    getPromptProfiles()
  );
  const [activeProfileId, setActiveProfileIdState] = useState<string>(() =>
    getActiveProfileId()
  );

  const selectPromptProfile = useCallback(
    (profileId: string) => {
      const profiles = getPromptProfiles();
      const profile = profiles.find((p) => p.id === profileId);
      if (!profile) return;
      setActiveProfileIdState(profileId);
      setActiveProfileId(profileId);
      applyProfileToStorage(profile);
      setSystemPrompt(profile.systemPrompt);
      // Refresh profile list (settings may have custom profiles)
      setPromptProfiles(getPromptProfiles());
    },
    [setSystemPrompt]
  );

  const updatePromptProfile = useCallback(
    (profileId: string, updates: Partial<PromptProfile>) => {
      const profiles = getPromptProfiles();
      const idx = profiles.findIndex((p) => p.id === profileId);
      if (idx === -1) return;
      const updated = { ...profiles[idx], ...updates };
      profiles[idx] = updated;
      savePromptProfiles(profiles);
      setPromptProfiles(profiles);
      // If the active profile was edited, re-apply to storage so the
      // floating window and prompts pick up changes immediately.
      if (profileId === getActiveProfileId()) {
        applyProfileToStorage(updated);
        setSystemPrompt(updated.systemPrompt);
      }
    },
    [setSystemPrompt]
  );

  const createPromptProfile = useCallback(
    (profile: Omit<PromptProfile, "id">): PromptProfile => {
      const newProfile: PromptProfile = {
        ...profile,
        id: `profile-${Date.now().toString(36)}`,
      };
      const profiles = [...getPromptProfiles(), newProfile];
      savePromptProfiles(profiles);
      setPromptProfiles(profiles);
      return newProfile;
    },
    []
  );

  const deletePromptProfile = useCallback((profileId: string) => {
    const profiles = getPromptProfiles().filter(
      (p) => p.id !== profileId && !p.isBuiltin
    );
    savePromptProfiles(profiles);
    setPromptProfiles(profiles);
    // If active profile was deleted, fall back to Interview profile.
    if (profileId === getActiveProfileId()) {
      const fallback = profiles.find((p) => p.isBuiltin) || profiles[0];
      if (fallback) {
        setActiveProfileIdState(fallback.id);
        setActiveProfileId(fallback.id);
        applyProfileToStorage(fallback);
      }
    }
  }, []);

  // Job profiles (Resume / Vacancy / Context presets)
  const [jobProfiles, setJobProfiles] = useState<JobProfile[]>(() =>
    getJobProfiles()
  );
  const [activeJobProfileId, setActiveJobProfileIdState] = useState<string>(() =>
    getActiveJobProfileId()
  );

  const applyJobProfile = useCallback((profileId: string) => {
    const profiles = getJobProfiles();
    const profile = profiles.find((p) => p.id === profileId);
    if (!profile) return;
    setActiveJobProfileIdState(profileId);
    setActiveJobProfileId(profileId);
    applyJobProfileToStorage(profile);
    setJobProfiles(getJobProfiles());
  }, []);

  const selectJobProfile = useCallback(
    (profileId: string) => {
      applyJobProfile(profileId);
    },
    [applyJobProfile]
  );

  const updateJobProfile = useCallback(
    (profileId: string, updates: Partial<JobProfile>) => {
      const profiles = getJobProfiles();
      const idx = profiles.findIndex((p) => p.id === profileId);
      if (idx === -1) return;
      const updated = { ...profiles[idx], ...updates };
      profiles[idx] = updated;
      saveJobProfiles(profiles);
      setJobProfiles(profiles);
      if (profileId === getActiveJobProfileId()) {
        applyJobProfileToStorage(updated);
      }
    },
    []
  );

  const createJobProfile = useCallback(
    (profile: Omit<JobProfile, "id">): JobProfile => {
      const newProfile: JobProfile = {
        ...profile,
        id: `job-profile-${Date.now().toString(36)}`,
      };
      const profiles = [...getJobProfiles(), newProfile];
      saveJobProfiles(profiles);
      setJobProfiles(profiles);
      return newProfile;
    },
    []
  );

  const deleteJobProfile = useCallback((profileId: string) => {
    const profiles = getJobProfiles().filter(
      (p) => p.id !== profileId && !p.isBuiltin
    );
    saveJobProfiles(profiles);
    setJobProfiles(profiles);
    if (profileId === getActiveJobProfileId()) {
      const fallback = profiles.find((p) => p.isBuiltin) || profiles[0];
      if (fallback) {
        setActiveJobProfileIdState(fallback.id);
        setActiveJobProfileId(fallback.id);
        applyJobProfileToStorage(fallback);
      }
    }
  }, []);

  const activeJobProfile = jobProfiles.find((p) => p.id === activeJobProfileId) || null;

  const [selectedAudioDevices, setSelectedAudioDevices] = useState<{
    input: { id: string; name: string };
    output: { id: string; name: string };
  }>(() => {
    const savedDevices = safeLocalStorage.getItem(
      STORAGE_KEYS.SELECTED_AUDIO_DEVICES
    );
    if (savedDevices) {
      try {
        return JSON.parse(savedDevices);
      } catch {
        // Return default on parse error
      }
    }

    return {
      input: { id: "", name: "" },
      output: { id: "", name: "" },
    };
  });

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

  // STT Providers
  const [customSttProviders, setCustomSttProviders] = useState<TYPE_PROVIDER[]>(
    []
  );
  const [selectedSttProvider, setSelectedSttProvider] = useState<{
    provider: string;
    variables: Record<string, string>;
  }>({
    provider: "",
    variables: {},
  });

  const [screenshotConfiguration, setScreenshotConfiguration] =
    useState<ScreenshotConfig>({
      mode: "manual",
      autoPrompt: "Analyze this screenshot and provide insights",
      enabled: true,
    });

  // Unified Customizable State
  const [customizable, setCustomizable] = useState<CustomizableState>(
    DEFAULT_CUSTOMIZABLE_STATE
  );
  const [hasActiveLicense, setHasActiveLicense] = useState<boolean>(false);
  const [supportsImages, setSupportsImagesState] = useState<boolean>(() => {
    const stored = safeLocalStorage.getItem(STORAGE_KEYS.SUPPORTS_IMAGES);
    return stored === null ? true : stored === "true";
  });

  // Wrapper to sync supportsImages to localStorage
  const setSupportsImages = (value: boolean) => {
    setSupportsImagesState(value);
    safeLocalStorage.setItem(STORAGE_KEYS.SUPPORTS_IMAGES, String(value));
  };

  // Pluely API State
  const [pluelyApiEnabled, setPluelyApiEnabledState] = useState<boolean>(
    safeLocalStorage.getItem(STORAGE_KEYS.PLUELY_API_ENABLED) === "true"
  );

  const getActiveLicenseStatus = async () => {
    const response: { is_active: boolean; is_dev_license: boolean } =
      await invoke("validate_license_api");
    setHasActiveLicense(response.is_active);

    if (response?.is_dev_license) {
      setPluelyApiEnabled(false);
    }

    // Check if the auto configs are enabled
    const autoConfigsEnabled = localStorage.getItem("auto-configs-enabled");
    if (response.is_active && !autoConfigsEnabled) {
      setScreenshotConfiguration({
        mode: "auto",
        autoPrompt: "Analyze the screenshot and provide insights",
        enabled: false,
      });
      // Set the flag to true so that we don't change the mode again
      localStorage.setItem("auto-configs-enabled", "true");
    }
  };

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

  // Function to load AI, STT, system prompt and screenshot config data from storage
  const loadData = () => {
    // Load system prompt
    const savedSystemPrompt = safeLocalStorage.getItem(
      STORAGE_KEYS.SYSTEM_PROMPT
    );
    if (savedSystemPrompt) {
      setSystemPrompt(savedSystemPrompt || DEFAULT_SYSTEM_PROMPT);
    }

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

    // Load custom STT providers
    const savedStt = safeLocalStorage.getItem(
      STORAGE_KEYS.CUSTOM_SPEECH_PROVIDERS
    );
    let sttList: TYPE_PROVIDER[] = [];
    if (savedStt) {
      sttList = validateAndProcessCurlProviders(savedStt, "STT");
    }
    setCustomSttProviders(sttList);

    // Load selected AI provider
    const savedSelectedAi = safeLocalStorage.getItem(
      STORAGE_KEYS.SELECTED_AI_PROVIDER
    );
    if (savedSelectedAi) {
      const parsedAi = JSON.parse(savedSelectedAi);
      // Migrate stored variables: canonicalize duplicate/case-collision keys
      if (parsedAi && typeof parsedAi === "object" && parsedAi.variables) {
        parsedAi.variables = canonicalizeVariables(parsedAi.variables);
      }
      // No legacy-model shim: the user's stored selection is the source of
      // truth. The old recurring "gemini 3.6 flash high" rewrite clobbered
      // newer user selections and re-persisted them every app start.
      setSelectedAIProvider(parsedAi);
    } else {
      // Default to Nullform AI Gateway with gemini-3.6-flash-low
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

    // Load selected STT provider
    const savedSelectedStt = safeLocalStorage.getItem(
      STORAGE_KEYS.SELECTED_STT_PROVIDER
    );
    if (savedSelectedStt) {
      setSelectedSttProvider(JSON.parse(savedSelectedStt));
    } else {
      // Default to the local Handy STT server (whisper over HTTP on :8000)
      const defaultStt = {
        provider: "handy-local-whisper",
        variables: {},
      };
      setSelectedSttProvider(defaultStt);
      safeLocalStorage.setItem(
        STORAGE_KEYS.SELECTED_STT_PROVIDER,
        JSON.stringify(defaultStt)
      );
    }

    // Load customizable state
    const customizableState = getCustomizableState();
    setCustomizable(customizableState);

    updateCursor(customizableState.cursor.type || "invisible");
    if (customizableState.stealth) {
      invoke("set_stealth_mode", { enabled: customizableState.stealth.isEnabled }).catch((err) => {
        console.debug("Failed to apply initial stealth mode:", err);
      });
    }
    const stored = safeLocalStorage.getItem(STORAGE_KEYS.CUSTOMIZABLE);
    if (!stored) {
      // save the default state
      setCustomizableState(customizableState);
    } else {
      // check if we need to update the schema
      try {
        const parsed = JSON.parse(stored);
        if (!parsed.autostart) {
          // save the merged state with new autostart property
          setCustomizableState(customizableState);
          updateCursor(customizableState.cursor.type || "invisible");
        }
      } catch (error) {
        console.debug("Failed to check customizable state schema:", error);
      }
    }

    // Load Pluely API enabled state
    const savedPluelyApiEnabled = safeLocalStorage.getItem(
      STORAGE_KEYS.PLUELY_API_ENABLED
    );
    if (savedPluelyApiEnabled !== null) {
      setPluelyApiEnabledState(savedPluelyApiEnabled === "true");
    }

    // Load selected audio devices
    const savedAudioDevices = safeLocalStorage.getItem(
      STORAGE_KEYS.SELECTED_AUDIO_DEVICES
    );
    if (savedAudioDevices) {
      try {
        const parsed = JSON.parse(savedAudioDevices);
        if (parsed && typeof parsed === "object") {
          setSelectedAudioDevices(parsed);
        }
      } catch {
        console.warn("Failed to parse selected audio devices");
      }
    }
  };

  const updateCursor = (type: CursorType | undefined) => {
    try {
      const currentWindow = getCurrentWindow();
      const platform = getPlatform();
      // For Linux, always use default cursor
      if (platform === "linux") {
        document.documentElement.style.setProperty("--cursor-type", "default");
        return;
      }
      const windowLabel = currentWindow.label;

      if (windowLabel === "dashboard") {
        // For dashboard, always use default cursor
        document.documentElement.style.setProperty("--cursor-type", "default");
        return;
      }

      // For overlay windows (main, capture-overlay-*)
      const safeType = type || "invisible";
      const cursorValue = type === "invisible" ? "none" : safeType;
      document.documentElement.style.setProperty("--cursor-type", cursorValue);
    } catch (error) {
      document.documentElement.style.setProperty("--cursor-type", "default");
    }
  };

  // Load data on mount
  useEffect(() => {
    const initializeApp = async () => {
      // Load license and data
      await getActiveLicenseStatus();

      // Track app start
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
    // Load data
    loadData();
    initializeApp();
  }, []);

  // Handle customizable settings on state changes
  useEffect(() => {
    const applyCustomizableSettings = async () => {
      try {
        await Promise.all([
          invoke("set_app_icon_visibility", {
            visible: customizable.appIcon.isVisible,
          }),
          invoke("set_always_on_top", {
            enabled: customizable.alwaysOnTop.isEnabled,
          }),
        ]);
      } catch (error) {
        console.error("Failed to apply customizable settings:", error);
      }
    };

    applyCustomizableSettings();
  }, [customizable]);

  useEffect(() => {
    const initializeAutostart = async () => {
      try {
        const autostartInitialized = safeLocalStorage.getItem(
          STORAGE_KEYS.AUTOSTART_INITIALIZED
        );

        // Only apply autostart on the very first launch
        if (!autostartInitialized) {
          const autostartEnabled = customizable?.autostart?.isEnabled ?? true;

          if (autostartEnabled) {
            await enable();
          } else {
            await disable();
          }

          // Mark as initialized so this never runs again
          safeLocalStorage.setItem(STORAGE_KEYS.AUTOSTART_INITIALIZED, "true");
        }
      } catch (error) {
        console.debug("Autostart initialization skipped:", error);
      }
    };

    initializeAutostart();
  }, []);

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
      // Only hide app icon if user has set it to hide mode
      if (!currentState.appIcon.isVisible) {
        await handleAppIconVisibility(false);
      }
    });

    const unlistenShow = listen("handle-app-icon-on-show", async () => {
      // Always show app icon when window is shown, regardless of user setting
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
      // Sync supportsImages across windows
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
  }, []);

  // Apply the active prompt profile's settings on app start so the
  // Interview / General / custom profile is active from the first moment.
  useEffect(() => {
    const profile = getActiveProfile();
    applyProfileToStorage(profile);
    setSystemPrompt(profile.systemPrompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Check if the current AI provider/model supports images
  useEffect(() => {
    const checkImageSupport = async () => {
      if (pluelyApiEnabled) {
        // For Pluely API, check the selected model's modality
        try {
          const storage = await invoke<{
            selected_pluely_model?: string;
          }>("secure_storage_get");

          if (storage.selected_pluely_model) {
            const model = JSON.parse(storage.selected_pluely_model);
            const hasImageSupport = model.modality?.includes("image") ?? false;
            setSupportsImages(hasImageSupport);
          } else {
            // No model selected, assume no image support
            setSupportsImages(false);
          }
        } catch (error) {
          setSupportsImages(false);
        }
      } else {
        // For custom AI providers, check if curl contains {{IMAGE}}
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
  }, [pluelyApiEnabled, selectedAIProvider.provider]);

  // Sync selected AI to localStorage
  useEffect(() => {
    if (selectedAIProvider.provider) {
      safeLocalStorage.setItem(
        STORAGE_KEYS.SELECTED_AI_PROVIDER,
        JSON.stringify(selectedAIProvider)
      );
    }
  }, [selectedAIProvider]);

  // Sync selected STT to localStorage
  useEffect(() => {
    if (selectedSttProvider.provider) {
      safeLocalStorage.setItem(
        STORAGE_KEYS.SELECTED_STT_PROVIDER,
        JSON.stringify(selectedSttProvider)
      );
    }
  }, [selectedSttProvider]);

  // Computed all AI providers
  const allAiProviders: TYPE_PROVIDER[] = [
    ...AI_PROVIDERS,
    ...customAiProviders,
  ];

  // Computed all STT providers
  const allSttProviders: TYPE_PROVIDER[] = [
    ...SPEECH_TO_TEXT_PROVIDERS,
    ...customSttProviders,
  ];

  const onSetSelectedAIProvider = ({
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

    // Update supportsImages immediately when provider changes
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

    const canonicalVars = canonicalizeVariables(variables);
    setSelectedAIProvider((prev) => ({
      ...prev,
      provider,
      variables: canonicalVars,
    }));
  };

  // Setter for selected STT with validation
  const onSetSelectedSttProvider = ({
    provider,
    variables,
  }: {
    provider: string;
    variables: Record<string, string>;
  }) => {
    if (provider && !allSttProviders.some((p) => p.id === provider)) {
      console.warn(`Invalid STT provider ID: ${provider}`);
      return;
    }

    setSelectedSttProvider((prev) => ({ ...prev, provider, variables }));
  };

  // Toggle handlers
  const toggleAppIconVisibility = async (isVisible: boolean) => {
    const newState = updateAppIconVisibility(isVisible);
    setCustomizable(newState);
    try {
      await invoke("set_app_icon_visibility", { visible: isVisible });
      loadData();
    } catch (error) {
      console.error("Failed to toggle app icon visibility:", error);
    }
  };

  const toggleAlwaysOnTop = async (isEnabled: boolean) => {
    const newState = updateAlwaysOnTop(isEnabled);
    setCustomizable(newState);
    try {
      await invoke("set_always_on_top", { enabled: isEnabled });
      loadData();
    } catch (error) {
      console.error("Failed to toggle always on top:", error);
    }
  };

  const toggleStealthMode = async (isEnabled: boolean) => {
    const newState = updateStealthMode(isEnabled);
    setCustomizable(newState);
    try {
      await invoke("set_stealth_mode", { enabled: isEnabled });
      loadData();
    } catch (error) {
      console.error("Failed to toggle stealth mode:", error);
    }
  };

  const toggleAutostart = async (isEnabled: boolean) => {
    const newState = updateAutostart(isEnabled);
    setCustomizable(newState);
    try {
      if (isEnabled) {
        await enable();
      } else {
        await disable();
      }
      loadData();
    } catch (error) {
      console.error("Failed to toggle autostart:", error);
      const revertedState = updateAutostart(!isEnabled);
      setCustomizable(revertedState);
    }
  };

  const setCursorType = (type: CursorType) => {
    setCustomizable((prev) => ({ ...prev, cursor: { type } }));
    updateCursor(type);
    updateCursorType(type);
    loadData();
  };

  const setPluelyApiEnabled = async (enabled: boolean) => {
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
          // No model selected, assume no image support
          setSupportsImages(false);
        }
      } catch (error) {
        console.debug("Failed to check Pluely model image support:", error);
        setSupportsImages(false);
      }
    } else {
      // Switching to regular provider - check if curl contains {{IMAGE}}
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
  };

  // Create the context value (extend IContextType accordingly)
  const value: IContextType = {
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
    activeProfileId,
    selectPromptProfile,
    updatePromptProfile,
    createPromptProfile,
    deletePromptProfile,
    jobProfiles,
    activeJobProfileId,
    activeJobProfile,
    selectJobProfile,
    updateJobProfile,
    createJobProfile,
    deleteJobProfile,
    applyJobProfile,
  };

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
