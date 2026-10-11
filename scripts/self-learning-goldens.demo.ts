/**
 * Demo runner for self-learning goldens.
 * Usage: npx tsx scripts/self-learning-goldens.demo.ts
 */
import { GOLDEN_TEST_CASES } from "./self-learning-goldens.data";
import {
  addUserFact,
  buildSelfEvolutionPromptBlock,
  recordFeedback,
  resetLearning,
  setSelfLearningEnabled,
} from "../src/lib/storage/user-facts";

// Polyfill window.localStorage: safeLocalStorage gates on `typeof window`,
// so a bare globalThis.localStorage is invisible to it (same trick as test_evolution.ts).
if (typeof globalThis.window === "undefined") {
  const store = new Map<string, string>();
  // SAFETY: in-memory Storage stand-in for Node CLI; implements get/set/remove/clear used by safeLocalStorage only.
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, String(v)),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    length: 0,
  } as unknown as Storage;
  (globalThis as { window?: unknown; localStorage?: unknown }).window = { localStorage: storage };
  globalThis.localStorage = storage;
}

async function runDemo() {
  console.log("=================================================");
  console.log("   PLUELY SELF-LEARNING GOLDENS DEMO RUNNER      ");
  console.log("=================================================\n");

  let passed = 0;

  for (const tc of GOLDEN_TEST_CASES) {
    globalThis.localStorage.clear();
    setSelfLearningEnabled(true);
    await resetLearning();

    console.log(`▶ [${tc.id}] ${tc.name}`);
    console.log(`  Описание: ${tc.description}`);
    console.log(`  Вопрос 1: "${tc.question1}"`);

    const beforeBlock = buildSelfEvolutionPromptBlock();
    console.log(`  До адаптации: [${beforeBlock ? beforeBlock.slice(0, 80) + "..." : "Блок пуст (нет истории)"}]`);

    if (tc.feedback) {
      console.log(`  Сигнал: ${tc.feedback.rating.toUpperCase()} (${tc.feedback.reason})`);
      recordFeedback(tc.question1, tc.answer1, tc.feedback.rating, tc.feedback.reason);
    }
    if (tc.manualFact) {
      console.log(`  Сигнал: Ручной факт: "${tc.manualFact.fact}"`);
      addUserFact(tc.manualFact.fact, tc.manualFact.category);
    }

    const afterBlock = buildSelfEvolutionPromptBlock();
    console.log(`  Вопрос 2: "${tc.question2}"`);

    const missingExpected = tc.expectedInPromptBlock.filter(
      (exp) => !afterBlock.includes(exp)
    );
    const leakedForbidden = (tc.forbiddenInPromptBlock ?? []).filter(
      (forb) => afterBlock.includes(forb)
    );

    const ok = missingExpected.length === 0 && leakedForbidden.length === 0;
    if (ok) {
      console.log(`  Результат: ✅ PASS (признаки адаптации присутствуют в промпт-блоке)`);
      passed++;
    } else {
      console.log(`  Результат: ❌ FAIL`);
      if (missingExpected.length > 0) {
        console.log(`    Не найдены маркеры:`, missingExpected);
      }
      if (leakedForbidden.length > 0) {
        console.log(`    Обнаружены запрещённые маркеры:`, leakedForbidden);
      }
    }
    console.log("");
  }

  console.log("-------------------------------------------------");
  console.log(`Итог: ${passed}/${GOLDEN_TEST_CASES.length} эталонов успешно пройдены.`);
  console.log("-------------------------------------------------\n");

  if (passed !== GOLDEN_TEST_CASES.length) {
    process.exit(1);
  }
}

void runDemo();
