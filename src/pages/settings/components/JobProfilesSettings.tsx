import { useState, useCallback } from "react";
import {
  Header,
  Button,
  Label,
  Textarea,
  Input,
} from "@/components";
import {
  BriefcaseIcon,
  FileTextIcon,
  PlusIcon,
  Trash2Icon,
  CheckCircle2Icon,
  PenLineIcon,
  SparklesIcon,
  SaveIcon,
  CheckIcon,
} from "lucide-react";
import { useApp } from "@/contexts";
import { cn } from "@/lib/utils";
import { JobProfile } from "@/lib/storage/job-profiles";

export const JobProfilesSettings = () => {
  const {
    jobProfiles,
    activeJobProfileId,
    selectJobProfile,
    updateJobProfile,
    createJobProfile,
    deleteJobProfile,
    applyJobProfile,
  } = useApp();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<JobProfile | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [appliedToastId, setAppliedToastId] = useState<string | null>(null);

  const activeProfile =
    jobProfiles.find((p) => p.id === activeJobProfileId) || jobProfiles[0];

  const startEdit = useCallback((profile: JobProfile) => {
    setDraft({ ...profile });
    setEditing(true);
    setCreating(false);
  }, []);

  const saveDraft = useCallback(() => {
    if (!draft) return;
    updateJobProfile(draft.id, {
      name: draft.name,
      description: draft.description,
      contextContent: draft.contextContent,
    });
    setEditing(false);
    setDraft(null);
  }, [draft, updateJobProfile]);

  const handleCreate = useCallback(() => {
    const name = newName.trim();
    if (!name) return;
    const created = createJobProfile({
      name,
      description: "Пользовательский профиль вакансии / резюме",
      contextContent: activeProfile?.contextContent || "",
    });
    selectJobProfile(created.id);
    startEdit(created);
    setNewName("");
    setCreating(false);
  }, [newName, createJobProfile, selectJobProfile, activeProfile, startEdit]);

  const handleApply = useCallback(
    (profileId: string) => {
      applyJobProfile(profileId);
      setAppliedToastId(profileId);
      setTimeout(() => {
        setAppliedToastId((current) => (current === profileId ? null : current));
      }, 2000);
    },
    [applyJobProfile]
  );

  return (
    <div id="job-profiles" className="space-y-3">
      <Header
        title="Профили вакансий и контекста"
        description="Сохраняйте заготовки резюме и описания вакансий для быстрой загрузки в контекст интервью в один клик"
      />

      {/* Profile selector cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {jobProfiles.map((p) => {
          const isActive = p.id === activeJobProfileId;
          const isApplied = appliedToastId === p.id;
          return (
            <div
              key={p.id}
              onClick={() => selectJobProfile(p.id)}
              className={cn(
                "relative group flex flex-col p-3 rounded-lg border text-left cursor-pointer transition-all duration-200",
                isActive
                  ? "border-primary bg-primary/10 shadow-sm"
                  : "border-border hover:border-muted-foreground/40 bg-card hover:bg-accent/50"
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div
                    className={cn(
                      "p-1.5 rounded-md",
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {p.isBuiltin ? (
                      <BriefcaseIcon className="w-4 h-4" />
                    ) : (
                      <FileTextIcon className="w-4 h-4" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-sm text-foreground">
                        {p.name}
                      </span>
                      {p.isBuiltin && (
                        <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                          Встроенный
                        </span>
                      )}
                    </div>
                    {p.description && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                        {p.description}
                      </p>
                    )}
                  </div>
                </div>

                {isActive && (
                  <CheckCircle2Icon className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                )}
              </div>

              {/* Action buttons inside card */}
              <div className="flex items-center justify-between mt-3 pt-2 border-t border-border/40 gap-1.5">
                <Button
                  size="sm"
                  variant={isActive ? "default" : "outline"}
                  className="h-7 text-xs px-2.5 flex items-center gap-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleApply(p.id);
                  }}
                  title="Заполнить контекст и включить системный аудио-контекст"
                >
                  {isApplied ? (
                    <>
                      <CheckIcon className="w-3.5 h-3.5" />
                      <span>Применено!</span>
                    </>
                  ) : (
                    <>
                      <SparklesIcon className="w-3.5 h-3.5" />
                      <span>Применить к контексту</span>
                    </>
                  )}
                </Button>

                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      selectJobProfile(p.id);
                      startEdit(p);
                    }}
                    title="Редактировать профиль"
                  >
                    <PenLineIcon className="w-3.5 h-3.5" />
                  </Button>

                  {!p.isBuiltin && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteJobProfile(p.id);
                        if (draft?.id === p.id) {
                          setEditing(false);
                          setDraft(null);
                        }
                      }}
                      title="Удалить профиль"
                    >
                      <Trash2Icon className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Create New Profile Button / Form */}
      {!creating ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setCreating(true);
            setEditing(false);
          }}
          className="w-full flex items-center justify-center gap-2 border-dashed h-9 text-xs"
        >
          <PlusIcon className="w-4 h-4" />
          <span>Создать новый профиль вакансии</span>
        </Button>
      ) : (
        <div className="p-3 border rounded-lg bg-card space-y-2.5">
          <Label className="text-xs font-semibold">Название профиля</Label>
          <div className="flex items-center gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="например: Senior Frontend Developer / Яндекс"
              className="text-xs h-8"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
                if (e.key === "Escape") setCreating(false);
              }}
              autoFocus
            />
            <Button size="sm" onClick={handleCreate} className="h-8 text-xs px-3 shrink-0">
              Создать
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setCreating(false)}
              className="h-8 text-xs px-2 shrink-0"
            >
              Отмена
            </Button>
          </div>
        </div>
      )}

      {/* Editor section */}
      {editing && draft && (
        <div className="p-4 border rounded-lg bg-card space-y-4 shadow-sm animate-in fade-in-50 duration-200">
          <div className="flex items-center justify-between border-b pb-2">
            <div className="flex items-center gap-2">
              <PenLineIcon className="w-4 h-4 text-primary" />
              <span className="font-semibold text-sm">
                Редактирование: {draft.name}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Button size="sm" onClick={saveDraft} className="h-8 text-xs px-3 flex items-center gap-1">
                <SaveIcon className="w-3.5 h-3.5" />
                <span>Сохранить</span>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditing(false);
                  setDraft(null);
                }}
                className="h-8 text-xs px-2"
              >
                Отмена
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Название</Label>
              <Input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className="text-xs h-8"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Краткое описание</Label>
              <Input
                value={draft.description || ""}
                onChange={(e) =>
                  setDraft({ ...draft, description: e.target.value })
                }
                placeholder="Стек технологий, уровень, компания..."
                className="text-xs h-8"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Текст контекста (резюме + описание вакансии)</Label>
              <span className="text-[11px] text-muted-foreground">
                {draft.contextContent?.length || 0} символов
              </span>
            </div>
            <Textarea
              value={draft.contextContent || ""}
              onChange={(e) =>
                setDraft({ ...draft, contextContent: e.target.value })
              }
              placeholder="Вставьте сюда текст вашего резюме, ключевые достижения и описание вакансии..."
              rows={8}
              className="text-xs font-mono resize-y"
            />
            <p className="text-[11px] text-muted-foreground">
              Этот текст будет подставлен в контекст ассистента при нажатии кнопки «Применить к контексту».
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
