import { useCallback, useEffect, useRef, useState } from "react";
import { FileUp, Trash2, Loader2, AlertCircle } from "lucide-react";
import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { STORAGE_KEYS } from "@/config/constants";
import { safeLocalStorage } from "@/lib/storage/helper";
import { getRagContext, setRagContext, deleteRagContext } from "@/lib/rag";
import { extractPdfText } from "@/lib/pdf";

export function ResumeContext() {
  const [enabled, setEnabled] = useState(false);
  const [content, setContent] = useState("");
  const [sourceName, setSourceName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const stored = safeLocalStorage.getItem(STORAGE_KEYS.RAG_RESUME_ENABLED);
      const ctx = await getRagContext("resume");
      if (!mounted) return;
      setEnabled(stored === "true");
      setContent(ctx?.content ?? "");
      setSourceName(ctx?.sourceName ?? null);
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const handleFile = useCallback(async (file: File) => {
    setFileError(null);
    setSaving(true);
    try {
      const text =
        file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
          ? await extractPdfText(file)
          : await file.text();
      if (!text.trim()) {
        setFileError("No text could be extracted from this file.");
        return;
      }
      setContent(text);
      setSourceName(file.name);
      await setRagContext("resume", text, file.name);
      setEnabled(true);
      safeLocalStorage.setItem(STORAGE_KEYS.RAG_RESUME_ENABLED, "true");
    } catch {
      setFileError("Failed to read this file. Try a .txt / .md file or paste the text.");
    } finally {
      setSaving(false);
    }
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    await setRagContext("resume", content, sourceName ?? undefined);
    setSaving(false);
  }, [content, sourceName]);

  const handleDelete = useCallback(async () => {
    setSaving(true);
    await deleteRagContext("resume");
    setContent("");
    setSourceName(null);
    safeLocalStorage.setItem(STORAGE_KEYS.RAG_RESUME_ENABLED, "false");
    setEnabled(false);
    setSaving(false);
  }, []);

  return (
    <div id="resume-context" className="space-y-3">
      <Header
        title="My Resume"
        description="Upload your resume so answers are grounded in your real experience"
        isMainTitle
        rightSlot={
          <div className="flex items-center gap-2">
            <Switch
              checked={enabled}
              onCheckedChange={(v) => {
                setEnabled(v);
                safeLocalStorage.setItem(STORAGE_KEYS.RAG_RESUME_ENABLED, String(v));
              }}
            />
            <span className="text-sm text-muted-foreground">
              {enabled ? "Enabled" : "Disabled"}
            </span>
          </div>
        }
      />
      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,.md,.markdown,.pdf,application/pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
        >
          <FileUp className="mr-2 h-4 w-4" />
          Upload file
        </Button>
        {sourceName && (
          <span className="text-xs text-muted-foreground truncate max-w-[200px]">
            {sourceName}
          </span>
        )}
      </div>
      {fileError && (
        <div className="flex items-center gap-2 text-xs text-destructive">
          <AlertCircle className="h-4 w-4" />
          {fileError}
        </div>
      )}
      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Paste your resume text here or upload a .txt / .md / .pdf file..."
        className="min-h-[160px]"
      />
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={handleSave} disabled={saving || !content.trim()}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Save
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={handleDelete}
          disabled={saving || !content.trim()}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Delete
        </Button>
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      </div>
    </div>
  );
}
