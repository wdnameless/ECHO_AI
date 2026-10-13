import { memo, useEffect, useState } from "react";
import { CheckIcon, PencilIcon, SparklesIcon, XIcon } from "lucide-react";

export interface RulePreviewProps {
  candidate: string;
  onSave: (text: string) => void;
  onEdit?: (text: string) => void;
  onCancel: () => void;
}

export const RulePreview = memo(function RulePreview({
  candidate,
  onSave,
  onEdit,
  onCancel,
}: RulePreviewProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(candidate);

  useEffect(() => {
    if (!isEditing) {
      setDraft(candidate);
    }
  }, [candidate, isEditing]);

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 py-1 px-2 rounded border border-violet-500/30 bg-violet-500/5 text-[0.72em]"
      role="region"
      aria-label="Превью правила"
    >
      <SparklesIcon className="w-3 h-3 text-violet-500 shrink-0" />
      {isEditing ? (
        <input
          type="text"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            onEdit?.(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const finalText = draft.trim() || candidate;
              if (finalText) onSave(finalText);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
            }
          }}
          className="flex-1 min-w-[140px] h-6 px-1.5 py-0.5 text-[0.95em] font-medium bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
        />
      ) : (
        <span className="flex-1 min-w-0 font-medium text-foreground break-words">
          {draft}
        </span>
      )}
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={() => {
            const finalText = (isEditing ? draft : candidate).trim();
            if (finalText) onSave(finalText);
          }}
          className="h-5 px-1.5 inline-flex items-center gap-1 rounded text-[0.9em] font-medium bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <CheckIcon className="w-2.5 h-2.5" />
          Сохранить
        </button>
        {!isEditing && (
          <button
            type="button"
            onClick={() => {
              setIsEditing(true);
              onEdit?.(draft);
            }}
            className="h-5 px-1.5 inline-flex items-center gap-1 rounded text-[0.9em] font-medium border border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted/50"
          >
            <PencilIcon className="w-2.5 h-2.5" />
            Править
          </button>
        )}
        <button
          type="button"
          onClick={onCancel}
          className="h-5 px-1.5 inline-flex items-center gap-1 rounded text-[0.9em] font-medium text-muted-foreground hover:text-foreground"
        >
          <XIcon className="w-2.5 h-2.5" />
          Отмена
        </button>
      </div>
    </div>
  );
});
