import React, { useCallback, useState } from "react";
import { Header, Button, Input, Textarea, Label } from "@/components";
import { UploadIcon, Trash2Icon } from "lucide-react";
import { useApp } from "@/contexts";
import {
  PromptProfile,
  SELF_EVOLUTION_PROFILE_ID,
  getRemovedBuiltinProfileIds,
  restoreAllBuiltinProfiles,
  exportProfileToJson,
  exportProfilesToJson,
  importProfilesFromJson,
  ToolbarButtonId,
} from "@/lib/storage/prompt-profiles";
import {
  getUserFacts,
  getUserStylePreferences,
  saveUserStylePreferences,
  getFeedbackLog,
  saveFeedbackLog,
  addUserFact,
  removeUserFact,
  addUserRule,
  getRuleSource,
  type RuleSource,
  UserFact,
  FeedbackEntry,
  getUserMarkdownProfile,
  saveUserMarkdownProfile,
  resetUserMarkdownProfile,
  resetLearning,
} from "@/lib/storage/user-facts";
import {
  SmartRule,
  getSmartRules,
  deleteSmartRule,
  archiveSmartRule,
} from "@/lib/storage/smart-rules";
import {
  ProfileCards,
  ProfileWizard,
  ProfileEditor,
  MemoryPanels,
} from "./profiles";

export const AVAILABLE_TOOLBAR_BUTTONS: Array<{ id: ToolbarButtonId; label: string }> = [
  { id: "length", label: "Длина ответа (Авто/Кратко/Подробно)" },
  { id: "thought", label: "Ход мыслей" },
  { id: "livecode", label: "Лайвкодинг" },
  { id: "answer", label: "Ответить" },
  { id: "code_plan", label: "План кода" },
  { id: "code_full", label: "Код" },
  { id: "code_screen", label: "Код со скрина" },
  { id: "monologue_send", label: "Отправка монолога" },
  { id: "screenshot", label: "Скриншот" },
  { id: "audio_settings", label: "Настройки звука" },
  { id: "settings", label: "Все настройки" },
  { id: "new_chat", label: "Новый чат" },
];

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
    draft.ragJobEnabled !== original.ragJobEnabled ||
    draft.flushGapMs !== original.flushGapMs ||
    draft.defaultLength !== original.defaultLength ||
    JSON.stringify(draft.visibleButtons ?? []) !==
      JSON.stringify(original.visibleButtons ?? []) ||
    JSON.stringify(draft.monologue ?? {}) !==
      JSON.stringify(original.monologue ?? {})
  );
}

export const PromptProfilesSettings: React.FC = () => {
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
  const [showWizard, setShowWizard] = useState(false);

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
  const [stylePrefs, setStylePrefs] = useState(() => getUserStylePreferences());
  const [feedbackLogs, setFeedbackLogs] = useState(() => getFeedbackLog());
  const [smartRules, setSmartRules] = useState<SmartRule[]>(() => {
    try {
      return getSmartRules();
    } catch {
      return [];
    }
  });

  // USER.md raw editor mode state
  const [markdownText, setMarkdownText] = useState<string>(() => getUserMarkdownProfile());

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
    setShowWizard(false);
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
      flushGapMs: draft.flushGapMs,
      defaultLength: draft.defaultLength,
      visibleButtons: draft.visibleButtons,
      monologue: draft.monologue,
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

  const handleCreateFromWizard = useCallback(
    (newProfileData: Omit<PromptProfile, "id">) => {
      const created = createPromptProfile({
        name: newProfileData.name,
        description: newProfileData.description,
        systemPrompt: newProfileData.systemPrompt || activeProfile?.systemPrompt || "",
        humanizerEnabled: newProfileData.humanizerEnabled ?? true,
        interviewMode: newProfileData.interviewMode ?? false,
        customStyle: newProfileData.customStyle ?? "",
        ragResumeEnabled: newProfileData.ragResumeEnabled ?? false,
        ragJobEnabled: newProfileData.ragJobEnabled ?? false,
        flushGapMs: newProfileData.flushGapMs ?? 1000,
        defaultLength: newProfileData.defaultLength ?? "auto",
        visibleButtons: newProfileData.visibleButtons ?? [
          "length",
          "thought",
          "answer",
          "screenshot",
          "audio_settings",
          "settings",
          "new_chat",
        ],
        monologue: newProfileData.monologue ?? {
          mode: "auto",
          maxWindow: 12000,
        },
      });
      selectPromptProfile(created.id);
      startEdit(created);
      setShowWizard(false);
    },
    [createPromptProfile, selectPromptProfile, activeProfile, startEdit]
  );

  const [showImportModal, setShowImportModal] = useState(false);
  const [importJsonText, setImportJsonText] = useState("");
  const [importFeedback, setImportFeedback] = useState<string | null>(null);

  const handleExportCurrent = useCallback(() => {
    if (!activeProfile) return;
    const json = exportProfileToJson(activeProfile);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${activeProfile.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-profile.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [activeProfile]);

  const handleExportAll = useCallback(() => {
    const json = exportProfilesToJson(promptProfiles);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "prompt-profiles-export.json";
    a.click();
    URL.revokeObjectURL(url);
  }, [promptProfiles]);

  const handleImportJson = useCallback(
    (jsonString: string) => {
      setImportFeedback(null);
      const imported = importProfilesFromJson(jsonString);
      if (imported.length === 0) {
        setImportFeedback("Не удалось импортировать профиль: неверный формат JSON.");
        return;
      }
      for (const p of imported) {
        const created = createPromptProfile({
          name: p.name,
          description: p.description,
          systemPrompt: p.systemPrompt,
          humanizerEnabled: p.humanizerEnabled,
          interviewMode: p.interviewMode,
          customStyle: p.customStyle,
          ragResumeEnabled: p.ragResumeEnabled,
          ragJobEnabled: p.ragJobEnabled,
          flushGapMs: p.flushGapMs,
          defaultLength: p.defaultLength,
          visibleButtons: p.visibleButtons,
          monologue: p.monologue,
        });
        selectPromptProfile(created.id);
      }
      setShowImportModal(false);
      setImportJsonText("");
      loadProfiles();
    },
    [createPromptProfile, selectPromptProfile, loadProfiles]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        if (content) handleImportJson(content);
      };
      reader.readAsText(file);
      e.target.value = "";
    },
    [handleImportJson]
  );

  const logManualEdit = useCallback(
    (question: string, response: string, rating: "like" | "dislike", reason: string) => {
      const entry: FeedbackEntry = {
        id: `fb-manual-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        question,
        response,
        rating,
        reason,
        topic: "manual",
        timestamp: Date.now(),
      };
      saveFeedbackLog([entry, ...getFeedbackLog()]);
      setFeedbackLogs(getFeedbackLog());
    },
    []
  );

  const handleAddFact = useCallback(
    (text: string) => {
      addUserFact(text, "general");
      setFacts(getUserFacts());
      setMarkdownText(getUserMarkdownProfile());
      logManualEdit("Добавление факта в память", text, "like", "Добавлено пользователем вручную (source=manual)");
    },
    [logManualEdit]
  );

  const handleRemoveFact = useCallback(
    (id: string) => {
      const target = facts.find((f) => f.id === id);
      removeUserFact(id);
      setFacts(getUserFacts());
      setMarkdownText(getUserMarkdownProfile());
      if (target) {
        logManualEdit("Удаление факта из памяти", target.fact, "dislike", "Удалено пользователем в редакторе (source=manual)");
      }
    },
    [facts, logManualEdit]
  );

  const handleRemoveFavoritePattern = useCallback(
    (index: number) => {
      const removed = stylePrefs.favoritePatterns[index];
      const next = {
        ...stylePrefs,
        favoritePatterns: stylePrefs.favoritePatterns.filter((_, i) => i !== index),
      };
      saveUserStylePreferences(next);
      setStylePrefs(next);
      setMarkdownText(getUserMarkdownProfile());
      if (removed) {
        logManualEdit("Удаление эталона стиля", removed, "dislike", "Удалено пользователем в редакторе (source=manual)");
      }
    },
    [stylePrefs, logManualEdit]
  );

  const handleRemoveAvoidPattern = useCallback(
    (index: number) => {
      const removed = stylePrefs.avoidPatterns[index];
      const next = {
        ...stylePrefs,
        avoidPatterns: stylePrefs.avoidPatterns.filter((_, i) => i !== index),
      };
      saveUserStylePreferences(next);
      setStylePrefs(next);
      setMarkdownText(getUserMarkdownProfile());
      if (removed) {
        logManualEdit("Удаление ограничения", removed, "like", "Снято ограничение (source=manual)");
      }
    },
    [stylePrefs, logManualEdit]
  );

  const resolveRuleSource = useCallback(
    (rule: string): RuleSource => {
      if (typeof getRuleSource === "function") {
        const src = getRuleSource(rule);
        if (src) return src;
      }
      const match = feedbackLogs.find(
        (entry) => entry.response === rule || entry.question === rule
      );
      if (match?.topic === "coach") return "coach";
      if (match?.topic === "manual") return "manual";
      if (match) return "feedback";
      return "manual";
    },
    [feedbackLogs]
  );

  const handleAddSmartRule = useCallback(
    (text: string, source: RuleSource = "manual") => {
      if (typeof addUserRule === "function") {
        addUserRule(text, { source });
      }
      const nextStyle = {
        ...stylePrefs,
        customRules: [text, ...stylePrefs.customRules.filter((r) => r !== text)],
      };
      saveUserStylePreferences(nextStyle);
      setStylePrefs(nextStyle);
      try {
        setSmartRules(getSmartRules());
      } catch {
        // Fallback
      }
      setMarkdownText(getUserMarkdownProfile());
      logManualEdit("Добавление правила", text, "like", `Добавлено пользователем в редакторе (source=${source})`);
    },
    [stylePrefs, logManualEdit]
  );

  const handleDeleteSmartRule = useCallback(
    (id: string) => {
      try {
        deleteSmartRule(id);
        setSmartRules(getSmartRules());
      } catch {
        // Fallback
      }
    },
    []
  );

  const handleArchiveSmartRule = useCallback(
    (id: string) => {
      try {
        archiveSmartRule(id);
        setSmartRules(getSmartRules());
      } catch {
        // Fallback
      }
    },
    []
  );

  const handleRemoveLegacyRule = useCallback(
    (index: number) => {
      const removed = stylePrefs.customRules[index];
      const next = {
        ...stylePrefs,
        customRules: stylePrefs.customRules.filter((_, i) => i !== index),
      };
      saveUserStylePreferences(next);
      setStylePrefs(next);
      setMarkdownText(getUserMarkdownProfile());
      if (removed) {
        logManualEdit("Удаление правила", removed, "dislike", "Удалено пользователем в редакторе (source=manual)");
      }
    },
    [stylePrefs, logManualEdit]
  );

  const handleResetLearning = useCallback(async () => {
    try {
      await resetLearning();
    } catch {
      localStorage.removeItem("user_feedback_log");
      localStorage.removeItem("user_memory_style");
      localStorage.removeItem("user_memory_facts");
      resetUserMarkdownProfile();
    }
    setFacts(getUserFacts());
    setStylePrefs(getUserStylePreferences());
    setFeedbackLogs([]);
    try {
      setSmartRules(getSmartRules());
    } catch {
      setSmartRules([]);
    }
    setMarkdownText(getUserMarkdownProfile());
  }, []);

  const handleSaveMarkdown = useCallback((text: string) => {
    saveUserMarkdownProfile(text);
    setMarkdownText(text);
  }, []);

  const handleResetMarkdown = useCallback(() => {
    resetUserMarkdownProfile();
    setMarkdownText(getUserMarkdownProfile());
  }, []);

  return (
    <div id="prompt-profiles" className="space-y-4">
      <Header
        title="Prompt Profiles"
        description="Switch between interview mode, general chat, adaptive self-evolution, or create your own custom prompt profiles"
      />

      {/* Profile cards list */}
      <ProfileCards
        profiles={promptProfiles}
        activeProfileId={activeProfileId}
        onSelectProfile={handleSelectProfile}
        onResetProfile={resetPromptProfile}
        onDeleteProfile={setPendingDelete}
        onOpenWizard={() => setShowWizard(true)}
        hiddenBuiltinCount={hiddenBuiltinCount}
        onRestoreBuiltins={() => {
          restoreAllBuiltinProfiles();
          loadProfiles();
        }}
      />

      {/* 3-Step Creation Wizard */}
      <ProfileWizard
        open={showWizard}
        onClose={() => setShowWizard(false)}
        onCreate={handleCreateFromWizard}
        initialPrompt={activeProfile?.systemPrompt || ""}
      />

      {/* Self-Evolution Memory & Learning Panels */}
      {activeProfile?.id === SELF_EVOLUTION_PROFILE_ID && (
        <MemoryPanels
          facts={facts}
          onAddFact={handleAddFact}
          onRemoveFact={handleRemoveFact}
          stylePrefs={stylePrefs}
          onRemoveFavoritePattern={handleRemoveFavoritePattern}
          onRemoveAvoidPattern={handleRemoveAvoidPattern}
          feedbackLogs={feedbackLogs}
          markdownText={markdownText}
          onSaveMarkdown={handleSaveMarkdown}
          onResetMarkdown={handleResetMarkdown}
          onResetLearning={handleResetLearning}
          rules={smartRules}
          onAddRule={handleAddSmartRule}
          onDeleteRule={handleDeleteSmartRule}
          onArchiveRule={handleArchiveSmartRule}
          legacyRules={stylePrefs.customRules}
          onRemoveLegacyRule={handleRemoveLegacyRule}
          resolveRuleSource={resolveRuleSource}
        />
      )}

      {/* Active profile editor + prompt preview */}
      {activeProfile && (
        <ProfileEditor
          profile={activeProfile}
          isEditing={editing}
          draft={draft}
          onStartEdit={() => startEdit(activeProfile)}
          onCancelEdit={() => {
            setEditing(false);
            setDraft(null);
          }}
          onSaveEdit={saveDraft}
          onDraftChange={(updater) => setDraft((d) => (d ? updater(d) : d))}
          onResetProfile={resetPromptProfile}
          onDeleteProfile={setPendingDelete}
          onExportCurrent={handleExportCurrent}
          onExportAll={handleExportAll}
          onOpenImport={() => setShowImportModal(true)}
        />
      )}

      {/* JSON Import Modal */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg space-y-4 rounded-xl border border-border bg-background p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <UploadIcon className="size-4" /> Импорт профилей
              </h3>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setShowImportModal(false);
                  setImportJsonText("");
                  setImportFeedback(null);
                }}
              >
                Отмена
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Загрузите файл .json или вставьте конфигурацию профиля в текстовое поле:
            </p>
            <div className="flex items-center gap-2">
              <Input
                type="file"
                accept=".json"
                onChange={handleFileInput}
                className="text-xs file:mr-2 file:py-1 file:px-2 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-primary file:text-primary-foreground"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Или вставьте JSON напрямую:</Label>
              <Textarea
                value={importJsonText}
                onChange={(e) => setImportJsonText(e.target.value)}
                placeholder='{ "name": "Custom Profile", "systemPrompt": "...", "flushGapMs": 450 }'
                className="min-h-[120px] font-mono text-xs"
              />
            </div>
            {importFeedback && (
              <p className="text-xs text-destructive font-medium">{importFeedback}</p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setShowImportModal(false);
                  setImportJsonText("");
                  setImportFeedback(null);
                }}
              >
                Отмена
              </Button>
              <Button
                size="sm"
                disabled={!importJsonText.trim()}
                onClick={() => handleImportJson(importJsonText)}
              >
                Импортировать
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
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

      {/* Switch profile with unsaved changes confirmation modal */}
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
