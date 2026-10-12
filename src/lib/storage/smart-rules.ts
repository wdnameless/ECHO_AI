import { safeLocalStorage } from "./helper";

export type RuleScope =
  | { kind: "global" }
  | { kind: "profile"; profileId: string }
  | { kind: "topic"; topic: string };

export type RuleSource = "coach" | "manual" | "feedback";

export interface SmartRule {
  id: string;
  text: string;
  weight: number;
  scope: RuleScope;
  hits: number;
  createdAt: number;
  lastHitAt: number | null;
  ttlDays: number | null;
  archived: boolean;
  origin: {
    source: RuleSource;
    quote: string;
    at: number;
  };
}

export const SMART_RULES_STORAGE_KEY = "user_memory_smart_rules";
export const SMART_RULES_MIGRATED_KEY = "user_memory_smart_rules_migrated";
const LEGACY_STYLE_KEY = "user_memory_style";
const LEGACY_RULE_SOURCES_KEY = "user_memory_rule_sources";

export function createDefaultSmartRule(
  text: string,
  source: RuleSource = "coach"
): SmartRule {
  const trimmed = text.trim();
  const now = Date.now();
  return {
    id: `sr-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    text: trimmed,
    weight: 1.0,
    scope: { kind: "global" },
    hits: 0,
    createdAt: now,
    lastHitAt: null,
    ttlDays: null,
    archived: false,
    origin: {
      source,
      quote: trimmed,
      at: now,
    },
  };
}

function getSmartRulesRaw(): SmartRule[] {
  const raw = safeLocalStorage.getItem(SMART_RULES_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SmartRule[]) : [];
  } catch {
    return [];
  }
}

function saveSmartRulesRaw(rules: SmartRule[]): void {
  safeLocalStorage.setItem(SMART_RULES_STORAGE_KEY, JSON.stringify(rules));
}

export function getSmartRules(includeArchived = false): SmartRule[] {
  if (safeLocalStorage.getItem(SMART_RULES_MIGRATED_KEY) !== "1") {
    migrateLegacyRules();
  }
  const rules = getSmartRulesRaw();
  if (includeArchived) return rules;
  return rules.filter((r) => !r.archived);
}

export function saveSmartRule(rule: SmartRule): void {
  const rules = getSmartRulesRaw();
  const byIdIndex = rules.findIndex((r) => r.id === rule.id);
  if (byIdIndex >= 0) {
    rules[byIdIndex] = rule;
  } else {
    const byTextIndex = rules.findIndex(
      (r) =>
        r.text.trim().toLowerCase() === rule.text.trim().toLowerCase() &&
        JSON.stringify(r.scope) === JSON.stringify(rule.scope)
    );
    if (byTextIndex >= 0) {
      rules[byTextIndex] = {
        ...rules[byTextIndex],
        ...rule,
        id: rules[byTextIndex].id,
      };
    } else {
      rules.push(rule);
    }
  }
  saveSmartRulesRaw(rules);
}

export function archiveSmartRule(id: string): void {
  const rules = getSmartRulesRaw();
  const rule = rules.find((r) => r.id === id);
  if (rule) {
    rule.archived = true;
    saveSmartRulesRaw(rules);
  }
}

export function deleteSmartRule(id: string): void {
  const allRules = getSmartRulesRaw();
  const deleted = allRules.filter((r) => r.id === id);
  const rules = allRules.filter((r) => r.id !== id);
  saveSmartRulesRaw(rules);

  if (deleted.length > 0) {
    const legacyStyleRaw = safeLocalStorage.getItem(LEGACY_STYLE_KEY);
    if (legacyStyleRaw) {
      try {
        const parsed = JSON.parse(legacyStyleRaw);
        if (Array.isArray(parsed?.customRules)) {
          parsed.customRules = parsed.customRules.filter(
            (r: unknown) =>
              typeof r !== "string" ||
              !deleted.some(
                (d) => d.text.trim().toLowerCase() === r.trim().toLowerCase()
              )
          );
          safeLocalStorage.setItem(LEGACY_STYLE_KEY, JSON.stringify(parsed));
        }
      } catch {
        /* ignore malformed legacy style */
      }
    }
  }
}

export function recordRuleHit(id: string): void {
  const rules = getSmartRulesRaw();
  const rule = rules.find((r) => r.id === id);
  if (rule) {
    rule.hits = (rule.hits ?? 0) + 1;
    rule.lastHitAt = Date.now();
    saveSmartRulesRaw(rules);
  }
}

interface OpposingCluster {
  sideA: string[];
  sideB: string[];
}

const OPPOSING_CLUSTERS: OpposingCluster[] = [
  // Brevity vs Detail
  {
    sideA: [
      "коротк",
      "кратк",
      "лаконич",
      "сжат",
      "тезисн",
      "емк",
      "без воды",
      "по делу",
      "минимум слов",
      "сокращай",
      "укорачивай",
      "concise",
      "brief",
      "short",
    ],
    sideB: [
      "подробн",
      "развернут",
      "детальн",
      "обстоятельн",
      "длинн",
      "углубляй",
      "углублять",
      "много слов",
      "detailed",
      "long",
      "verbose",
    ],
  },
  // Speed
  {
    sideA: ["быстр", "спеши", "срочн", "fast", "quick"],
    sideB: ["медленн", "не спеши", "не торопись", "slow"],
  },
  // Language
  {
    sideA: ["на русском", "по-русски", "русск", "russian"],
    sideB: ["на английском", "по-английски", "английск", "english"],
  },
  // Formality
  {
    sideA: ["на вы", "официальн", "формальн", "вежлив"],
    sideB: ["на ты", "разговорн", "неформальн", "дружелюбн", "по-дружески", "на чилле"],
  },
  // Code
  {
    sideA: [
      "с кодом",
      "больше кода",
      "только код",
      "показывай код",
      "пиши код",
      "примеров кода",
    ],
    sideB: ["без кода", "не пиши код", "только текст", "словами без кода"],
  },
  // Directness
  {
    sideA: ["прямо", "в лоб", "без экивоков", "без прелюдий", "резко"],
    sideB: ["мягко", "вежливо", "дипломатично", "сглаживай"],
  },
  // Humor
  {
    sideA: ["с юмором", "шути", "иронич", "с шутками"],
    sideB: ["без юмора", "серьезн", "без шуток", "строго по делу"],
  },
];

function normalize(text: string): string {
  return text.toLowerCase().replace(/[,.!?:;]/g, " ").replace(/\s+/g, " ").trim();
}


export function findConflictingRule(text: string): SmartRule | null {
  const normTarget = normalize(text);
  if (!normTarget) return null;

  const activeRules = getSmartRules(false);

  for (const rule of activeRules) {
    const normRule = normalize(rule.text);
    if (!normRule || normRule === normTarget) continue;

    // 1. Semantic clusters
    for (const cluster of OPPOSING_CLUSTERS) {
      const targetA = cluster.sideA.some((t) => normTarget.includes(t));
      const targetB = cluster.sideB.some((t) => normTarget.includes(t));
      const ruleA = cluster.sideA.some((t) => normRule.includes(t));
      const ruleB = cluster.sideB.some((t) => normRule.includes(t));

      if ((targetA && ruleB) || (targetB && ruleA)) {
        return rule;
      }
    }

    // 2. Direct negation ("без X" vs "с X" / "X")
    const withoutTarget = normTarget.match(/\bбез\s+([а-яa-z]{4,})/i);
    const withoutRule = normRule.match(/\bбез\s+([а-яa-z]{4,})/i);
    if (withoutTarget && !withoutRule) {
      const stem = withoutTarget[1].slice(0, 4);
      if (normRule.includes(stem)) {
        return rule;
      }
    }
    if (withoutRule && !withoutTarget) {
      const stem = withoutRule[1].slice(0, 4);
      if (normTarget.includes(stem)) {
        return rule;
      }
    }

    // 3. Verb negation ("не X" vs "X")
    const notTarget = normTarget.match(/\bне\s+([а-яa-z]{4,})/i);
    const notRule = normRule.match(/\bне\s+([а-яa-z]{4,})/i);
    if (notTarget && !notRule) {
      const stem = notTarget[1].slice(0, 4);
      if (normRule.includes(stem)) {
        return rule;
      }
    }
    if (notRule && !notTarget) {
      const stem = notRule[1].slice(0, 4);
      if (normTarget.includes(stem)) {
        return rule;
      }
    }
  }

  return null;
}

export function runRuleMaintenance(now: number = Date.now()): string[] {
  const rules = getSmartRulesRaw();
  const archivedIds: string[] = [];
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

  for (const rule of rules) {
    if (rule.archived) continue;
    let shouldArchive = false;

    // Dead rule: weight <= 0 and 30 days without hits
    const lastActive = rule.lastHitAt ?? rule.createdAt;
    if (rule.weight <= 0 && now - lastActive >= thirtyDaysMs) {
      shouldArchive = true;
    }

    // TTL expired
    if (
      rule.ttlDays !== null &&
      rule.ttlDays > 0 &&
      now - rule.createdAt >= rule.ttlDays * 24 * 60 * 60 * 1000
    ) {
      shouldArchive = true;
    }

    if (shouldArchive) {
      rule.archived = true;
      archivedIds.push(rule.id);
    }
  }

  if (archivedIds.length > 0) {
    saveSmartRulesRaw(rules);
  }
  return archivedIds;
}

export function migrateLegacyRules(): number {
  if (safeLocalStorage.getItem(SMART_RULES_MIGRATED_KEY) === "1") {
    return 0;
  }

  const legacyStyleRaw = safeLocalStorage.getItem(LEGACY_STYLE_KEY);
  if (!legacyStyleRaw) {
    if (safeLocalStorage.getItem(SMART_RULES_STORAGE_KEY) === null) {
      saveSmartRulesRaw([]);
    }
    return 0;
  }

  let customRules: string[] = [];
  try {
    const parsed = JSON.parse(legacyStyleRaw);
    if (Array.isArray(parsed?.customRules)) {
      customRules = parsed.customRules;
    }
  } catch {
    return 0;
  }

  if (customRules.length === 0) {
    if (safeLocalStorage.getItem(SMART_RULES_STORAGE_KEY) === null) {
      saveSmartRulesRaw([]);
    }
    return 0;
  }

  const sourcesRaw = safeLocalStorage.getItem(LEGACY_RULE_SOURCES_KEY);
  let sourcesMap: Record<string, RuleSource> = {};
  if (sourcesRaw) {
    try {
      sourcesMap = JSON.parse(sourcesRaw) ?? {};
    } catch {
      sourcesMap = {};
    }
  }

  const currentRules = getSmartRulesRaw();
  let migrated = 0;

  for (const text of customRules) {
    const trimmed = (text || "").trim();
    if (!trimmed) continue;

    const exists = currentRules.some(
      (r) => r.text.toLowerCase() === trimmed.toLowerCase()
    );
    if (exists) continue;

    const source: RuleSource = sourcesMap[trimmed] ?? "coach";
    currentRules.push(createDefaultSmartRule(trimmed, source));
    migrated++;
  }

  saveSmartRulesRaw(currentRules);
  safeLocalStorage.setItem(SMART_RULES_MIGRATED_KEY, "1");

  return migrated;
}

// Initial migration on load
migrateLegacyRules();
