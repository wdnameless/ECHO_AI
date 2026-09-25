import { useCallback, useState } from "react";
import {
  Header,
  Button,
  Label,
  Textarea,
  Switch,
  Input,
} from "@/components";
import {
  GraduationCapIcon,
  MessageCircleIcon,
  PlusIcon,
  Trash2Icon,
  CheckCircle2Icon,
  PenLineIcon,
  SparklesIcon,
  BrainCircuitIcon,
  ThumbsUpIcon,
  ThumbsDownIcon,
  RotateCcwIcon,
  FileCodeIcon,
  SaveIcon,
} from "lucide-react";
import { useApp } from "@/contexts";
import { cn } from "@/lib/utils";
import {
  PromptProfile,
  SELF_EVOLUTION_PROFILE_ID,
  getRemovedBuiltinProfileIds,
  restoreAllBuiltinProfiles,
} from "@/lib/storage/prompt-profiles";
import {
  getUserFacts,
  getUserStylePreferences,
  getFeedbackLog,
  addUserFact,
  removeUserFact,
  UserFact,
  getUserMarkdownProfile,
  saveUserMarkdownProfile,
  resetUserMarkdownProfile,
} from "@/lib/storage/user-facts";

export function isDraftDirty(
  draft: PromptProfile | null,
  original: PromptProfile | undefined
): boolean {
  if (!draft || !original) return false;
  return (
    draft.name !== original.name ||
    draft.description !== original.description ||
    draft.systemPrompt !== original.systemPrompt ||
    draft.humanizerEnabled !== original.humanizerEnabled ||
    draft.interviewMode !== original.interviewMode ||
    draft.customStyle !== original.customStyle ||
    draft.ragResumeEnabled !== original.ragResumeEnabled ||
    draft.ragJobEnabled !== original.ragJobEnabled
  );
}

export const PromptProfilesSettings = () => {
  const {
    promptProfiles,
    activeProfileId,
    selectPromptProfile,
    updatePromptProfile,
    createPromptProfile,
    deletePromptProfile,
    resetPromptProfile,
    refreshPromptProfiles,
  } = useApp();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<PromptProfile | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  // Mirrors the persisted removal list; refreshed together with the profile list.
  const [hiddenBuiltinCount, setHiddenBuiltinCount] = useState(
    () => getRemovedBuiltinProfileIds().length
  );
  // Deleting a profile throws away a hand-written prompt, so it asks first.
  const [pendingDelete, setPendingDelete] = useState<PromptProfile | null>(null);
  // Profile switch confirmation when a draft has unsaved edits
  const [pendingSwitch, setPendingSwitch] = useState<PromptProfile | null>(null);

  // Self-Evolution Memory States
  const [facts, setFacts] = useState<UserFact[]>(() => getUserFacts());
  const [newFactText, setNewFactText] = useState("");
  const [stylePrefs, setStylePrefs] = useState(() => getUserStylePreferences());
  const [feedbackLogs, setFeedbackLogs] = useState(() => getFeedbackLog());

  // USER.md raw editor mode
  const [showMarkdownEditor, setShowMarkdownEditor] = useState(false);
  const [markdownText, setMarkdownText] = useState<string>(() => getUserMarkdownProfile());
  const [markdownSaved, setMarkdownSaved] = useState(false);

  const activeProfile =
    promptProfiles.find((p) => p.id === activeProfileId) || promptProfiles[0];

  /** Re-reads the deleted-built-ins bookkeeping from storage. */
  const loadProfiles = useCallback(() => {
    refreshPromptProfiles();
    setHiddenBuiltinCount(getRemovedBuiltinProfileIds().length);
  }, [refreshPromptProfiles]);

  const startEdit = useCallback((profile: PromptProfile) => {
    setDraft({ ...profile });
    setEditing(true);
    setCreating(false);
  }, []);

  const saveDraft = useCallback(() => {
    if (!draft) return;
    updatePromptProfile(draft.id, {
      name: draft.name,
      description: draft.description,
      systemPrompt: draft.systemPrompt,
      humanizerEnabled: draft.humanizerEnabled,
      interviewMode: draft.interviewMode,
      customStyle: draft.customStyle,
      ragResumeEnabled: draft.ragResumeEnabled,
      ragJobEnabled: draft.ragJobEnabled,
    });
    setEditing(false);
    setDraft(null);
  }, [draft, updatePromptProfile]);

  const handleSelectProfile = useCallback(
    (profile: PromptProfile) => {
      if (profile.id === activeProfileId && !editing) return;

      if (editing && draft) {
        if (profile.id === draft.id) return;
        const original = promptProfiles.find((p) => p.id === draft.id);
        if (isDraftDirty(draft, original)) {
          setPendingSwitch(profile);
          return;
        }
        setEditing(false);
        setDraft(null);
      }

      selectPromptProfile(profile.id);
    },
    [activeProfileId, editing, draft, promptProfiles, selectPromptProfile]
  );

  const handleConfirmSwitchSave = useCallback(() => {
    if (!pendingSwitch || !draft) return;
    saveDraft();
    selectPromptProfile(pendingSwitch.id);
    setPendingSwitch(null);
  }, [pendingSwitch, draft, saveDraft, selectPromptProfile]);

  const handleConfirmSwitchDiscard = useCallback(() => {
    if (!pendingSwitch) return;
    setEditing(false);
    setDraft(null);
    selectPromptProfile(pendingSwitch.id);
    setPendingSwitch(null);
  }, [pendingSwitch, selectPromptProfile]);

  const handleCreate = useCallback(() => {
    const name = newName.trim();
    if (!name) return;
    const created = createPromptProfile({
      name,
      description: "Custom prompt profile",
      systemPrompt: activeProfile?.systemPrompt || "",
      humanizerEnabled: true,
      interviewMode: false,
      customStyle: "",
      ragResumeEnabled: false,
      ragJobEnabled: false,
    });
    selectPromptProfile(created.id);
    startEdit(created);
    setNewName("");
    setCreating(false);
  }, [newName, createPromptProfile, selectPromptProfile, activeProfile, startEdit]);

  const handleAddFact = useCallback(() => {
    if (!newFactText.trim()) return;
    addUserFact(newFactText.trim());
    setFacts(getUserFacts());
    setMarkdownText(getUserMarkdownProfile());
    setNewFactText("");
  }, [newFactText]);

  const handleRemoveFact = useCallback((id: string) => {
    removeUserFact(id);
    setFacts(getUserFacts());
    setMarkdownText(getUserMarkdownProfile());
  }, []);

  const handleResetLearning = useCallback(() => {
    localStorage.removeItem("user_feedback_log");
    localStorage.removeItem("user_memory_style");
    localStorage.removeItem("user_memory_facts");
    resetUserMarkdownProfile();
    setFacts(getUserFacts());
    setStylePrefs(getUserStylePreferences());
    setFeedbackLogs([]);
    setMarkdownText(getUserMarkdownProfile());
  }, []);

  const handleSaveMarkdown = useCallback(() => {
    saveUserMarkdownProfile(markdownText);
    setMarkdownSaved(true);
    setTimeout(() => setMarkdownSaved(false), 2000);
  }, [markdownText]);

  const handleResetMarkdown = useCallback(() => {
    resetUserMarkdownProfile();
    setMarkdownText(getUserMarkdownProfile());
  }, []);

  const likesCount = feedbackLogs.filter((l) => l.rating === "like").length;
  const dislikesCount = feedbackLogs.filter((l) => l.rating === "dislike").length;

  return (
    <div id="prompt-profiles" className="space-y-3">
      <Header
        title="Prompt Profiles"
        description="Switch between interview mode, general chat, adaptive self-evolution, or create your own custom prompt profiles"
      />

      {/* Profile selector cards */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {promptProfiles.map((profile) => {
          const isActive = profile.id === activeProfileId;
          const Icon =
            profile.id === "profile-interview"
              ? GraduationCapIcon
              : profile.id === SELF_EVOLUTION_PROFILE_ID
              ? BrainCircuitIcon
              : MessageCircleIcon;

          return (
            <div
              key={profile.id}
              onClick={() => handleSelectProfile(profile)}
              className={cn(
                "group relative flex items-start gap-3 rounded-xl border p-3 text-left transition-all cursor-pointer select-none",
                isActive
                  ? "border-primary bg-primary/5 shadow-sm"
                  : "border-border/50 bg-muted/20 hover:border-primary/40"
              )}
            >
              <div
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-lg",
                  isActive ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                )}
              >
                <Icon className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                {/* Name shrinks, the action icons stay pinned to the right so the
                    title truncates instead of pushing the buttons out of reach. */}
                <div className="flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                    {profile.name}
                  </span>
                  {isActive && <CheckCircle2Icon className="size-4 shrink-0 text-primary" />}
                  {profile.isBuiltin && (
                    <span className="shrink-0 rounded bg-muted/40 px-1 text-[10px] text-muted-foreground/60">
                      built-in
                    </span>
                  )}
                  {profile.isBuiltin && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        resetPromptProfile(profile.id);
                      }}
                      className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      title="Сбросить встроенный профиль к заводским настройкам"
                    >
                      <RotateCcwIcon className="size-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPendingDelete(profile);
                    }}
                    disabled={promptProfiles.length <= 1}
                    className={cn(
                      "shrink-0 rounded p-1 transition-colors",
                      "text-muted-foreground hover:text-destructive hover:bg-destructive/10",
                      "disabled:pointer-events-none disabled:opacity-30"
                    )}
                    title={
                      promptProfiles.length <= 1
                        ? "Нельзя удалить последний профиль"
                        : "Удалить профиль"
                    }
                  >
                    <Trash2Icon className="size-3.5" />
                  </button>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                  {profile.description}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Deleted built-ins can always be brought back */}
      {hiddenBuiltinCount > 0 && (
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() => {
            restoreAllBuiltinProfiles();
            loadProfiles();
          }}
        >
          <RotateCcwIcon className="size-3.5" />
          Восстановить встроенные профили ({hiddenBuiltinCount})
        </Button>
      )}

      {/* Create new profile */}
      {creating ? (
        <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-muted/20 p-3">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Profile name (e.g. System Design, HR Round...)"
            className="h-9 text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
            }}
          />
          <Button size="sm" onClick={handleCreate} disabled={!newName.trim()}>
            Create
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() => setCreating(true)}
        >
          <PlusIcon className="size-3.5" />
          New profile
        </Button>
      )}

      {/* SELF-EVOLUTION KNOWLEDGE BASE & STYLE MEMORY PANEL */}
      {activeProfile?.id === SELF_EVOLUTION_PROFILE_ID && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-4 animate-in fade-in duration-200">
          <div className="flex items-center justify-between border-b border-primary/20 pb-2">
            <div className="flex items-center gap-2">
              <SparklesIcon className="size-4 text-primary" />
              <div>
                <span className="text-sm font-semibold">Self-Evolution Knowledge Base & USER.md</span>
                <p className="text-xs text-muted-foreground">
                  AI automatically extracts your facts, stack, tone, and evolves rules from your 👍 / 👎 ratings
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full font-medium">
                <ThumbsUpIcon className="size-3" /> {likesCount}
              </span>
              <span className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full font-medium">
                <ThumbsDownIcon className="size-3" /> {dislikesCount}
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1.5"
                onClick={() => {
                  setMarkdownText(getUserMarkdownProfile());
                  setShowMarkdownEditor((prev) => !prev);
                }}
              >
                <FileCodeIcon className="size-3.5 text-primary" />
                {showMarkdownEditor ? "Visual Mode" : "USER.md Editor"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-muted-foreground hover:text-destructive gap-1"
                onClick={handleResetLearning}
                title="Reset all learned memory and feedback"
              >
                <RotateCcwIcon className="size-3" />
                Reset
              </Button>
            </div>
          </div>

          {/* RAW USER.MD MARKDOWN EDITOR VIEW */}
          {showMarkdownEditor ? (
            <div className="space-y-2 bg-background/80 p-3 rounded-lg border border-primary/30">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold uppercase tracking-wider text-primary flex items-center gap-1.5">
                  <FileCodeIcon className="size-3.5" /> USER.md Context Profile
                </Label>
                <div className="flex items-center gap-1.5">
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleResetMarkdown}>
                    Restore Auto-Template
                  </Button>
                  <Button size="sm" className="h-7 text-xs gap-1" onClick={handleSaveMarkdown}>
                    <SaveIcon className="size-3" />
                    Save USER.md
                  </Button>
                  {markdownSaved && (
                    <span className="flex items-center gap-1 text-xs text-emerald-500 font-medium">
                      <CheckCircle2Icon className="size-3" /> Saved
                    </span>
                  )}
                </div>
              </div>
              <Textarea
                value={markdownText}
                onChange={(e) => setMarkdownText(e.target.value)}
                placeholder="# USER.md..."
                className="min-h-[220px] font-mono text-xs leading-relaxed"
              />
              <p className="text-[10px] text-muted-foreground">
                You can edit this raw markdown memory directly. The Self-Evolution profile will use this exact profile context for all answers.
              </p>
            </div>
          ) : (
            <>
              {/* User Known Facts List */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Known Personal Facts & Experience ({facts.length})
                  </Label>
                </div>
                <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
                  {facts.map((f) => (
                    <div
                      key={f.id}
                      className="flex items-center justify-between gap-2 p-2 rounded-lg bg-background/80 border border-border/40 text-xs"
                    >
                      <span className="flex-1 truncate">{f.fact}</span>
                      <span className="text-[10px] text-muted-foreground uppercase px-1 rounded bg-muted">
                        {f.category}
                      </span>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-5 w-5 text-muted-foreground hover:text-destructive"
                        onClick={() => handleRemoveFact(f.id)}
                      >
                        <Trash2Icon className="size-3" />
                      </Button>
                    </div>
                  ))}
                </div>

                {/* Add Fact Manually */}
                <div className="flex items-center gap-2 pt-1">
                  <Input
                    value={newFactText}
                    onChange={(e) => setNewFactText(e.target.value)}
                    placeholder="Add custom fact (e.g. 8 years Go/Rust backend experience, specializes in high-load)..."
                    className="h-8 text-xs"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddFact();
                    }}
                  />
                  <Button size="sm" className="h-8 px-3 text-xs" onClick={handleAddFact} disabled={!newFactText.trim()}>
                    Add
                  </Button>
                </div>
              </div>

              {/* Evolved Style Patterns */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-primary/20">
                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                    ⭐ Favorite Patterns (Reinforced by 👍)
                  </Label>
                  <div className="space-y-1">
                    {stylePrefs.favoritePatterns.map((p, i) => (
                      <div key={i} className="text-xs p-1.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-foreground/90">
                        {p}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-red-700 dark:text-red-400">
                    🚫 Avoid Constraints (Learned from 👎)
                  </Label>
                  <div className="space-y-1">
                    {stylePrefs.avoidPatterns.map((p, i) => (
                      <div key={i} className="text-xs p-1.5 rounded bg-red-500/10 border border-red-500/20 text-foreground/90">
                        {p}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Active profile editor */}
      {activeProfile && (
        <div className="rounded-xl border border-border/50 bg-muted/10 p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <PenLineIcon className="size-4 text-muted-foreground" />
              <span className="text-sm font-semibold">Editing: {activeProfile.name}</span>
            </div>
            {activeProfile.isBuiltin ? (
              <Button
                size="sm"
                variant="ghost"
                className="gap-1.5"
                onClick={() => resetPromptProfile(activeProfile.id)}
                title="Вернуть встроенный промпт к заводскому тексту"
              >
                <RotateCcwIcon className="size-3.5" />
                Reset to Default
              </Button>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:bg-destructive/10 gap-1.5"
                onClick={() => setPendingDelete(activeProfile)}
                title="Удалить профиль"
              >
                <Trash2Icon className="size-3.5" />
                Delete
              </Button>
            )}
          </div>

          {/* System prompt */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">System Prompt</Label>
            <Textarea
              value={editing && draft ? draft.systemPrompt : activeProfile.systemPrompt}
              onChange={(e) =>
                setDraft((d) => (d ? { ...d, systemPrompt: e.target.value } : d))
              }
              disabled={!editing}
              placeholder="How should the AI behave in this profile?"
              className="min-h-[140px] text-xs leading-relaxed font-mono"
            />
            <p className="text-[10px] text-muted-foreground">
              Tip: edit and save, then the floating window instantly uses this prompt.
            </p>
          </div>

          {/* Toggles */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="flex items-center justify-between rounded-lg border border-border/40 bg-background/50 p-2.5">
              <div>
                <Label className="text-xs font-medium">Humanizer</Label>
                <p className="text-[10px] text-muted-foreground">Human-like answers</p>
              </div>
              <Switch
                checked={editing && draft ? draft.humanizerEnabled : activeProfile.humanizerEnabled}
                onCheckedChange={(v) => setDraft((d) => (d ? { ...d, humanizerEnabled: v } : d))}
                disabled={!editing}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border/40 bg-background/50 p-2.5">
              <div>
                <Label className="text-xs font-medium">Interview Mode</Label>
                <p className="text-[10px] text-muted-foreground">Candidate answers style</p>
              </div>
              <Switch
                checked={editing && draft ? draft.interviewMode : activeProfile.interviewMode}
                onCheckedChange={(v) => setDraft((d) => (d ? { ...d, interviewMode: v } : d))}
                disabled={!editing}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border/40 bg-background/50 p-2.5">
              <div>
                <Label className="text-xs font-medium">Use Resume</Label>
                <p className="text-[10px] text-muted-foreground">Ground answers in resume</p>
              </div>
              <Switch
                checked={editing && draft ? draft.ragResumeEnabled : activeProfile.ragResumeEnabled}
                onCheckedChange={(v) => setDraft((d) => (d ? { ...d, ragResumeEnabled: v } : d))}
                disabled={!editing}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border/40 bg-background/50 p-2.5">
              <div>
                <Label className="text-xs font-medium">Use Job Description</Label>
                <p className="text-[10px] text-muted-foreground">Ground answers in vacancy</p>
              </div>
              <Switch
                checked={editing && draft ? draft.ragJobEnabled : activeProfile.ragJobEnabled}
                onCheckedChange={(v) => setDraft((d) => (d ? { ...d, ragJobEnabled: v } : d))}
                disabled={!editing}
              />
            </div>
          </div>

          {/* Custom style */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Personal Style (optional)</Label>
            <Input
              value={editing && draft ? draft.customStyle : activeProfile.customStyle}
              onChange={(e) => setDraft((d) => (d ? { ...d, customStyle: e.target.value } : d))}
              disabled={!editing}
              placeholder="e.g. speak short, use metaphors, mention numbers..."
              className="h-9 text-xs"
            />
          </div>

          {/* Edit / Save */}
          <div className="flex gap-2">
            {editing ? (
              <>
                <Button size="sm" onClick={saveDraft}>
                  Save profile
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditing(false);
                    setDraft(null);
                  }}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button size="sm" variant="outline" onClick={() => startEdit(activeProfile)}>
                <PenLineIcon className="size-3.5 mr-1" />
                Edit profile
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {pendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md space-y-3 rounded-xl border border-border bg-background p-5">
            <h3 className="text-sm font-semibold">
              Удалить профиль «{pendingDelete.name}»?
            </h3>
            <p className="text-xs text-muted-foreground">
              Его системный промпт будет потерян. Встроенные профили можно вернуть
              кнопкой «Restore built-in profiles».
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <Button size="sm" variant="outline" onClick={() => setPendingDelete(null)}>
                Отмена
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => {
                  deletePromptProfile(pendingDelete.id);
                  loadProfiles();
                  setPendingDelete(null);
                }}
              >
                <Trash2Icon className="size-3.5 mr-1" />
                Удалить
              </Button>
            </div>
          </div>
        </div>
      )}
      {/* Switch profile with unsaved changes confirmation */}
      {pendingSwitch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md space-y-3 rounded-xl border border-border bg-background p-5">
            <h3 className="text-sm font-semibold">
              Несохранённые изменения
            </h3>
            <p className="text-xs text-muted-foreground">
              В профиле «{draft?.name || activeProfile?.name}» есть несохранённые
              изменения. Сохранить их перед переключением на «{pendingSwitch.name}»?
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPendingSwitch(null)}
              >
                Отмена
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:bg-destructive/10"
                onClick={handleConfirmSwitchDiscard}
              >
                Не сохранять
              </Button>
              <Button
                size="sm"
                onClick={handleConfirmSwitchSave}
              >
                Сохранить и перейти
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
