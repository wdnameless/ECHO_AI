/**
 * Visual Answers module (S5 / R15, R16).
 * Decides when to request Mermaid diagrams from LLM and extracts diagram blocks.
 */

export const VISUAL_PROMPT_HINT =
  "VISUAL DIAGRAM RULE: When answering system design, architecture, flow, or sequence questions, include a clear Mermaid diagram enclosed in ```mermaid ... ``` code fences to visually illustrate the solution alongside the explanation. Never output empty or placeholder diagrams.";

const EN_VISUAL_PATTERN =
  /\b(?:system\s+design|architect(?:ure)?|diagram|flowchart|data\s*flow|workflow|sequence\s+diagram|component\s+diagram|erd|uml|state\s+machine|pipeline|topology|infrastructure|lifecycle|(?:draw|visualize|illustrate)\s+(?:a|an|the|me)?|(?:design\s+(?:a|an|the)?\s*(?!pattern\b)[\w-]+))\b/i;

const RU_VISUAL_PATTERN =
  /(?:системн\w*\s+дизайн\w*|дизайн\w*\s+систем\w*|спроектируй\w*|архитектур\w*|диаграмм\w*|блок-схем\w*|схем\w*|поток\w*\s+данных|последовательност\w*|пайплайн\w*|конвейер\w*|стейт-машин\w*|взаимодействи\w*\s+(?:сервис|компонент|микросервис|модул|систем)|структур\w*\s+(?:бд|баз\w*\s+данных|таблиц|сервис|компонент|систем)|жизненн\w*\s+цикл\w*|(?:нарисуй|изобрази|визуализируй)\w*)/i;

/**
 * Checks if the given question implies a diagram (architecture, flow, sequence)
 * and if the current profile allows visual answers (interview / livecode).
 */
export function shouldOfferVisual(profileId: string, question: string): boolean {
  if (!profileId || typeof profileId !== "string") return false;
  const normalizedId = profileId.trim().toLowerCase();
  const isEligibleProfile =
    normalizedId.includes("interview") || normalizedId.includes("livecode");

  if (!isEligibleProfile) return false;

  if (!question || typeof question !== "string") return false;
  const trimmed = question.trim();
  if (!trimmed) return false;

  return EN_VISUAL_PATTERN.test(trimmed) || RU_VISUAL_PATTERN.test(trimmed);
}

/**
 * Extracts mermaid diagram code from markdown fences.
 * Handles both standard closed fences and unclosed fences during active streaming.
 */
export function extractMermaidBlocks(markdown: string): string[] {
  if (!markdown || typeof markdown !== "string") return [];
  const regex =
    /(?:^|\n)[ \t]*(?:`{3,}|~{3,})mermaid[ \t]*\r?\n([\s\S]*?)(?:(?:`{3,}|~{3,})|$)/gi;
  const blocks: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(markdown)) !== null) {
    const content = match[1].trim();
    if (content) {
      blocks.push(content);
    }
  }

  return blocks;
}
