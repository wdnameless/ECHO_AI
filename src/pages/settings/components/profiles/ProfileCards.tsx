import React from "react";
import { Button } from "@/components";
import {
  GraduationCapIcon,
  MessageCircleIcon,
  PlusIcon,
  Trash2Icon,
  CheckCircle2Icon,
  RotateCcwIcon,
  BrainCircuitIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  PromptProfile,
  SELF_EVOLUTION_PROFILE_ID,
} from "@/lib/storage/prompt-profiles";

export interface ProfileCardsProps {
  profiles: PromptProfile[];
  activeProfileId: string;
  onSelectProfile: (profile: PromptProfile) => void;
  onResetProfile: (id: string) => void;
  onDeleteProfile: (profile: PromptProfile) => void;
  onOpenWizard: () => void;
  hiddenBuiltinCount?: number;
  onRestoreBuiltins?: () => void;
}

export const ProfileCards: React.FC<ProfileCardsProps> = ({
  profiles,
  activeProfileId,
  onSelectProfile,
  onResetProfile,
  onDeleteProfile,
  onOpenWizard,
  hiddenBuiltinCount = 0,
  onRestoreBuiltins,
}) => {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold tracking-tight">Профили ассистента</h3>
          <p className="text-xs text-muted-foreground">
            Выберите готовый сценарий работы или создайте собственный профиль
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={onOpenWizard}
        >
          <PlusIcon className="size-3.5" />
          New profile
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {profiles.map((profile) => {
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
              onClick={() => onSelectProfile(profile)}
              className={cn(
                "group relative flex items-start gap-3 rounded-xl border p-3.5 text-left transition-all cursor-pointer select-none",
                isActive
                  ? "border-primary bg-primary/5 shadow-sm ring-1 ring-primary/20"
                  : "border-border/50 bg-muted/20 hover:border-primary/40 hover:bg-muted/30"
              )}
            >
              <div
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-lg",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground group-hover:text-foreground"
                )}
              >
                <Icon className="size-4" />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                    {profile.name}
                  </span>
                  {isActive && (
                    <CheckCircle2Icon className="size-4 shrink-0 text-primary" />
                  )}
                  {profile.isBuiltin && (
                    <span className="shrink-0 rounded bg-muted/40 px-1 py-0.5 text-[10px] text-muted-foreground/70 font-medium">
                      built-in
                    </span>
                  )}
                  {profile.isBuiltin && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onResetProfile(profile.id);
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
                      onDeleteProfile(profile);
                    }}
                    disabled={profiles.length <= 1}
                    className={cn(
                      "shrink-0 rounded p-1 transition-colors",
                      "text-muted-foreground hover:text-destructive hover:bg-destructive/10",
                      "disabled:pointer-events-none disabled:opacity-30"
                    )}
                    title={
                      profiles.length <= 1
                        ? "Нельзя удалить последний профиль"
                        : "Удалить профиль"
                    }
                  >
                    <Trash2Icon className="size-3.5" />
                  </button>
                </div>
                <p className="mt-1 text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                  {profile.description}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {hiddenBuiltinCount > 0 && onRestoreBuiltins && (
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={onRestoreBuiltins}
        >
          <RotateCcwIcon className="size-3.5" />
          Восстановить встроенные профили ({hiddenBuiltinCount})
        </Button>
      )}
    </div>
  );
};
