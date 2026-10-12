# Interfaces — Smart learning + Settings UX

## F2 — модель правил (первый, контракт для всех)

```ts
// src/lib/storage/smart-rules.ts (новый)
export type RuleScope = { kind: "global" } | { kind: "profile"; profileId: string } | { kind: "topic"; topic: string };
export interface SmartRule {
  id: string; text: string; weight: number; scope: RuleScope;
  hits: number; createdAt: number; lastHitAt: number | null;
  ttlDays: number | null; archived: boolean;
  origin: { source: RuleSource; quote: string; at: number };
}
export function getSmartRules(includeArchived?: boolean): SmartRule[];
export function saveSmartRule(rule: SmartRule): void;
export function archiveSmartRule(id: string): void;
export function deleteSmartRule(id: string): void;
export function recordRuleHit(id: string): void;
export function findConflictingRule(text: string): SmartRule | null;
export function runRuleMaintenance(now?: number): string[]; // archived ids
export function migrateLegacyRules(): number; // строки → объекты
```

| Файл | Владелец |
|---|---|
| `src/lib/storage/smart-rules.ts` | F2 |
| `src/lib/storage/user-facts.ts` (промпт-блок читает SmartRule) | F2 |

## F1 — извлечение

```ts
// src/lib/rule-extract.ts (новый)
export function extractRuleCandidate(utterance: string): string; // эвристики, синхронно
export function refineRuleCandidate(candidate: string): Promise<string>; // LLM-фон
// SubtitleFeed: превью-компонент RulePreview {candidate, onSave, onEdit, onCancel}
```

| Файл | Владелец |
|---|---|
| `src/lib/rule-extract.ts` | F1 |
| `src/pages/app/components/speech/SubtitleFeed.tsx` (превью) | F1 |

## F3 — поведение и поповер

```ts
// src/lib/behavior-watch.ts (новый)
export type BehaviorSuggestion = { id: string; ruleText: string; reason: string; at: number };
export function observeShorten(): BehaviorSuggestion | null; // + другие observe-*
export function dismissSuggestion(id: string): void;
// Поповер Self-Evolution: источник/хиты/вес + deleteSmartRule
```

| Файл | Владелец |
|---|---|
| `src/lib/behavior-watch.ts` | F3 |
| Поповер Self-Evolution (тот же файл, другой участок) | F3 |

## F4 — редизайн настроек

```
src/pages/settings/components/profiles/
  ProfileCards.tsx      — список-карточки
  ProfileWizard.tsx     — мастер 3 шага
  ProfileEditor.tsx     — редактор + превью промпта
  RulesPanel.tsx        — правила с весом/причинами
  MemoryPanels.tsx      — факты/лог/USER.md/сброс (переезд)
```

Контекст API не меняется. Старый `PromptProfilesSettings.tsx` → тонкая сборка
или удаление после переезда (решает F4, тесты обновить).

| Файл | Владелец |
|---|---|
| `src/pages/settings/components/profiles/*` | F4 |
| `src/pages/settings/components/PromptProfilesSettings.tsx` | F4 |
