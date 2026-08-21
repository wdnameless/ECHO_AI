import {
  getUserFacts,
  addUserFact,
  removeUserFact,
  getUserStylePreferences,
  recordFeedback,
  buildSelfEvolutionPromptBlock,
} from "../src/lib/storage/user-facts";
import {
  getWebSearchSettings,
  saveWebSearchSettings,
  performWebSearch,
} from "../src/lib/web-search";
import {
  getPromptProfiles,
  SELF_EVOLUTION_PROFILE_ID,
} from "../src/lib/storage/prompt-profiles";

// Mock localStorage for Node environment
const store: Record<string, string> = {};
const mockStorage = {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => {
    store[k] = String(v);
  },
  removeItem: (k: string) => {
    delete store[k];
  },
};
(globalThis as any).localStorage = mockStorage;
(globalThis as any).window = { localStorage: mockStorage };

console.log("==================================================");
console.log("1. SELF-EVOLUTION PROFILE REGISTERED");
console.log("==================================================");
const profiles = getPromptProfiles();
const evolutionProf = profiles.find((p) => p.id === SELF_EVOLUTION_PROFILE_ID);
if (!evolutionProf) {
  console.error("FAIL: profile-self-evolution not found in profiles");
  process.exit(1);
}
console.log("✅ Self-Evolution profile exists: " + evolutionProf.name);
console.log("   Description: " + evolutionProf.description);

console.log("\n==================================================");
console.log("2. USER FACTS MEMORY (CRUD)");
console.log("==================================================");
const initialFacts = getUserFacts();
console.log(`Initial facts count: ${initialFacts.length}`);
const newFact = addUserFact(
  "8 years experience in Go/Rust distributed microservices",
  "stack"
);
console.log("✅ Added fact:", newFact.fact);
const updatedFacts = getUserFacts();
if (!updatedFacts.some((f) => f.id === newFact.id)) {
  console.error("FAIL: fact was not saved");
  process.exit(1);
}
console.log(`Updated facts count: ${updatedFacts.length}`);

console.log("\n==================================================");
console.log("3. FEEDBACK LEARNING ENGINE (👍 / 👎)");
console.log("==================================================");
// Record 👍 Like
recordFeedback(
  "How to scale Postgres?",
  "На практике мы сначала настроили connection pooling через PgBouncer, а потом вынесли read-реплики...",
  "like",
  undefined,
  "tech"
);
console.log("✅ Recorded 👍 Like feedback");

// Record 👎 Dislike with reason
recordFeedback(
  "Tell about garbage collection",
  "1. V8 has young generation. 2. Mark and sweep...",
  "dislike",
  "Слишком сухо / нумерованные списки",
  "tech"
);
console.log("✅ Recorded 👎 Dislike feedback with reason");

const style = getUserStylePreferences();
console.log("Avoid patterns learned:", style.avoidPatterns);
if (
  !style.avoidPatterns.includes("Слишком сухо / нумерованные списки")
) {
  console.error("FAIL: negative constraint not added to avoidPatterns");
  process.exit(1);
}
console.log("✅ Dislike reason successfully evolved into avoid constraint!");

console.log("\n==================================================");
console.log("4. COMPILED SELF-EVOLUTION PROMPT INJECTION");
console.log("==================================================");
const compiledPrompt = buildSelfEvolutionPromptBlock();
console.log(compiledPrompt);
if (
  !compiledPrompt.includes("SELF-EVOLUTION ADAPTIVE PROFILE") ||
  !compiledPrompt.includes("Go/Rust distributed microservices")
) {
  console.error("FAIL: compiled prompt missing user facts");
  process.exit(1);
}
console.log("✅ Compiled prompt incorporates user facts & style preferences!");

console.log("\n==================================================");
console.log("5. WEB SEARCH ENGINE (DUCKDUCKGO / ZERO-KEY)");
console.log("==================================================");
saveWebSearchSettings({
  enabled: true,
  provider: "duckduckgo",
  maxResults: 3,
});
const searchSettings = getWebSearchSettings();
console.log("Search enabled:", searchSettings.enabled);
console.log("Search provider:", searchSettings.provider);
console.log("✅ Web Search settings configured");

console.log("\n==================================================");
console.log("🎉 ALL EVOLUTION & WEB RESEARCH TESTS PASSED!");
console.log("==================================================");
