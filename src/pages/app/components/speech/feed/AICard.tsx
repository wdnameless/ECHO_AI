import { memo } from "react";
import {
  CheckIcon,
  CopyIcon,
  Loader2,
  SparklesIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { splitCodeAnswer } from "@/lib/code-answer";

export const DISLIKE_REASONS = [
  "Слишком длинно / много воды",
  "Слишком сухо / роботизировано",
  "Слишком сложно / академично",
  "Не попал в тему вопроса",
  "Лишние вводные слова",
  "Шаблонный зачин / ИИ-клише",
  "Отвечает не на мой вопрос",
  "Слишком коротко, не хватает деталей",
  "Звучит как лекция, а не как человек",
  "Много терминов, нужно проще",
  "Нет конкретики и примеров",
  "Повторяет то, что уже было сказано",
];

export const AI_CARD_BADGE = {
  label: "Ответ ИИ",
  cls: "text-violet-600 dark:text-violet-400 bg-violet-500/10 border-violet-500/30",
};

/** Splits an answer into compact justification thought block + spoken response. */
export function splitThoughtAnswer(text: string): {
  thought: string | null;
  answer: string;
} {
  const m = text.match(/<\s*thought\s*>([\s\S]*?)(?:<\s*\/thought\s*>|$)/i);
  if (!m) return { thought: null, answer: text };
  const thought = m[1].trim();
  const hasClosing = /<\s*\/thought\s*>/i.test(m[0]);
  const answer = hasClosing
    ? text.slice(m.index! + m[0].length).trim()
    : "";
  return { thought: thought || null, answer };
}

/** What the copy button puts on the clipboard: the spoken answer, never the thought trace. */
export function answerForCopy(text: string): string {
  const { thought, answer } = splitThoughtAnswer(text);
  if (thought === null) return text;
  return answer || text;
}

/** Extracts the raw snippet for the copy button (fence stripped, tabs kept). Thought prefix stripped first. */
export function splitCodeForCopy(text: string): string {
  const { answer } = splitThoughtAnswer(text);
  const { code } = splitCodeAnswer(answer || text);
  return code ?? text;
}

/** Thought trace container rendered inline on top of the answer. */
export const ThoughtContainer = memo(function ThoughtContainer({
  thought,
}: {
  thought: string;
}) {
  return (
    <div
      data-testid="thought-container"
      className="rounded-md border border-amber-500/30 bg-amber-500/5 dark:bg-amber-500/10 p-2 space-y-1 text-[0.8em] text-foreground/90 transition-all mb-1.5"
    >
      <div className="flex items-center gap-1.5 text-[0.72em] font-medium text-amber-600 dark:text-amber-400 uppercase tracking-wide">
        <SparklesIcon className="w-3 h-3" />
        <span>Ход мыслей</span>
      </div>
      <div className="leading-relaxed text-muted-foreground italic select-text">
        {thought}
      </div>
    </div>
  );
});

/** Code block with tab stops, copy-snippet button, and spoken narration below. */
export const CodeAnswerBody = memo(function CodeAnswerBody({
  code,
  lang,
  prose,
  onCopyCode,
  codeCopied,
}: {
  code: string;
  lang: string;
  prose: string[];
  onCopyCode: () => void;
  codeCopied: boolean;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="relative rounded-md border border-border/60 bg-black/80 dark:bg-black/60 overflow-hidden">
        <div className="flex items-center justify-between px-2 py-1 border-b border-white/10">
          <span className="text-[0.62em] font-mono text-white/60">{lang}</span>
          <button
            onClick={onCopyCode}
            className="flex items-center gap-1 text-[0.62em] text-white/60 hover:text-white transition-colors"
            title="Скопировать код (табуляция preserved)"
          >
            {codeCopied ? (
              <CheckIcon className="w-3 h-3 text-emerald-400" />
            ) : (
              <CopyIcon className="w-3 h-3" />
            )}
            {codeCopied ? "Скопировано" : "Код"}
          </button>
        </div>
        <pre className="m-0 p-2 overflow-x-auto text-[0.82em] leading-relaxed text-emerald-50 font-mono whitespace-pre" style={{ tabSize: 4 }}>
          <code>{code}</code>
        </pre>
      </div>
      {prose.map((p, i) => (
        <p key={i} className="leading-relaxed text-[0.86em] text-foreground">
          {p}
        </p>
      ))}
    </div>
  );
});

/** Routes code answers to the block renderer, prose to paragraphs, with thought container rendered inline. */
export const AnswerBody = memo(function AnswerBody({
  text,
  onCopyCode,
  codeCopied,
}: {
  text: string;
  onCopyCode?: () => void;
  codeCopied?: boolean;
}) {
  const { thought, answer } = splitThoughtAnswer(text);
  const contentText = thought !== null ? answer : text;
  const split = splitCodeAnswer(contentText);
  return (
    <div className="min-w-0 w-full space-y-1.5">
      {thought && <ThoughtContainer thought={thought} />}
      {!split.code ? (
        <div
          className="min-w-0 text-[0.86em] leading-relaxed text-foreground space-y-1.5"
          style={{ wordBreak: "break-word", overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}
        >
          {split.prose.map((p, i) => (
            <p key={i} className="leading-relaxed">
              {p}
            </p>
          ))}
        </div>
      ) : (
        <CodeAnswerBody
          code={split.code}
          lang={split.lang}
          prose={split.prose}
          onCopyCode={onCopyCode ?? (() => {})}
          codeCopied={codeCopied ?? false}
        />
      )}
    </div>
  );
});

export interface AICardProps {
  id: string;
  text: string;
  streaming?: boolean;
  feedback?: "like" | "dislike";
  translation?: string;
  translationsOn: boolean;
  /** True when this row's translation already failed (show a dash, not a spinner). */
  translationFailed: boolean;
  copied: boolean;
  isDislikeOpen: boolean;
  customReason: string;
  onCopy: (id: string, text: string) => void;
  onDeepen?: () => void;
  onFeedback: (
    id: string,
    text: string,
    rating: "like" | "dislike",
    reason?: string
  ) => void;
  onToggleDislike: (id: string) => void;
  onCustomReasonChange: (val: string) => void;
}

export const AICard = memo(function AICard({
  id,
  text,
  streaming,
  feedback,
  translation,
  translationsOn,
  translationFailed,
  copied,
  isDislikeOpen,
  customReason,
  onCopy,
  onDeepen,
  onFeedback,
  onToggleDislike,
  onCustomReasonChange,
}: AICardProps) {
  const badge = AI_CARD_BADGE;
  return (
    <div
      className={cn(
        "relative rounded-lg border p-2 space-y-1 transition-shadow",
        "border-violet-500/40 bg-violet-500/5 shadow-[0_0_0_1px_rgba(139,92,246,0.08)]",
        streaming && "opacity-90"
      )}
    >
      <div className="flex items-center justify-between text-[0.6em]">
        <span
          className={cn(
            "inline-flex items-center gap-1 font-semibold px-1 py-px rounded border uppercase tracking-wide",
            badge.cls
          )}
        >
          <SparklesIcon className="w-2.5 h-2.5" />
          {badge.label}
        </span>
        <div className="flex items-center gap-0.5">
          {feedback ? (
            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium px-1">
              <CheckIcon className="w-3 h-3" />
              {feedback === "like" ? "паттерн усвоен" : "учтено"}
            </span>
          ) : (
            !streaming && (
              <div className="flex items-center gap-0.5 relative">
                {onDeepen && (
                  <button
                    className="p-0.5 rounded hover:bg-violet-500/10 text-muted-foreground hover:text-violet-500"
                    title="Углубить эту тему: продолжить рассказ"
                    onClick={onDeepen}
                  >
                    <SparklesIcon className="w-3 h-3" />
                  </button>
                )}
                <button
                  className="p-0.5 rounded hover:bg-emerald-500/10 text-muted-foreground hover:text-emerald-500"
                  title="Лайк: закрепить стиль ответа"
                  onClick={() => onFeedback(id, text, "like")}
                >
                  <ThumbsUpIcon className="w-3 h-3" />
                </button>
                <button
                  className="p-0.5 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-500"
                  title="Дизлайк: указать, что улучшить"
                  onClick={() => onToggleDislike(id)}
                >
                  <ThumbsDownIcon className="w-3 h-3" />
                </button>
                {isDislikeOpen && (
                  <div className="absolute right-0 top-5 z-40 w-72 rounded-lg border border-border/80 bg-background/95 p-1.5 shadow-lg text-[10px] space-y-0.5 animate-in fade-in duration-100 max-h-80 overflow-y-auto">
                    <div className="px-2 py-1 font-semibold text-muted-foreground border-b border-border/40 uppercase tracking-wider text-[8px]">
                      Что улучшить в ответах?
                    </div>
                    {DISLIKE_REASONS.map((reason) => (
                      <button
                        key={reason}
                        onClick={() => onFeedback(id, text, "dislike", reason)}
                        className="w-full text-left px-2 py-1 rounded hover:bg-muted text-foreground/90 transition-colors"
                      >
                        {reason}
                      </button>
                    ))}
                    <div className="border-t border-border/40 pt-1 mt-1 flex items-center gap-1 px-1">
                      <input
                        value={customReason}
                        onChange={(ev) => onCustomReasonChange(ev.target.value)}
                        onKeyDown={(ev) => {
                          if (ev.key === "Enter" && customReason.trim()) {
                            onFeedback(id, text, "dislike", customReason.trim());
                          }
                        }}
                        placeholder="Своя причина…"
                        className="flex-1 min-w-0 bg-transparent border border-border/60 rounded px-1.5 py-0.5 text-[10px] outline-none focus:border-primary/60"
                      />
                      <button
                        onClick={() => {
                          if (customReason.trim()) {
                            onFeedback(id, text, "dislike", customReason.trim());
                          }
                        }}
                        className="px-1 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20"
                        title="Отправить"
                      >
                        ✓
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          )}
          <button
            onClick={() => onCopy(id, answerForCopy(text))}
            className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:opacity-100 text-muted-foreground hover:text-foreground"
            title="Скопировать ответ"
          >
            {copied ? (
              <CheckIcon className="w-3 h-3 text-emerald-500" />
            ) : (
              <CopyIcon className="w-3 h-3" />
            )}
          </button>
        </div>
      </div>

      <div
        className={cn(
          "grid gap-x-2 w-full min-w-0 max-w-full",
          translationsOn && !streaming ? "grid-cols-2" : "grid-cols-1"
        )}
      >
        <AnswerBody
          text={text}
          onCopyCode={() => onCopy(id, splitCodeForCopy(text))}
          codeCopied={copied}
        />
        {translationsOn && !streaming && (
          <div className="min-w-0 flex items-start border-l border-border/30 pl-2">
            {translation === undefined && !translationFailed ? (
              // Only a row still waiting on a provider spins. A row whose
              // translation failed used to spin forever, because a failure
              // leaves `translations[key]` unset and the spinner keyed on
              // exactly that.
              <Loader2 className="w-2.5 h-2.5 animate-spin text-muted-foreground/50 mt-1" />
            ) : translation === undefined ? (
              <span className="text-muted-foreground/50" title="Перевод недоступен">
                —
              </span>
            ) : (
              <p
                className="text-[0.8em] leading-relaxed text-violet-700/90 dark:text-violet-300/90"
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
    </div>
  );
});

export const AiFeedRow = AICard;
export type AiFeedRowProps = AICardProps;
