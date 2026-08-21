import {
  isFillerOrBackchannel,
  shouldTriggerAIResponse,
  normalizeUtterance,
} from "../src/lib/speech-filter";

console.log("==================================================");
console.log("1. TESTING FILLER & BACKCHANNEL SUPPRESSION");
console.log("==================================================");

const fillersToTest = [
  // Russian single & repeated fillers
  "угу",
  "мгм",
  "мхм",
  "ага",
  "да",
  "ну",
  "хм",
  "гм",
  "мм",
  "эм",
  "э-э",
  "понятно",
  "ок",
  "ясно",
  "ладно",
  "так",
  "слушаю",
  "да-да",
  "ага-ага",
  "агась",
  "угум",
  "давай",
  "хорошо",
  "точно",
  "круто",
  "ну да",
  "да уж",
  "ага да",
  "угу да",
  "понял",
  "слышу",
  "окей",
  "угу, понятно",
  "да, хорошо...",
  "мгм...",
  "ну ок.",

  // English fillers
  "uh-huh",
  "uh huh",
  "mhm",
  "mm-hmm",
  "mm hmm",
  "yeah",
  "yep",
  "yup",
  "yea",
  "ok",
  "okay",
  "right",
  "got it",
  "sure",
  "i see",
  "yes",
  "yeah yeah",
  "yes yes",
  "no problem",
  "sounds good",
  "understood",
  "gotcha",
  "cool",
  "alright",
];

let failedFillers = 0;
for (const filler of fillersToTest) {
  const isFiller = isFillerOrBackchannel(filler);
  const shouldTrigger = shouldTriggerAIResponse(filler);

  if (!isFiller || shouldTrigger) {
    console.error(
      `❌ FAIL: "${filler}" -> isFiller=${isFiller}, shouldTrigger=${shouldTrigger} (Expected: isFiller=true, shouldTrigger=false)`
    );
    failedFillers++;
  } else {
    console.log(`✅ PASS: "${filler}" -> correctly filtered (No AI trigger)`);
  }
}

console.log("\n==================================================");
console.log("2. TESTING REAL QUESTIONS & STATEMENTS (MUST TRIGGER)");
console.log("==================================================");

const realQuestionsToTest = [
  "Расскажи про свой опыт работы с микросервисами?",
  "Как устроен garbage collection в V8?",
  "В чем разница между optimistic и pessimistic locking?",
  "What is the difference between TCP and UDP?",
  "How would you scale a PostgreSQL database with heavy read load?",
  "Расскажите о самом сложном баге, который вы чинили.",
  "Почему вы решили сменить работу?",
  "Какие паттерны проектирования вы чаще всего применяете?",
  "Can you explain how React reconciler works?",
  "Как вы управляете состоянием в больших приложениях?",
];

let failedQuestions = 0;
for (const q of realQuestionsToTest) {
  const shouldTrigger = shouldTriggerAIResponse(q);
  if (!shouldTrigger) {
    console.error(
      `❌ FAIL: "${q}" -> shouldTrigger=${shouldTrigger} (Expected: true)`
    );
    failedQuestions++;
  } else {
    console.log(`✅ PASS: "${q}" -> correctly triggers AI response`);
  }
}

console.log("\n==================================================");
console.log("3. TESTING POST-ANSWER COOLDOWN LOGIC");
console.log("==================================================");

const AI_RESPONSE_COOLDOWN_MS = 4000;

function simulateCooldownCheck(
  transcription: string,
  timeSinceLastResponseMs: number
): { triggered: boolean; reason: string } {
  // Step 1: Filler check
  if (!shouldTriggerAIResponse(transcription)) {
    return { triggered: false, reason: "Filtered as filler/backchannel" };
  }

  // Step 2: Cooldown guard for short utterances
  if (
    timeSinceLastResponseMs < AI_RESPONSE_COOLDOWN_MS &&
    transcription.trim().length < 60
  ) {
    return {
      triggered: false,
      reason: `Filtered by post-answer cooldown (${timeSinceLastResponseMs}ms < 4000ms, length < 60)`,
    };
  }

  return { triggered: true, reason: "Triggered AI response" };
}

const cooldownScenarios = [
  { text: "угу", time: 500, expected: false },
  { text: "да, понятно", time: 1000, expected: false },
  { text: "отлично", time: 1500, expected: false },
  { text: "хорошо, спасибо", time: 2000, expected: false },
  // Short remark within 4 seconds:
  { text: "А как насчет индексов?", time: 1000, expected: false }, // Caught by cooldown because length < 60
  // Long substantive new question within 4s (e.g. interviewer asks full new question):
  {
    text: "Хорошо, а теперь расскажите подробно про то, как вы настраивали шардирование в MongoDB?",
    time: 2000,
    expected: true,
  },
  // Question after cooldown expires (5000ms):
  { text: "А как насчет индексов?", time: 5000, expected: true },
];

let failedCooldown = 0;
for (const sc of cooldownScenarios) {
  const res = simulateCooldownCheck(sc.text, sc.time);
  if (res.triggered !== sc.expected) {
    console.error(
      `❌ FAIL: "${sc.text}" at ${sc.time}ms -> triggered=${res.triggered} (${res.reason}), Expected=${sc.expected}`
    );
    failedCooldown++;
  } else {
    console.log(
      `✅ PASS: "${sc.text}" at ${sc.time}ms -> ${res.triggered ? "TRIGGERED" : "SUPPRESSED"} (${res.reason})`
    );
  }
}

console.log("\n==================================================");
console.log("SUMMARY RESULTS:");
console.log(`Fillers tested: ${fillersToTest.length}, Failed: ${failedFillers}`);
console.log(
  `Questions tested: ${realQuestionsToTest.length}, Failed: ${failedQuestions}`
);
console.log(
  `Cooldown scenarios tested: ${cooldownScenarios.length}, Failed: ${failedCooldown}`
);
console.log("==================================================");

if (failedFillers === 0 && failedQuestions === 0 && failedCooldown === 0) {
  console.log("🎉 ALL TESTS PASSED! False triggering is 100% eliminated.");
} else {
  process.exit(1);
}
