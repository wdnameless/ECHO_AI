import { MARKDOWN_FORMATTING_INSTRUCTIONS } from "@/config/constants";
import {
  SHORT_LENGTH_PROMPT,
  LONG_LENGTH_PROMPT,
  resolveAnswerLength,
  type AnswerLengthOverride,
} from "@/lib/answer-length";
import {
  HUMANIZER_INSTRUCTIONS,
  INTERVIEW_MODE_INSTRUCTIONS,
} from "@/config/humanizer.rules";
import {
  LANGUAGE_RULE,
  buildSelfEvolutionPromptBlock,
  isSelfLearningEnabled,
  getUserStylePreferences,
  setSelfEvolutionStyleOverride,
} from "@/lib/storage/user-facts";
import { VISUAL_PROMPT_HINT } from "@/lib/visual-answers";
import type { AnswerMode } from "@/lib/answer-mode";
import type { PromptProfile } from "@/lib/storage/prompt-profiles";
import type { MemoryHit } from "@/lib/rag";

export const THOUGHT_TRACE_PROMPT =
  "THOUGHT-TRACE MODE (ХОД МЫСЛЕЙ):\n" +
  "Before your direct spoken answer, provide a compact justification block explaining your line of thought (strictly 2-3 phrases: why this approach, what trade-offs you considered, what you relied upon / на что опирался).\n" +
  "Enclose this justification inside <thought>...</thought> tags at the very start of your response.\n" +
  "Example format:\n" +
  "<thought>\n" +
  "Опираюсь на соображения масштабируемости и изоляции отказов. Для таких нагрузок лучше разделить сервис на независимые воркеры с очередью сообщений.\n" +
  "</thought>\n" +
  "Follow immediately with your natural spoken answer to the interviewer.";

export const CONVERSATIONAL_FILTER_RULE =
  "CONVERSATIONAL FILTER RULE: If the user input is merely a conversational acknowledgment, reaction, or filler sound (e.g. 'угу', 'мгм', 'ага', 'да', 'ну', 'хм', 'ок', 'yeah', 'uh-huh', 'mhm', 'got it') without a substantive question or topic, DO NOT replicate the filler or generate a lengthy answer. Only answer when an actual question, technical query, or request is made.";

export const PROMPT_BLOCK_ORDER = [
  "base",
  "thought",
  "filter",
  "visual",
  "length",
  "humanizer",
  "opener",
  "resume",
  "job",
  "memory",
  "language",
  "evolution",
  "search",
] as const;

export interface PromptContext {
  baseSystemPrompt?: string;
  mode?: AnswerMode;
  userMessage?: string;
  offerVisual?: boolean;
  answerLength?: "short" | "long";
  answerLengthOverride?: AnswerLengthOverride;
  humanizer?: {
    enabled?: boolean;
    interviewMode?: boolean;
    customStyle?: string;
  };
  opener?: string | null;
  resumeContent?: string | null;
  jobContent?: string | null;
  pastMeetingsContent?: string | null;
  memoryHits?: MemoryHit[];
  languagePrompt?: string;
  strictLanguageRule?: string;
  evolutionBlock?: string | null;
  searchBlock?: string | null;
  searchPrompt?: string | null;
  profile?: PromptProfile;
  separator?: string;
}

/**
 * Pure prompt assembly function.
 * Given a context snapshot, builds and formats the complete system prompt deterministically.
 */
export function buildPrompt(ctx: PromptContext): string {
  const prompts: string[] = [];

  const baseSystemPrompt =
    ctx.baseSystemPrompt ??
    (ctx.profile?.systemPrompt ? ctx.profile.systemPrompt.trim() : undefined);

  if (baseSystemPrompt) {
    prompts.push(baseSystemPrompt);
  }

  const activeMode = ctx.mode ?? "interview";

  // Thought trace justification block: inserted right after base prompt
  if (activeMode === "thought" && !baseSystemPrompt?.includes("THOUGHT-TRACE MODE")) {
    prompts.push(THOUGHT_TRACE_PROMPT);
  }

  // Anti-filler & question intent instruction
  prompts.push(CONVERSATIONAL_FILTER_RULE);

  // Markdown formatting instructions
  prompts.push(MARKDOWN_FORMATTING_INSTRUCTIONS);

  // Visual diagram rule
  if (ctx.offerVisual && !baseSystemPrompt?.includes("VISUAL DIAGRAM RULE")) {
    prompts.push(VISUAL_PROMPT_HINT);
  }

  // Answer length
  if (activeMode === "thought") {
    prompts.push(LONG_LENGTH_PROMPT);
  } else {
    let answerLength = ctx.answerLength;
    if (!answerLength) {
      const defaultLength =
        ctx.answerLengthOverride ?? ctx.profile?.defaultLength ?? "auto";
      answerLength = resolveAnswerLength(ctx.userMessage || "", defaultLength);
    }
    prompts.push(answerLength === "long" ? LONG_LENGTH_PROMPT : SHORT_LENGTH_PROMPT);
  }

  // Humanizer rules: skipped in thought mode so humanizer cap/formatting rules do not suppress thoughts
  if (activeMode !== "thought") {
    const humanizer =
      ctx.humanizer ??
      (ctx.profile
        ? {
            enabled: ctx.profile.humanizerEnabled,
            interviewMode: ctx.profile.interviewMode,
            customStyle: ctx.profile.customStyle,
          }
        : undefined);

    if (humanizer?.enabled) {
      prompts.push(HUMANIZER_INSTRUCTIONS);
      if (humanizer.interviewMode) {
        prompts.push(
          INTERVIEW_MODE_INSTRUCTIONS.replace(
            /KEEP ANSWERS CONCISE: strictly 1-3 spoken sentences \(35-55 words maximum\)\. Get straight to the point\./,
            "LENGTH: the ANSWER-LENGTH rule above decides (short = tight, long = full detail)."
          )
        );
      }
      if (humanizer.customStyle?.trim()) {
        prompts.push(`Match this personal speaking style: ${humanizer.customStyle.trim()}`);
      }
    }
  }

  // Rotating opener: skipped in thought mode so response opens cleanly with <thought>
  if (activeMode !== "thought" && ctx.opener !== undefined) {
    if (ctx.opener) {
      prompts.push(`Open with exactly this phrase, then answer: "${ctx.opener}"`);
    } else {
      prompts.push("Start straight into the answer with no introductory phrase.");
    }
  }

  // RAG context: resume
  const resumeContent =
    ctx.resumeContent ??
    (ctx.profile?.ragResumeEnabled
      ? "<Candidate resume experience & skills injected here>"
      : undefined);

  if (resumeContent?.trim()) {
    prompts.push(`[CONTEXT: MY RESUME]\n${resumeContent.trim()}\n[/CONTEXT]`);
  }

  // RAG context: job description
  const jobContent =
    ctx.jobContent ??
    (ctx.profile?.ragJobEnabled
      ? "<Vacancy requirements & job context injected here>"
      : undefined);

  if (jobContent?.trim()) {
    prompts.push(`[CONTEXT: JOB DESCRIPTION]\n${jobContent.trim()}\n[/CONTEXT]`);
  }

  // RAG context: relevant past meetings
  if (ctx.pastMeetingsContent?.trim()) {
    prompts.push(
      `[CONTEXT: RELEVANT PAST MEETINGS]\n${ctx.pastMeetingsContent.trim()}\n[/CONTEXT]`
    );
  } else if (ctx.memoryHits && ctx.memoryHits.length > 0) {
    const relevantHits = ctx.memoryHits.filter((h) => h.score >= 0.45);
    if (relevantHits.length > 0) {
      const memoryBlock = relevantHits
        .map((h) => `[MEETING CONVERSATION: ${h.conversationId}]\n${h.text}`)
        .join("\n\n");
      prompts.push(
        `[CONTEXT: RELEVANT PAST MEETINGS]\n${memoryBlock}\n[/CONTEXT]`
      );
    }
  }

  // Language option prompt
  if (ctx.languagePrompt?.trim()) {
    prompts.push(ctx.languagePrompt.trim());
  }

  // Strict language rule applies globally and unconditionally
  let languageRule = ctx.strictLanguageRule;
  if (!languageRule) {
    try {
      languageRule = LANGUAGE_RULE;
    } catch {
      // partial mock fallback
    }
  }
  if (languageRule) {
    prompts.push(languageRule);
  }
  // Self-Evolution Memory & Personal Facts injection (volatile)
  if (ctx.evolutionBlock?.trim()) {
    prompts.push(ctx.evolutionBlock.trim());
  }

  // Live web search results injection (tail volatile block)
  const searchBlock = ctx.searchBlock ?? ctx.searchPrompt;
  if (searchBlock?.trim()) {
    prompts.push(searchBlock.trim());
  }
  return prompts.join(ctx.separator ?? " ");
}

/**
 * Builds the preview prompt for a profile in the settings UI.
 * Reuses the same pure buildPrompt assembly as runtime.
 */
export function buildPreviewPrompt(profile: PromptProfile): string {
  let evolutionBlock: string | null = null;
  try {
    const learningEnabled =
      typeof isSelfLearningEnabled === "function" ? isSelfLearningEnabled() : true;
    if (learningEnabled && typeof buildSelfEvolutionPromptBlock === "function") {
      try {
        if (
          typeof getUserStylePreferences === "function" &&
          typeof setSelfEvolutionStyleOverride === "function"
        ) {
          setSelfEvolutionStyleOverride(getUserStylePreferences());
        }
      } catch {
        // partial mock fallback
      }
      evolutionBlock = buildSelfEvolutionPromptBlock() || null;
    }
  } catch {
    // partial mock fallback
  }

  return buildPrompt({
    profile,
    evolutionBlock,
    separator: "\n\n",
  });
}
