import React, { useState, useCallback } from "react";
import { Button, Input, Textarea, Label } from "@/components";
import { UploadIcon, Trash2Icon } from "lucide-react";
import type { PromptProfile } from "@/lib/storage/prompt-profiles";

export interface ImportProfilesModalProps {
  open: boolean;
  onClose: () => void;
  onImportJson: (jsonString: string) => boolean;
}

export const ImportProfilesModal: React.FC<ImportProfilesModalProps> = ({
  open,
  onClose,
  onImportJson,
}) => {
  const [importJsonText, setImportJsonText] = useState("");
  const [importFeedback, setImportFeedback] = useState<string | null>(null);

  const handleClose = useCallback(() => {
    setImportJsonText("");
    setImportFeedback(null);
    onClose();
  }, [onClose]);

  const handleSubmit = useCallback(
    (jsonString: string) => {
      setImportFeedback(null);
      const ok = onImportJson(jsonString);
      if (!ok) {
        setImportFeedback("Не удалось импортировать профиль: неверный формат JSON.");
        return;
      }
      setImportJsonText("");
      setImportFeedback(null);
      onClose();
    },
    [onImportJson, onClose]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        if (content) handleSubmit(content);
      };
      reader.readAsText(file);
      e.target.value = "";
    },
    [handleSubmit]
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg space-y-4 rounded-xl border border-border bg-background p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <UploadIcon className="size-4" /> Импорт профилей
          </h3>
          <Button size="sm" variant="ghost" onClick={handleClose}>
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
          <Button size="sm" variant="outline" onClick={handleClose}>
            Отмена
          </Button>
          <Button
            size="sm"
            disabled={!importJsonText.trim()}
            onClick={() => handleSubmit(importJsonText)}
          >
            Импортировать
          </Button>
        </div>
      </div>
    </div>
  );
};

export interface DeleteProfileModalProps {
  profile: PromptProfile | null;
  onCancel: () => void;
  onConfirm: (profile: PromptProfile) => void;
}

export const DeleteProfileModal: React.FC<DeleteProfileModalProps> = ({
  profile,
  onCancel,
  onConfirm,
}) => {
  if (!profile) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md space-y-3 rounded-xl border border-border bg-background p-5">
        <h3 className="text-sm font-semibold">
          Удалить профиль «{profile.name}»?
        </h3>
        <p className="text-xs text-muted-foreground">
          Его системный промпт будет потерян. Встроенные профили можно вернуть
          кнопкой «Restore built-in profiles».
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <Button size="sm" variant="outline" onClick={onCancel}>
            Отмена
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => onConfirm(profile)}
          >
            <Trash2Icon className="size-3.5 mr-1" />
            Удалить
          </Button>
        </div>
      </div>
    </div>
  );
};

export interface SwitchProfileModalProps {
  targetProfile: PromptProfile | null;
  currentProfileName?: string;
  onCancel: () => void;
  onDiscard: () => void;
  onSaveAndSwitch: () => void;
}

export const SwitchProfileModal: React.FC<SwitchProfileModalProps> = ({
  targetProfile,
  currentProfileName,
  onCancel,
  onDiscard,
  onSaveAndSwitch,
}) => {
  if (!targetProfile) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md space-y-3 rounded-xl border border-border bg-background p-5">
        <h3 className="text-sm font-semibold">Несохранённые изменения</h3>
        <p className="text-xs text-muted-foreground">
          В профиле «{currentProfileName}» есть несохранённые изменения.
          Сохранить их перед переключением на «{targetProfile.name}»?
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <Button size="sm" variant="outline" onClick={onCancel}>
            Отмена
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:bg-destructive/10"
            onClick={onDiscard}
          >
            Не сохранять
          </Button>
          <Button size="sm" onClick={onSaveAndSwitch}>
            Сохранить и перейти
          </Button>
        </div>
      </div>
    </div>
  );
};
