import { useState, useEffect, useMemo, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  RotateCcw,
  AudioLines,
  Languages,
  Trash2,
  Download,
  Loader2,
  Search,
  AlertCircle,
  X,
} from "lucide-react";
import { Input, Button } from "@/components";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  listModels,
  modelCatalog,
  selectedModel,
  sttReadiness,
  downloadModel,
  deleteModel,
  selectModel,
  formatSize,
  type ModelEntry,
  type InstalledModel,
  type ModelDownloadProgress,
  type SttReadiness,
} from "@/lib/storage/app-paths";
import {
  supportsLanguageCode,
  getUniqueCapabilityLanguages,
  getLanguageLabel,
} from "@/lib/constants/languages";
import { LanguageFilterDropdown } from "./LanguageFilterDropdown";
import { resetAsrBaseUrlCache } from "@/lib/asr-discovery";
import { cn } from "@/lib/utils";

type SortOption = "name" | "accuracy" | "speed" | "size";

/**
 * Orders two catalogue entries by the active sort option.
 *
 * Shared by both lists on this page. The downloaded list used to render in
 * whatever order the backend returned, so pressing the speed or accuracy button
 * — which sits in the *Downloaded Models* header — reordered only the catalogue
 * below it. The toolbar therefore looked broken exactly for the models a user
 * has: the ones they were looking at.
 */
export function compareModels(
  a: ModelEntry,
  b: ModelEntry,
  sortBy: SortOption,
  sortDirection: "asc" | "desc"
): number {
  let comparison = 0;
  switch (sortBy) {
    case "accuracy":
      comparison = (a.accuracy_score ?? 0) - (b.accuracy_score ?? 0);
      break;
    case "speed":
      comparison = (a.speed_score ?? 0) - (b.speed_score ?? 0);
      break;
    case "size": {
      const aSize = a.files[0]?.size_bytes ?? 0;
      const bSize = b.files[0]?.size_bytes ?? 0;
      comparison = aSize - bSize;
      break;
    }
    case "name":
      comparison = a.name.localeCompare(b.name);
      break;
  }
  return sortDirection === "asc" ? comparison : -comparison;
}

/**
 * Human label for a model's language support.
 *
 * The catalogue stores recognition codes, so a one-language model must be named
 * after the language it actually handles — calling a Russian-only GigaAM model
 * "English only" is simply wrong and made the language filter look broken.
 */
function describeLanguages(model: ModelEntry): string {
  const unique = getUniqueCapabilityLanguages(model.languages);
  if (unique.length === 0) return "Unknown languages";
  if (unique.length === 1) {
    return `${getLanguageLabel(unique[0]) ?? unique[0]} only`;
  }
  return `${unique.length} languages`;
}
function formatError(error: unknown, fallback: string): string {
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  if (error && typeof error === "object" && "message" in error) {
    const msg = error.message;
    if (typeof msg === "string" && msg.trim()) return msg.trim();
  }
  return fallback;
}


/**
 * Language badge with the full list behind it.
 *
 * The count alone made a correct language-filter match look wrong (a model
 * listed under «Русский» while its description says «25 европейских языков»),
 * so the list is one click away instead of being a claim the user has to take
 * on faith.
 */
function ModelLanguages({
  model,
  matchedLanguage,
}: {
  model?: ModelEntry;
  /** Recognition code of the active filter, e.g. `ru`; null when no filter. */
  matchedLanguage?: string | null;
}) {
  const languages = getUniqueCapabilityLanguages(model?.languages);
  // A model that speaks only the filtered language needs no second chip: the
  // badge already says everything, and the repeat read as a filter bug.
  const showMatched =
    !!matchedLanguage && !(languages.length === 1 && languages[0] === matchedLanguage);

  return (
    <span className="flex items-center gap-1">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-1 hover:text-foreground transition-colors"
            title="Показать список языков"
          >
            <Languages className="w-3.5 h-3.5" />
            {model ? describeLanguages(model) : "Offline"}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-3">
          <p className="text-xs font-medium mb-2">
            {model ? model.name : "Модель"}
          </p>
          <p className="text-[11px] text-muted-foreground max-h-48 overflow-y-auto leading-relaxed">
            {languages.length > 0
              ? languages.map((code) => getLanguageLabel(code) ?? code).join(", ")
              : "Языки не указаны"}
          </p>
        </PopoverContent>
      </Popover>
      {showMatched && (
        <span className="flex items-center gap-1">
          {getLanguageLabel(matchedLanguage!) ?? matchedLanguage}
        </span>
      )}
    </span>
  );
}

/**
 * Whether a catalogue entry survives the page's search box and language filter.
 *
 * Shared by the catalogue and the downloaded list: both toolbars are the same
 * controls, and two copies of this predicate drift — the downloaded copy had
 * already lost the sort and skipped the language test for uncatalogued files.
 */
export function matchesFilters(
  model: ModelEntry,
  searchQuery: string,
  selectedLanguage: string
): boolean {
  const matchesSearch =
    searchQuery === "" ||
    model.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    model.description.toLowerCase().includes(searchQuery.toLowerCase());

  const matchesLanguage =
    selectedLanguage === "all" ||
    supportsLanguageCode(model.languages, selectedLanguage);

  return matchesSearch && matchesLanguage;
}

/**
 * Applies the toolbar to the downloaded list: search, language, then sort.
 *
 * Extracted from the component so the ordering can be tested without a DOM. The
 * list previously had no sort at all, and nothing verified it — the bug survived
 * because the sort buttons simply had no effect on this list, which is invisible
 * until you have two downloaded models with different scores.
 */
export function selectDownloadedModels(
  downloaded: InstalledModel[],
  catalog: ModelEntry[],
  filters: {
    searchQuery: string;
    selectedLanguage: string;
    sortBy: SortOption;
    sortDirection: "asc" | "desc";
  }
): InstalledModel[] {
  const { searchQuery, selectedLanguage, sortBy, sortDirection } = filters;
  return downloaded
    .filter((file) => {
      const model = catalog.find((m) => m.id === file.model_id);
      if (!model) {
        // A model installed by hand has no catalogue entry, so there is no
        // language list to test. It used to skip the language filter entirely,
        // which meant picking "Russian" left unrelated files visible while
        // hiding nothing — the filter appeared not to work for these rows.
        //
        // The only signal such a file carries is its name, and the test must be
        // token-exact: a substring match would let the code `en` match
        // "nemotron" and `it` match "quantized", so a filter would silently keep
        // files unrelated to the chosen language.
        const name = file.file_name.toLowerCase();
        const tokens = name.split(/[^a-z0-9]+/).filter(Boolean);
        const matchesSearch = searchQuery === "" || name.includes(searchQuery.toLowerCase());
        const matchesLanguage =
          selectedLanguage === "all" || tokens.includes(selectedLanguage.toLowerCase());
        return matchesSearch && matchesLanguage;
      }
      return matchesFilters(model, searchQuery, selectedLanguage);
    })
    .sort((a, b) => {
      const modelA = catalog.find((m) => m.id === a.model_id);
      const modelB = catalog.find((m) => m.id === b.model_id);
      // Entries without a catalogue row have no scores or catalogue name; order
      // them by file name so they still move with the sort.
      if (!modelA || !modelB) {
        return sortDirection === "asc"
          ? a.file_name.localeCompare(b.file_name)
          : b.file_name.localeCompare(a.file_name);
      }
      return compareModels(modelA, modelB, sortBy, sortDirection);
    });
}

export const Models = () => {
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [downloadedModels, setDownloadedModels] = useState<InstalledModel[]>([]);
  const [activeModel, setActiveModel] = useState<InstalledModel | null>(null);
  const [, setReadiness] = useState<SttReadiness | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLanguage, setSelectedLanguage] = useState<string>("all");
  const [sortBy, setSortBy] = useState<SortOption>("accuracy");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  const [downloadingModelId, setDownloadingModelId] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Load models on mount
  const loadModels = useCallback(async () => {
    setIsLoading(true);
    try {
      const [catalog, installed, active, ready] = await Promise.all([
        modelCatalog(),
        listModels(),
        selectedModel(),
        sttReadiness(),
      ]);
      setModels(catalog);
      setDownloadedModels(installed);
      setActiveModel(active);
      setReadiness(ready);
    } catch (error) {
      console.error("Failed to load models:", error);
      setErrorMessage(formatError(error, "Failed to load models"));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadModels();
  }, [loadModels]);

  // Listen to download progress
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void listen<ModelDownloadProgress>("model-download-progress", (event) => {
      const p = event.payload;
      if (p.total && p.total > 0) {
        const pct = Math.round((p.downloaded / p.total) * 100);
        setDownloadProgress(pct);
      }
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // Map of downloaded model files
  const downloadedFilesSet = useMemo(() => {
    return new Set(downloadedModels.map((m) => m.file_name));
  }, [downloadedModels]);

  // Handle model download
  const handleDownload = async (model: ModelEntry) => {
    const file = model.files.find((f) => f.filename === model.default_file) ?? model.files[0];
    if (!file) return;

    setDownloadingModelId(model.id);
    setDownloadProgress(0);
    setErrorMessage(null);

    try {
      await downloadModel(model.id, file.quant);
      // Downloading also activates the model and restarts the engine.
      resetAsrBaseUrlCache();
      await loadModels();
    } catch (error) {
      console.error("Failed to download model:", error);
      setErrorMessage(formatError(error, `Failed to download model ${model.name}`));
    } finally {
      setDownloadingModelId(null);
      setDownloadProgress(0);
    }
  };

  // Handle model deletion
  const handleDelete = async (file: InstalledModel) => {
    setErrorMessage(null);
    try {
      await deleteModel(file.file_name);
      await loadModels();
    } catch (error) {
      console.error("Failed to delete model:", error);
      setErrorMessage(formatError(error, `Failed to delete model ${file.file_name}`));
    }
  };

  // Handle selecting / activating a model
  const handleSelectModel = async (file: InstalledModel) => {
    setErrorMessage(null);
    try {
      await selectModel(file.path);
      // The engine restarts on the new file and may rebind another port, so the
      // renderer must not keep posting to the port it resolved before.
      resetAsrBaseUrlCache();
      await loadModels();
    } catch (error) {
      console.error("Failed to select model:", error);
      setErrorMessage(formatError(error, `Failed to select model ${file.file_name}`));
    }
  };

  // Filter and sort available models
  const filteredAvailableModels = useMemo(() => {
    return models
      .filter((model) => {
        // Exclude downloaded models from available list
        const isDownloaded = model.files.some((f) => downloadedFilesSet.has(f.filename));
        if (isDownloaded) return false;

        return matchesFilters(model, searchQuery, selectedLanguage);
      })
      .sort((a, b) => compareModels(a, b, sortBy, sortDirection));
  }, [models, downloadedFilesSet, searchQuery, selectedLanguage, sortBy, sortDirection]);

  // Filter and sort downloaded models.
  //
  // The sort applies here too: the speed/accuracy buttons live in this section's
  // header, so a user pressing them is ordering the list right below the button,
  // not the catalogue further down. Leaving this list unsorted made the toolbar
  // look inert for exactly the models the user already has.
  const filteredDownloadedModels = useMemo(
    () =>
      selectDownloadedModels(downloadedModels, models, {
        searchQuery,
        selectedLanguage,
        sortBy,
        sortDirection,
      }),
    [downloadedModels, models, searchQuery, selectedLanguage, sortBy, sortDirection]
  );

  // Toggle sort direction
  const handleSortToggle = (newSortBy: SortOption) => {
    if (sortBy === newSortBy) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(newSortBy);
      setSortDirection("desc");
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full min-h-0 overflow-hidden">
      {/* Header */}
      <header className="pt-6 pb-2 shrink-0">
        <h1 className="text-2xl font-bold text-foreground">SST Models</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Select a speech-to-text model or download local models for offline transcription.
        </p>

        {/* Search bar */}
        <div className="relative mt-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search models by name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 bg-card border-border/60 text-sm h-10 rounded-xl"
          />
        </div>
      </header>
      {/* Error banner */}
      {errorMessage && (
        <div className="mt-2 mb-1 p-3 bg-destructive/10 border border-destructive/20 rounded-xl text-sm text-destructive flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="truncate">{errorMessage}</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0 text-destructive hover:text-destructive hover:bg-destructive/20 rounded-lg"
            onClick={() => setErrorMessage(null)}
            title="Dismiss error"
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}

      {/* Scrollable Model Lists */}
      <div className="flex-1 overflow-y-auto pr-2 pb-16 space-y-6 pt-2">
        {/* Downloaded Models Section */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Downloaded Models ({filteredDownloadedModels.length})
            </h2>

            {/* Filter toolbar: Refresh, Speed sort, Language sort, Language select */}
            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={loadModels}
                title="Refresh models"
              >
                <RotateCcw className={cn("w-3.5 h-3.5", isLoading && "animate-spin")} />
              </Button>

              <Button
                variant={sortBy === "speed" ? "secondary" : "ghost"}
                size="icon"
                className={cn("h-8 w-8 text-muted-foreground hover:text-foreground", sortBy === "speed" && "text-primary")}
                onClick={() => handleSortToggle("speed")}
                title={`Sort by speed (${sortBy === "speed" ? sortDirection : "desc"})`}
              >
                <AudioLines className="w-3.5 h-3.5" />
              </Button>

              <Button
                variant={sortBy === "accuracy" ? "secondary" : "ghost"}
                size="icon"
                className={cn("h-8 w-8 text-muted-foreground hover:text-foreground", sortBy === "accuracy" && "text-primary")}
                onClick={() => handleSortToggle("accuracy")}
                title={`Sort by accuracy (${sortBy === "accuracy" ? sortDirection : "desc"})`}
              >
                <Languages className="w-3.5 h-3.5" />
              </Button>

              {/* Language filter dropdown */}
              <LanguageFilterDropdown
                value={selectedLanguage}
                onChange={setSelectedLanguage}
                models={models}
              />
            </div>
          </div>

          {/* Downloaded list */}
          {filteredDownloadedModels.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/60 p-6 text-center text-xs text-muted-foreground">
              No downloaded models found matching the filter.
            </div>
          ) : (
            <div className="space-y-2.5">
              {filteredDownloadedModels.map((file) => {
                const model = models.find((m) => m.id === file.model_id);
                const isActive = activeModel?.file_name === file.file_name;

                return (
                  <div
                    key={file.file_name}
                    className={cn(
                      "rounded-xl border p-4 transition-all",
                      isActive
                        ? "border-primary bg-primary/10 shadow-sm"
                        : "border-border/60 bg-card hover:border-border"
                    )}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-sm font-semibold text-foreground">
                            {model?.name ?? file.file_name}
                          </h3>
                          {isActive && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-foreground px-2.5 py-0.5 text-[11px] font-semibold text-background shadow-xs">
                              ✓ Active
                            </span>
                          )}
                          {!isActive && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-6 text-[11px] px-2"
                              onClick={() => handleSelectModel(file)}
                            >
                              Use
                            </Button>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                          {model?.description ?? "Local downloaded speech model"}
                        </p>
                      </div>

                      {/* Accuracy & Speed metrics for downloaded */}
                      {model && (
                        <div className="shrink-0 flex flex-col gap-1.5 w-36">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-muted-foreground text-[10px]">accuracy</span>
                            <div className="h-1.5 w-20 rounded-full bg-muted overflow-hidden">
                              <div
                                className="h-full rounded-full bg-foreground"
                                style={{ width: `${model.accuracy_score ?? 70}%` }}
                              />
                            </div>
                          </div>
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-muted-foreground text-[10px]">speed</span>
                            <div className="h-1.5 w-20 rounded-full bg-muted overflow-hidden">
                              <div
                                className="h-full rounded-full bg-foreground"
                                style={{ width: `${model.speed_score ?? 70}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Metadata & Actions row */}
                    <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-border/40 text-xs text-muted-foreground">
                      <div className="flex items-center gap-3">
                        <ModelLanguages model={model} matchedLanguage={selectedLanguage === "all" ? null : selectedLanguage} />
                        {model?.capabilities.streaming && (
                          <span className="flex items-center gap-1">
                            <AudioLines className="w-3.5 h-3.5" />
                            Streaming
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-3">
                        <span>{formatSize(file.size_bytes)}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10 gap-1 px-2"
                          onClick={() => handleDelete(file)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Delete
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Available to Download Section */}
        <section className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Available to Download ({filteredAvailableModels.length})
            </h2>
          </div>

          {filteredAvailableModels.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/60 p-6 text-center text-xs text-muted-foreground">
              No models available matching the filter.
            </div>
          ) : (
            <div className="space-y-2.5">
              {filteredAvailableModels.map((model) => {
                const defaultFile = model.files.find((f) => f.filename === model.default_file) ?? model.files[0];
                const isDownloading = downloadingModelId === model.id;

                return (
                  <div
                    key={model.id}
                    className="rounded-xl border border-border/60 bg-card p-4 hover:border-border/90 transition-all"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-sm font-semibold text-foreground">{model.name}</h3>
                          {model.recommended && (
                            <span className="rounded-full bg-[#f472b6] px-2 py-0.5 text-[10px] font-medium text-white">
                              Recommended
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                          {model.description}
                        </p>
                      </div>

                      {/* Accuracy & Speed metrics on the right */}
                      <div className="shrink-0 flex flex-col gap-1.5 w-36">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-muted-foreground text-[10px]">accuracy</span>
                          <div className="h-1.5 w-20 rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full rounded-full bg-foreground"
                              style={{ width: `${model.accuracy_score ?? 70}%` }}
                            />
                          </div>
                        </div>
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-muted-foreground text-[10px]">speed</span>
                          <div className="h-1.5 w-20 rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full rounded-full bg-foreground"
                              style={{ width: `${model.speed_score ?? 70}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Footer Row */}
                    <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-border/40 text-xs text-muted-foreground">
                      <div className="flex items-center gap-3">
                        <ModelLanguages model={model} matchedLanguage={selectedLanguage === "all" ? null : selectedLanguage} />
                        {model.capabilities.streaming && (
                          <span className="flex items-center gap-1">
                            <AudioLines className="w-3.5 h-3.5" />
                            Streaming
                          </span>
                        )}
                        {model.capabilities.translate && (
                          <span className="flex items-center gap-1">
                            Translate
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-3">
                        {defaultFile && (
                          <span>{formatSize(defaultFile.size_bytes)}</span>
                        )}

                        {isDownloading ? (
                          <div className="flex items-center gap-2">
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                            <span className="text-xs font-medium">
                              {downloadProgress}%
                            </span>
                          </div>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs gap-1.5 px-2.5 font-medium hover:bg-primary/10 hover:text-primary transition-colors"
                            onClick={() => handleDownload(model)}
                          >
                            <Download className="w-3.5 h-3.5" />
                            Download
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default Models;
