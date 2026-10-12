import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getSmartRules,
  saveSmartRule,
  archiveSmartRule,
  deleteSmartRule,
  recordRuleHit,
  findConflictingRule,
  runRuleMaintenance,
  migrateLegacyRules,
  type SmartRule,
} from "../smart-rules";
import {
  addUserRule,
  buildSelfEvolutionPromptBlock,
  getUserStylePreferences,
  saveUserStylePreferences,
  setSelfLearningEnabled,
} from "../user-facts";

describe("SmartRule storage & lifecycle (F2 T2 / R03-R06)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe("Lifecycle (R03)", () => {
    it("creates, retrieves, and updates SmartRule with full metadata", () => {
      const now = Date.now();
      const rule: SmartRule = {
        id: "rule-1",
        text: "отвечай коротко",
        weight: 1.0,
        scope: { kind: "global" },
        hits: 0,
        createdAt: now,
        lastHitAt: null,
        ttlDays: 14,
        archived: false,
        origin: { source: "manual", quote: "отвечай коротко", at: now },
      };

      saveSmartRule(rule);
      const active = getSmartRules();
      expect(active).toHaveLength(1);
      expect(active[0]).toEqual(rule);

      // Update weight
      saveSmartRule({ ...rule, weight: 1.5 });
      const updated = getSmartRules();
      expect(updated).toHaveLength(1);
      expect(updated[0].weight).toBe(1.5);
    });

    it("records rule hit, incrementing hits counter and updating lastHitAt", () => {
      const start = 1_000_000;
      const rule: SmartRule = {
        id: "rule-hits",
        text: "больше примеров кода",
        weight: 1.0,
        scope: { kind: "topic", topic: "coding" },
        hits: 0,
        createdAt: start,
        lastHitAt: null,
        ttlDays: null,
        archived: false,
        origin: { source: "coach", quote: "больше примеров кода", at: start },
      };
      saveSmartRule(rule);

      const hitTime = 2_000_000;
      vi.spyOn(Date, "now").mockReturnValue(hitTime);

      recordRuleHit("rule-hits");
      const rules = getSmartRules();
      expect(rules[0].hits).toBe(1);
      expect(rules[0].lastHitAt).toBe(hitTime);

      recordRuleHit("rule-hits");
      expect(getSmartRules()[0].hits).toBe(2);
    });

    it("deletes a rule completely", () => {
      const rule: SmartRule = {
        id: "rule-del",
        text: "удаляемое правило",
        weight: 1.0,
        scope: { kind: "global" },
        hits: 0,
        createdAt: Date.now(),
        lastHitAt: null,
        ttlDays: null,
        archived: false,
        origin: { source: "manual", quote: "удаляемое правило", at: Date.now() },
      };
      saveSmartRule(rule);
      expect(getSmartRules()).toHaveLength(1);

      deleteSmartRule("rule-del");
      expect(getSmartRules()).toHaveLength(0);
      expect(getSmartRules(true)).toHaveLength(0);
    });
  });

  describe("Conflict detection (R04)", () => {
    it("detects conflict between 'отвечай коротко' and 'давай подробно'", () => {
      const rule: SmartRule = {
        id: "rule-short",
        text: "отвечай коротко",
        weight: 1.0,
        scope: { kind: "global" },
        hits: 0,
        createdAt: Date.now(),
        lastHitAt: null,
        ttlDays: null,
        archived: false,
        origin: { source: "manual", quote: "отвечай коротко", at: Date.now() },
      };
      saveSmartRule(rule);

      const conflict = findConflictingRule("давай подробно");
      expect(conflict).not.toBeNull();
      expect(conflict?.id).toBe("rule-short");
    });

    it("detects conflict between code presence directives ('без кода' vs 'пиши код')", () => {
      const rule: SmartRule = {
        id: "rule-no-code",
        text: "без кода",
        weight: 1.0,
        scope: { kind: "global" },
        hits: 0,
        createdAt: Date.now(),
        lastHitAt: null,
        ttlDays: null,
        archived: false,
        origin: { source: "manual", quote: "без кода", at: Date.now() },
      };
      saveSmartRule(rule);

      const conflict = findConflictingRule("больше кода и примеров");
      expect(conflict).not.toBeNull();
      expect(conflict?.id).toBe("rule-no-code");
    });

    it("returns null when no conflict exists", () => {
      const rule: SmartRule = {
        id: "rule-lang",
        text: "отвечай на русском",
        weight: 1.0,
        scope: { kind: "global" },
        hits: 0,
        createdAt: Date.now(),
        lastHitAt: null,
        ttlDays: null,
        archived: false,
        origin: { source: "manual", quote: "отвечай на русском", at: Date.now() },
      };
      saveSmartRule(rule);

      expect(findConflictingRule("пиши примеры")).toBeNull();
    });

    it("ignores archived rules when checking conflicts", () => {
      const rule: SmartRule = {
        id: "rule-archived-conflict",
        text: "отвечай коротко",
        weight: 1.0,
        scope: { kind: "global" },
        hits: 0,
        createdAt: Date.now(),
        lastHitAt: null,
        ttlDays: null,
        archived: true,
        origin: { source: "manual", quote: "отвечай коротко", at: Date.now() },
      };
      saveSmartRule(rule);

      expect(findConflictingRule("давай подробно")).toBeNull();
    });
  });

  describe("Archive & maintenance (R05)", () => {
    it("archives a rule explicitly and hides it from getSmartRules() by default", () => {
      const rule: SmartRule = {
        id: "rule-arch",
        text: "устаревшее правило",
        weight: 1.0,
        scope: { kind: "global" },
        hits: 0,
        createdAt: Date.now(),
        lastHitAt: null,
        ttlDays: null,
        archived: false,
        origin: { source: "manual", quote: "устаревшее правило", at: Date.now() },
      };
      saveSmartRule(rule);
      expect(getSmartRules()).toHaveLength(1);

      archiveSmartRule("rule-arch");
      expect(getSmartRules()).toHaveLength(0);
      expect(getSmartRules(true)).toHaveLength(1);
      expect(getSmartRules(true)[0].archived).toBe(true);
    });

    it("archives dead rule with weight 0 and 30 days without hits during maintenance", () => {
      const now = 100_000_000;
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      const createdAgo = now - thirtyDaysMs - 1000;

      const deadRule: SmartRule = {
        id: "rule-dead",
        text: "мертвое правило",
        weight: 0,
        scope: { kind: "global" },
        hits: 0,
        createdAt: createdAgo,
        lastHitAt: null,
        ttlDays: null,
        archived: false,
        origin: { source: "manual", quote: "мертвое правило", at: createdAgo },
      };
      const activeRule: SmartRule = {
        id: "rule-alive",
        text: "живое правило",
        weight: 1.0,
        scope: { kind: "global" },
        hits: 0,
        createdAt: createdAgo,
        lastHitAt: null,
        ttlDays: null,
        archived: false,
        origin: { source: "manual", quote: "живое правило", at: createdAgo },
      };
      saveSmartRule(deadRule);
      saveSmartRule(activeRule);

      const archivedIds = runRuleMaintenance(now);
      expect(archivedIds).toEqual(["rule-dead"]);

      const activeRules = getSmartRules();
      expect(activeRules).toHaveLength(1);
      expect(activeRules[0].id).toBe("rule-alive");

      const allRules = getSmartRules(true);
      const dead = allRules.find((r) => r.id === "rule-dead");
      expect(dead?.archived).toBe(true);
    });

    it("archives rules exceeding ttlDays during maintenance", () => {
      const now = 50_000_000;
      const ttlDays = 7;
      const createdAgo = now - 8 * 24 * 60 * 60 * 1000;

      const expiredRule: SmartRule = {
        id: "rule-expired",
        text: "временное правило",
        weight: 1.0,
        scope: { kind: "global" },
        hits: 5,
        createdAt: createdAgo,
        lastHitAt: now - 1000,
        ttlDays,
        archived: false,
        origin: { source: "manual", quote: "временное правило", at: createdAgo },
      };
      saveSmartRule(expiredRule);

      const archivedIds = runRuleMaintenance(now);
      expect(archivedIds).toEqual(["rule-expired"]);
      expect(getSmartRules()).toHaveLength(0);
      expect(getSmartRules(true)[0].archived).toBe(true);
    });
  });

  describe("Migration (R06)", () => {
    it("migrates 5 legacy string rules into SmartRule objects with weight 1.0 intact", () => {
      const style = getUserStylePreferences();
      style.customRules = [
        "отвечай прямо без общих слов",
        "приводи примеры из практики",
        "не используй клише",
        "структурируй списком",
        "только суть",
      ];
      saveUserStylePreferences(style);

      const count = migrateLegacyRules();
      expect(count).toBe(5);

      const smartRules = getSmartRules();
      expect(smartRules).toHaveLength(5);
      for (const rule of smartRules) {
        expect(rule.weight).toBe(1.0);
        expect(rule.scope).toEqual({ kind: "global" });
        expect(rule.archived).toBe(false);
      }
      expect(smartRules.map((r) => r.text)).toEqual(style.customRules);

      // 5 strings intact in style
      expect(getUserStylePreferences().customRules).toEqual(style.customRules);

      // Second run is idempotent
      expect(migrateLegacyRules()).toBe(0);
    });
  });

  describe("user-facts prompt block & addUserRule wrapper", () => {
    it("buildSelfEvolutionPromptBlock reads SmartRule sorted top by weight and skips archived rules", () => {
      setSelfLearningEnabled(true);

      const ruleLow: SmartRule = {
        id: "r-low",
        text: "правило низкого веса",
        weight: 0.5,
        scope: { kind: "global" },
        hits: 0,
        createdAt: Date.now(),
        lastHitAt: null,
        ttlDays: null,
        archived: false,
        origin: { source: "manual", quote: "правило низкого веса", at: Date.now() },
      };
      const ruleHigh: SmartRule = {
        id: "r-high",
        text: "правило высокого веса",
        weight: 2.0,
        scope: { kind: "global" },
        hits: 0,
        createdAt: Date.now(),
        lastHitAt: null,
        ttlDays: null,
        archived: false,
        origin: { source: "manual", quote: "правило высокого веса", at: Date.now() },
      };
      const ruleArchived: SmartRule = {
        id: "r-arch",
        text: "архивное правило",
        weight: 3.0,
        scope: { kind: "global" },
        hits: 0,
        createdAt: Date.now(),
        lastHitAt: null,
        ttlDays: null,
        archived: true,
        origin: { source: "manual", quote: "архивное правило", at: Date.now() },
      };

      saveSmartRule(ruleLow);
      saveSmartRule(ruleHigh);
      saveSmartRule(ruleArchived);

      const promptBlock = buildSelfEvolutionPromptBlock();
      expect(promptBlock).toContain("правило высокого веса");
      expect(promptBlock).toContain("правило низкого веса");
      expect(promptBlock).not.toContain("архивное правило");

      // Verify order: high weight appears before low weight
      const highIdx = promptBlock.indexOf("правило высокого веса");
      const lowIdx = promptBlock.indexOf("правило низкого веса");
      expect(highIdx).toBeLessThan(lowIdx);

      // Verify read-only: hits not incremented
      expect(getSmartRules().find((r) => r.id === "r-high")?.hits).toBe(0);
    });

    it("addUserRule writes a SmartRule while keeping customRules and feedback log intact", () => {
      setSelfLearningEnabled(true);
      addUserRule("отвечай кратко и емко", { source: "coach" });

      const smartRules = getSmartRules();
      expect(smartRules).toHaveLength(1);
      expect(smartRules[0].text).toBe("отвечай кратко и емко");
      expect(smartRules[0].weight).toBe(1.0);
      expect(smartRules[0].origin.source).toBe("coach");

      // Legacy customRules kept
      expect(getUserStylePreferences().customRules).toContain("отвечай кратко и емко");
    });
  });

    it("zombie-kill: deleting a migrated or added rule keeps it deleted after buildSelfEvolutionPromptBlock rebuild", () => {
      setSelfLearningEnabled(true);
      const style = getUserStylePreferences();
      style.customRules = ["зомби правило из легаси", "второе правило"];
      saveUserStylePreferences(style);

      // Initial migration brings both rules in
      const initial = getSmartRules();
      expect(initial).toHaveLength(2);
      const zombie = initial.find((r) => r.text === "зомби правило из легаси")!;
      expect(zombie).toBeDefined();

      // Delete the rule
      deleteSmartRule(zombie.id);
      expect(getSmartRules().map((r) => r.text)).toEqual(["второе правило"]);
      expect(getUserStylePreferences().customRules).not.toContain(
        "зомби правило из легаси"
      );

      // Rebuild prompt block — must NOT resurrect deleted rule
      const promptBlock = buildSelfEvolutionPromptBlock();
      expect(promptBlock).toContain("второе правило");
      expect(promptBlock).not.toContain("зомби правило из легаси");
      expect(getSmartRules().map((r) => r.text)).toEqual(["второе правило"]);

      // Delete the remaining rule as well — prompt block must not fall back to stale customRules
      const second = getSmartRules()[0];
      deleteSmartRule(second.id);
      expect(getSmartRules()).toHaveLength(0);
      expect(buildSelfEvolutionPromptBlock()).not.toContain("второе правило");
    });
});
