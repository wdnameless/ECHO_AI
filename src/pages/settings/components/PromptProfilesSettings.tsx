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
} from "lucide-react";
import { useApp } from "@/contexts";
import { cn } from "@/lib/utils";
import { PromptProfile } from "@/lib/storage/prompt-profiles";

export const PromptProfilesSettings = () => {
  const {
    promptProfiles,
    activeProfileId,
    selectPromptProfile,
    updatePromptProfile,
    createPromptProfile,
    deletePromptProfile,
  } = useApp();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<PromptProfile | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const activeProfile =
    promptProfiles.find((p) => p.id === activeProfileId) || promptProfiles[0];

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

  return (
    <div id="prompt-profiles" className="space-y-3">
      <Header
        title="Prompt Profiles"
        description="Switch between interview mode, general chat and your own custom prompt profiles"
      />

      {/* Profile selector cards */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {promptProfiles.map((profile) => {
          const isActive = profile.id === activeProfileId;
          const Icon = profile.id === "profile-interview" ? GraduationCapIcon : MessageCircleIcon;
          return (
            <button
              key={profile.id}
              onClick={() => selectPromptProfile(profile.id)}
              className={cn(
                "relative flex items-start gap-3 rounded-xl border p-3 text-left transition-all cursor-pointer",
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
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold line-clamp-1">{profile.name}</span>
                  {isActive && <CheckCircle2Icon className="size-4 text-primary shrink-0" />}
                  {profile.isBuiltin && (
                    <span className="text-[10px] text-muted-foreground/60 bg-muted/40 px-1 rounded">
                      built-in
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                  {profile.description}
                </p>
              </div>
            </button>
          );
        })}
      </div>

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

      {/* Active profile editor */}
      {activeProfile && (
        <div className="rounded-xl border border-border/50 bg-muted/10 p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <PenLineIcon className="size-4 text-muted-foreground" />
              <span className="text-sm font-semibold">Editing: {activeProfile.name}</span>
            </div>
            {!activeProfile.isBuiltin && (
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive gap-1"
                onClick={() => deletePromptProfile(activeProfile.id)}
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
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
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
    </div>
  );
};
