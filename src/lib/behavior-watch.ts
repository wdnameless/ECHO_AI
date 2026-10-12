import {
  createDefaultSmartRule,
  saveSmartRule,
  type SmartRule,
} from "./storage/smart-rules";

export interface BehaviorSuggestion {
  id: string;
  ruleText: string;
  reason: string;
  at: number;
}

const SHORTEN_THRESHOLD = 3;
const LENGTH_SWITCH_THRESHOLD = 3;
const ELABORATE_THRESHOLD = 3;

let shortenCount = 0;
let elaborateCount = 0;
let lastLengthSwitch: "concise" | "detailed" | null = null;
let lengthSwitchCount = 0;

let activeSuggestions: Map<string, BehaviorSuggestion> = new Map();
export const BEHAVIOR_SUGGESTION_EVENT = "behavior-suggestion-changed";

function notifySuggestionsChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(BEHAVIOR_SUGGESTION_EVENT));
  }
}

/**
 * Observes a manual user action to shorten an answer.
 * When fired 3 times, suggests a rule: "отвечать короче".
 * NOTHING is persisted without explicit confirmation.
 */
export function observeShorten(): BehaviorSuggestion | null {
  shortenCount++;
  if (shortenCount >= SHORTEN_THRESHOLD) {
    shortenCount = 0;
    const suggestion: BehaviorSuggestion = {
      id: `suggestion-shorten-${Date.now().toString(36)}`,
      ruleText: "отвечать короче",
      reason: "3 укорачивания ответов подряд",
      at: Date.now(),
    };
    activeSuggestions.set(suggestion.id, suggestion);
    notifySuggestionsChanged();
    return suggestion;
  }
  return null;
}

/**
 * Observes repeated length switches (e.g. switching to concise or detailed).
 * When 3 switches to the same target occur consecutively, suggests a rule.
 * NOTHING is persisted without explicit confirmation.
 */
export function observeLengthSwitch(
  targetLength: "concise" | "detailed"
): BehaviorSuggestion | null {
  if (lastLengthSwitch === targetLength) {
    lengthSwitchCount++;
  } else {
    lastLengthSwitch = targetLength;
    lengthSwitchCount = 1;
  }

  if (lengthSwitchCount >= LENGTH_SWITCH_THRESHOLD) {
    lengthSwitchCount = 0;
    lastLengthSwitch = null;
    const isConcise = targetLength === "concise";
    const suggestion: BehaviorSuggestion = {
      id: `suggestion-length-${targetLength}-${Date.now().toString(36)}`,
      ruleText: isConcise ? "отвечать кратко" : "отвечать подробно",
      reason: `3 переключения на ${isConcise ? "краткий" : "подробный"} режим подряд`,
      at: Date.now(),
    };
    activeSuggestions.set(suggestion.id, suggestion);
    notifySuggestionsChanged();
    return suggestion;
  }
  return null;
}

/**
 * Observes user requests for elaboration/expansion.
 * When fired 3 times, suggests a rule: "отвечать подробнее".
 * NOTHING is persisted without explicit confirmation.
 */
export function observeElaborate(): BehaviorSuggestion | null {
  elaborateCount++;
  if (elaborateCount >= ELABORATE_THRESHOLD) {
    elaborateCount = 0;
    const suggestion: BehaviorSuggestion = {
      id: `suggestion-elaborate-${Date.now().toString(36)}`,
      ruleText: "отвечать подробнее",
      reason: "3 запроса подробного ответа подряд",
      at: Date.now(),
    };
    activeSuggestions.set(suggestion.id, suggestion);
    notifySuggestionsChanged();
    return suggestion;
  }
  return null;
}

/**
 * Dismisses a behavior suggestion by id without saving any rule.
 */
export function dismissSuggestion(id: string): void {
  activeSuggestions.delete(id);
  notifySuggestionsChanged();
}

/**
 * Returns currently pending behavior suggestions.
 */
export function getActiveSuggestions(): BehaviorSuggestion[] {
  return Array.from(activeSuggestions.values());
}

/**
 * Explicitly confirms and persists a suggested rule.
 * ONLY upon this call does the rule get saved to smart-rules storage.
 */
export function confirmSuggestion(id: string): SmartRule | null {
  const suggestion = activeSuggestions.get(id);
  if (!suggestion) return null;

  const rule = createDefaultSmartRule(suggestion.ruleText, "feedback");
  rule.origin.quote = suggestion.reason;
  saveSmartRule(rule);

  activeSuggestions.delete(id);
  notifySuggestionsChanged();
  return rule;
}

/**
 * Resets internal counters and active suggestions (primarily for tests).
 */
export function resetBehaviorWatch(): void {
  shortenCount = 0;
  elaborateCount = 0;
  lastLengthSwitch = null;
  lengthSwitchCount = 0;
  activeSuggestions.clear();
  notifySuggestionsChanged();
}
