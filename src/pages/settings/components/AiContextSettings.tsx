import { useCallback, useEffect, useState } from "react";
import { Loader2, Database, CheckCircle2 } from "lucide-react";
import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useApp } from "@/contexts";
import { STORAGE_KEYS, DEFAULT_SYSTEM_PROMPT } from "@/config/constants";
import { safeLocalStorage } from "@/lib/storage/helper";
import { getAllSystemPrompts } from "@/lib/database";
import { ResumeContext } from "./ResumeContext";
import { JobContext } from "./JobContext";
import { HumanizerSettings } from "./HumanizerSettings";

/**
 * Unified AI Context settings: system prompt, resume, job description and
 * humanizer rules in one place. The system prompt is stored in localStorage
 * (the same key the floating window reads) and can be imported from the
 * legacy system_prompts database table.
 */
export function AiContextSettings() {
  const { systemPrompt, setSystemPrompt } = useApp();
  const [draft, setDraft] = useState(systemPrompt);
  const [saved, setSaved] = useState(false);
  const [dbPrompts, setDbPrompts] = useState<
    { id: number; name: string; prompt: string }[]
  >([]);
  const [loadingDb, setLoadingDb] = useState(false);
  const [importedId, setImportedId] = useState<number | null>(null);

  useEffect(() => {
    setDraft(systemPrompt);
  }, [systemPrompt]);

  // Load legacy prompts from the database for migration.
  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoadingDb(true);
      try {
        const prompts = await getAllSystemPrompts();
        if (mounted) setDbPrompts(prompts);
      } catch {
        // DB unavailable - nothing to migrate
      } finally {
        if (mounted) setLoadingDb(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const handleSave = useCallback(() => {
    const value = draft.trim() || DEFAULT_SYSTEM_PROMPT;
    setSystemPrompt(value);
    safeLocalStorage.setItem(STORAGE_KEYS.SYSTEM_PROMPT, value);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [draft, setSystemPrompt]);

  const handleImport = useCallback(
    (prompt: { id: number; prompt: string }) => {
      setDraft(prompt.prompt);
      setSystemPrompt(prompt.prompt);
      safeLocalStorage.setItem(STORAGE_KEYS.SYSTEM_PROMPT, prompt.prompt);
      setImportedId(prompt.id);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
    [setSystemPrompt]
  );

  return (
    <div id="ai-context" className="space-y-3">
      <Header
        title="AI Context"
        description="System prompt, resume, job description and humanizer - everything the AI knows about you"
        isMainTitle
      />
      <Tabs defaultValue="prompt" className="w-full">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="prompt">System Prompt</TabsTrigger>
          <TabsTrigger value="resume">Resume</TabsTrigger>
          <TabsTrigger value="job">Job</TabsTrigger>
          <TabsTrigger value="humanizer">Humanizer</TabsTrigger>
        </TabsList>

        <TabsContent value="prompt" className="space-y-3 pt-3">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="How should the AI behave? (e.g. answer in Russian, be concise, act as a meeting assistant...)"
            className="min-h-[160px]"
          />
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handleSave}>
              Save
            </Button>
            {saved && (
              <span className="flex items-center gap-1 text-xs text-green-500">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Saved
              </span>
            )}
          </div>

          {/* Migration from legacy system prompts database */}
          {dbPrompts.length > 0 && (
            <div className="rounded-lg border border-border/50 bg-muted/20 p-3 space-y-2">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Database className="h-3.5 w-3.5" />
                Saved prompts (import one click)
              </div>
              {loadingDb ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {dbPrompts.map((p) => (
                    <Button
                      key={p.id}
                      size="sm"
                      variant={importedId === p.id ? "default" : "outline"}
                      className="h-7 text-xs"
                      onClick={() => handleImport(p)}
                      title={p.prompt}
                    >
                      {p.name}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="resume" className="pt-3">
          <ResumeContext />
        </TabsContent>

        <TabsContent value="job" className="pt-3">
          <JobContext />
        </TabsContent>

        <TabsContent value="humanizer" className="pt-3">
          <HumanizerSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}
