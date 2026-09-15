import { useState, useCallback, useEffect } from "react";
import { Header, Button, Label, Input, Switch } from "@/components";
import {
  GlobeIcon,
  SearchIcon,
  CheckCircle2Icon,
  Loader2Icon,
  ExternalLinkIcon,
} from "lucide-react";
import {
  getWebSearchSettings,
  saveWebSearchSettings,
  getWebSearchKey,
  setWebSearchKey,
  WebSearchSettings,
  performWebSearch,
  SearchProvider,
  type KeyedSearchProvider,
} from "@/lib/web-search";
import { cn } from "@/lib/utils";

const KEYED_PROVIDER_IDS: SearchProvider[] = ["brave", "exa", "tavily"];

export const ToolsSettings = () => {
  const [settings, setSettings] = useState<WebSearchSettings>(() => getWebSearchSettings());
  const [testQuery, setTestQuery] = useState("Latest React 19 features");
  const [testResults, setTestResults] = useState<{ title: string; url: string; snippet: string }[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [saved, setSaved] = useState(false);
  // Ключи живут в защищённом хранилище, поэтому подтягиваются асинхронно и
  // только для показа в поле ввода — в настройках они не сохраняются.
  const [searchKeys, setSearchKeys] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const loaded: Record<string, string> = {};
      for (const id of KEYED_PROVIDER_IDS) {
        const value = await getWebSearchKey(id as KeyedSearchProvider);
        if (value) loaded[id] = value;
      }
      if (!cancelled) setSearchKeys(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const updateSetting = useCallback(<K extends keyof WebSearchSettings>(key: K, value: WebSearchSettings[K]) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      saveWebSearchSettings(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      return next;
    });
  }, []);

  const handleKeyChange = useCallback((id: SearchProvider, value: string) => {
    setSearchKeys((prev) => ({ ...prev, [id]: value }));
    void setWebSearchKey(id as KeyedSearchProvider, value);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, []);

  const handleTestSearch = useCallback(async () => {
    if (!testQuery.trim()) return;
    setIsSearching(true);
    try {
      const results = await performWebSearch(testQuery.trim());
      setTestResults(results);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSearching(false);
    }
  }, [testQuery]);

  const providers: { id: SearchProvider; name: string; desc: string; requiresKey: boolean }[] = [
    {
      id: "duckduckgo",
      name: "DuckDuckGo (Free / No Key)",
      desc: "Instant zero-config web search, works out of the box with 0 API keys",
      requiresKey: false,
    },
    {
      id: "brave",
      name: "Brave Search API",
      desc: "Fast, independent web search index with rich snippets",
      requiresKey: true,
    },
    {
      id: "exa",
      name: "Exa.ai Neural Search",
      desc: "Semantic AI web search designed for LLM research agents",
      requiresKey: true,
    },
    {
      id: "tavily",
      name: "Tavily AI Research",
      desc: "Optimized for factual extraction and real-time knowledge retrieval",
      requiresKey: true,
    },
  ];

  return (
    <div id="tools-mcp" className="space-y-3">
      <Header
        title="Web Search & Skills (Live Research)"
        description="Allow the AI to search the web in real-time for live facts, documentation, news and market research"
      />

      {/* Main Toggle Card */}
      <div className="rounded-xl border border-border/50 bg-muted/10 p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GlobeIcon className="size-4 text-primary" />
            <div>
              <div className="flex items-center gap-2">
                <Label className="text-sm font-semibold">Enable Live Web Search</Label>
                {saved && (
                  <span className="flex items-center gap-1 text-[10px] text-emerald-500 font-medium">
                    <CheckCircle2Icon className="size-3" /> Saved
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                When active, questions requiring fresh facts or documentation trigger instant web retrieval
              </p>
            </div>
          </div>
          <Switch
            checked={settings.enabled}
            onCheckedChange={(checked) => updateSetting("enabled", checked)}
          />
        </div>

        {settings.enabled && (
          <div className="space-y-3 pt-2 border-t border-border/40 animate-in fade-in duration-150">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Search Provider
            </Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {providers.map((p) => {
                const isSelected = settings.provider === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => updateSetting("provider", p.id)}
                    className={cn(
                      "p-3 rounded-lg border text-left transition-all cursor-pointer flex flex-col justify-between",
                      isSelected
                        ? "border-primary bg-primary/5 shadow-sm"
                        : "border-border/40 bg-background/50 hover:border-primary/40"
                    )}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-semibold">{p.name}</span>
                        {isSelected && <CheckCircle2Icon className="size-3.5 text-primary" />}
                      </div>
                      <p className="text-[10px] text-muted-foreground line-clamp-2">
                        {p.desc}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* API Key inputs for providers that need it */}
            {settings.provider === "brave" && (
              <div className="space-y-1 pt-1">
                <Label className="text-xs font-medium">Brave Search API Key</Label>
                <Input
                  type="password"
                  value={searchKeys.brave || ""}
                  onChange={(e) => handleKeyChange("brave", e.target.value)}
                  placeholder="BSA..."
                  className="h-8 text-xs font-mono"
                />
              </div>
            )}

            {settings.provider === "exa" && (
              <div className="space-y-1 pt-1">
                <Label className="text-xs font-medium">Exa.ai API Key</Label>
                <Input
                  type="password"
                  value={searchKeys.exa || ""}
                  onChange={(e) => handleKeyChange("exa", e.target.value)}
                  placeholder="exa_..."
                  className="h-8 text-xs font-mono"
                />
              </div>
            )}

            {settings.provider === "tavily" && (
              <div className="space-y-1 pt-1">
                <Label className="text-xs font-medium">Tavily API Key</Label>
                <Input
                  type="password"
                  value={searchKeys.tavily || ""}
                  onChange={(e) => handleKeyChange("tavily", e.target.value)}
                  placeholder="tvly-..."
                  className="h-8 text-xs font-mono"
                />
              </div>
            )}

            {settings.provider !== "duckduckgo" && (
              <p className="text-[10px] text-muted-foreground">
                Ключ хранится в защищённом хранилище ОС, а не в localStorage.
              </p>
            )}

            {/* Test Search Area */}
            <div className="pt-2 border-t border-border/40 space-y-2">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Test Live Search
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  value={testQuery}
                  onChange={(e) => setTestQuery(e.target.value)}
                  placeholder="Search query..."
                  className="h-8 text-xs"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleTestSearch();
                  }}
                />
                <Button
                  size="sm"
                  className="h-8 px-3 text-xs gap-1.5 shrink-0"
                  onClick={handleTestSearch}
                  disabled={isSearching}
                >
                  {isSearching ? <Loader2Icon className="size-3.5 animate-spin" /> : <SearchIcon className="size-3.5" />}
                  Search
                </Button>
              </div>

              {testResults && (
                <div className="space-y-1.5 p-2 rounded-lg bg-background/80 border border-border/40 max-h-48 overflow-y-auto">
                  {testResults.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">No results found.</p>
                  ) : (
                    testResults.map((r, i) => (
                      <div key={i} className="text-xs space-y-0.5 border-b border-border/30 pb-1.5 last:border-b-0">
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noreferrer"
                          className="font-semibold text-primary hover:underline flex items-center gap-1"
                        >
                          {r.title}
                          <ExternalLinkIcon className="size-2.5 opacity-60" />
                        </a>
                        <p className="text-[10px] text-muted-foreground line-clamp-2">{r.snippet}</p>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
