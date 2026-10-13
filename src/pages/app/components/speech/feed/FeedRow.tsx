import { memo, type RefObject } from "react";
import {
  CheckIcon,
  CopyIcon,
  HeadphonesIcon,
  Loader2,
  MicIcon,
  PencilIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { HoverTranslate } from "@/lib/hover-translate";
import { RulePreview } from "./RulePreview";

export const FEED_KIND_BADGE: Record<"me" | "them", { label: string; cls: string }> = {
  me: {
    label: "Вы",
    cls: "text-sky-600 dark:text-sky-400 bg-sky-500/10 border-sky-500/30",
  },
  them: {
    label: "Собеседник",
    cls: "text-primary bg-primary/10 border-primary/30",
  },
};

export interface FeedRowProps {
  id: string;
  kind: "me" | "them";
  text: string;
  streaming?: boolean;
  translation?: string;
  translationsOn: boolean;
  /** True when this row's translation already failed (show a dash, not a spinner). */
  translationFailed: boolean;
  isEditing: boolean;
  editWrongWord: string;
  editRightWord: string;
  editInputRef: RefObject<HTMLInputElement | null>;
  isSavingCorrection: boolean;
  showAskAI: boolean;
  isAskDisabled: boolean;
  showFillerBelow: boolean;
  activeFiller?: string | null;
  copied: boolean;
  ruleTaken?: boolean;
  rulePreviewCandidate?: string | null;
  onCopy: (id: string, text: string) => void;
  onAskAI?: (utteranceId: string, text: string, source: "me" | "them") => Promise<void>;
  onTakeAsRule?: (entryId: string, text: string) => void;
  onSaveRulePreview?: (entryId: string, text: string) => void;
  onEditRulePreview?: (entryId: string, text: string) => void;
  onCancelRulePreview?: () => void;
  onStartInlineEdit: (rowId: string, text: string, sel?: string) => void;
  onCancelInlineEdit: () => void;
  onSaveInlineEdit: (originalText: string, wrongWord: string, rightWord: string) => void;
  onEditRightWordChange: (val: string) => void;
}

export const FeedRow = memo(function FeedRow({
  id,
  kind,
  text,
  streaming,
  translation,
  translationsOn,
  translationFailed,
  isEditing,
  editWrongWord,
  editRightWord,
  editInputRef,
  isSavingCorrection,
  showAskAI,
  isAskDisabled,
  showFillerBelow,
  activeFiller,
  copied,
  ruleTaken,
  rulePreviewCandidate,
  onCopy,
  onAskAI,
  onTakeAsRule,
  onSaveRulePreview,
  onEditRulePreview,
  onCancelRulePreview,
  onStartInlineEdit,
  onCancelInlineEdit,
  onSaveInlineEdit,
  onEditRightWordChange,
}: FeedRowProps) {
  const badge = FEED_KIND_BADGE[kind];
  return (
    <div className="space-y-0.5">
      <div
        className={cn(
          "group grid gap-x-2 py-0.5 border-b border-border/20 hover:bg-muted/30 rounded transition-colors w-full min-w-0 max-w-full",
          translationsOn ? "grid-cols-2" : "grid-cols-1"
        )}
      >
        <div className="flex items-start gap-1.5 min-w-0 overflow-hidden">
          <span
            className={cn(
              "shrink-0 mt-px inline-flex items-center gap-0.5 text-[0.56em] font-semibold px-1 py-px rounded border uppercase tracking-wide",
              badge.cls
            )}
          >
            {kind === "me" ? (
              <MicIcon className="w-2.5 h-2.5" />
            ) : (
              <HeadphonesIcon className="w-2.5 h-2.5" />
            )}
            {badge.label}
          </span>

          {isEditing ? (
            <div className="flex-1 min-w-0 flex flex-col gap-1 py-0.5">
              <div className="flex items-center gap-1">
                <span
                  className="shrink-0 h-6 px-1.5 inline-flex items-center text-[0.72em] font-medium text-muted-foreground bg-muted/50 border border-border rounded"
                  title="Распознано (не редактируется)"
                >
                  {editWrongWord}
                </span>
                <span className="text-[0.7em] text-muted-foreground">→</span>
                <input
                  ref={editInputRef}
                  type="text"
                  value={editRightWord}
                  onChange={(e) => onEditRightWordChange(e.target.value)}
                  placeholder="Как правильно?"
                  className="flex-1 min-w-0 h-6 px-1.5 py-0.5 text-[0.74em] font-medium bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
                  onKeyDown={(evt) => {
                    if (evt.key === "Escape") {
                      evt.preventDefault();
                      onCancelInlineEdit();
                    } else if (evt.key === "Enter") {
                      evt.preventDefault();
                      if (editWrongWord && editRightWord) {
                        void onSaveInlineEdit(text, editWrongWord, editRightWord);
                      }
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    if (editWrongWord && editRightWord) {
                      void onSaveInlineEdit(text, editWrongWord, editRightWord);
                    }
                  }}
                  disabled={isSavingCorrection || !editRightWord.trim()}
                  className="shrink-0 h-6 px-1.5 inline-flex items-center gap-1 rounded text-[0.68em] font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  title="Сохранить в словарь"
                >
                  {isSavingCorrection ? (
                    <Loader2 className="w-2.5 h-2.5 animate-spin" />
                  ) : (
                    <CheckIcon className="w-2.5 h-2.5" />
                  )}
                  Сохранить
                </button>
                <button
                  type="button"
                  onClick={onCancelInlineEdit}
                  className="shrink-0 h-6 px-1 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground"
                  title="Отмена (Esc)"
                >
                  <XIcon className="w-3 h-3" />
                </button>
              </div>
              <span className="text-[0.62em] text-muted-foreground">
                Enter — сохранить в словарь ASR, Esc — отмена
              </span>
            </div>
          ) : (
            <p
              onMouseUp={() => {
                const sel = window.getSelection()?.toString().trim();
                if (sel && sel.split(/\s+/).length <= 4) {
                  onStartInlineEdit(id, text, sel);
                }
              }}
              className={cn(
                "flex-1 min-w-0 text-[0.76em] leading-snug break-words cursor-text",
                kind === "me"
                  ? "text-foreground/80"
                  : "text-foreground/95 font-medium",
                streaming && "italic text-muted-foreground"
              )}
              style={{
                wordBreak: "break-word",
                overflowWrap: "anywhere",
                whiteSpace: "pre-wrap",
              }}
              title="Выделите слово для исправления"
            >
              {streaming ? text : <HoverTranslate text={text} />}
            </p>
          )}

          {!isEditing && (
            <button
              type="button"
              onClick={() => onStartInlineEdit(id, text)}
              className={cn(
                "shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[0.62em] font-medium transition-colors border",
                "text-muted-foreground hover:text-foreground border-border/40 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary",
                "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              )}
              aria-label="Исправить"
              title="Исправить слово в словаре"
            >
              <PencilIcon className="w-2.5 h-2.5" />
              Исправить
            </button>
          )}

          {showAskAI && (
            <button
              type="button"
              onClick={() => onAskAI?.(id, text, "me")}
              disabled={isAskDisabled}
              className={cn(
                "shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[0.62em] font-medium transition-colors border",
                "text-violet-600 dark:text-violet-300 border-violet-500/30 hover:bg-violet-500/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet-500",
                "disabled:opacity-40 disabled:pointer-events-none"
              )}
              aria-label="Спросить ИИ"
              title="Спросить ИИ"
            >
              <SparklesIcon className="w-2.5 h-2.5" />
              Спросить ИИ
            </button>
          )}
          {kind === "them" && !streaming && !isEditing && onTakeAsRule && (
            <button
              type="button"
              onClick={() => onTakeAsRule(id, text)}
              className={cn(
                "shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[0.62em] font-medium transition-colors border",
                ruleTaken
                  ? "text-emerald-600 dark:text-emerald-400 border-emerald-500/40 bg-emerald-500/10"
                  : "text-violet-600 dark:text-violet-300 border-violet-500/30 hover:bg-violet-500/10 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              )}
              aria-label="Взять как правило"
              title="Взять как правило"
            >
              {ruleTaken ? (
                <CheckIcon className="w-2.5 h-2.5" />
              ) : (
                <SparklesIcon className="w-2.5 h-2.5" />
              )}
              Взять как правило
            </button>
          )}
          {!isEditing && (
            <button
              onClick={() => onCopy(id, text)}
              className="shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity text-muted-foreground hover:text-foreground mt-0.5"
              title="Скопировать"
            >
              {copied ? (
                <CheckIcon className="w-3 h-3 text-emerald-500" />
              ) : (
                <CopyIcon className="w-3 h-3" />
              )}
            </button>
          )}
        </div>
        {translationsOn && (
          <div className="min-w-0 flex items-start">
            {translation === undefined && !translationFailed ? (
              <Loader2 className="w-2.5 h-2.5 animate-spin text-muted-foreground/40 mt-0.5" />
            ) : translation === undefined ? (
              <span className="text-muted-foreground/40" title="Перевод недоступен">
                —
              </span>
            ) : (
              <p
                className="flex-1 min-w-0 text-[0.72em] leading-snug text-primary/75 break-words"
                style={{
                  wordBreak: "break-word",
                  overflowWrap: "anywhere",
                  whiteSpace: "pre-wrap",
                }}
              >
                {translation}
              </p>
            )}
          </div>
        )}
      </div>
      {showFillerBelow && (
        <div
          className="flex items-center gap-1.5 py-1 px-2 rounded border border-violet-500/20 bg-violet-500/5 text-violet-600 dark:text-violet-300 text-[0.72em]"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="w-3 h-3 animate-spin shrink-0" />
          <span className="truncate">{activeFiller}</span>
        </div>
      )}
      {rulePreviewCandidate !== undefined && rulePreviewCandidate !== null && onSaveRulePreview && onCancelRulePreview && (
        <RulePreview
          candidate={rulePreviewCandidate}
          onSave={(finalText) => onSaveRulePreview(id, finalText)}
          onEdit={(editedText) => onEditRulePreview?.(id, editedText)}
          onCancel={onCancelRulePreview}
        />
      )}
    </div>
  );
});

export const SpeechFeedRow = FeedRow;
