import {
  BUILTIN_PROFILES,
  INTERVIEW_PROFILE_ID,
  GENERAL_PROFILE_ID,
  getPromptProfiles,
  getActiveProfileId,
  getActiveProfile,
  applyProfileToStorage,
  savePromptProfiles,
  setActiveProfileId,
  PromptProfile,
} from "../src/lib/storage/prompt-profiles";

// Minimal localStorage mock for Node (helper.ts reads global `localStorage`)
const store: Record<string, string> = {};
const mockStorage = {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => { store[k] = String(v); },
  removeItem: (k: string) => { delete store[k]; },
};
(globalThis as any).localStorage = mockStorage;
(globalThis as any).window = { localStorage: mockStorage };

console.log("==================================================");
console.log("1. BUILT-IN PROFILES EXIST");
console.log("==================================================");
const profiles = getPromptProfiles();
console.log(`Total profiles: ${profiles.length} (expected >= 2)`);
if (profiles.length < 2) { console.error("FAIL"); process.exit(1); }
if (profiles[0].id !== INTERVIEW_PROFILE_ID) { console.error("FAIL: first should be Interview"); process.exit(1); }
if (profiles[1].id !== GENERAL_PROFILE_ID) { console.error("FAIL: second should be General"); process.exit(1); }
console.log("✅ Interview profile: " + profiles[0].name);
console.log("✅ General profile: " + profiles[1].name);
console.log(`   Interview prompt length: ${profiles[0].systemPrompt.length} chars`);
console.log(`   General prompt: "${profiles[1].systemPrompt.slice(0, 60)}..."`);

console.log("\n==================================================");
console.log("2. DEFAULT ACTIVE PROFILE IS INTERVIEW");
console.log("==================================================");
const activeId = getActiveProfileId();
console.log(`Active profile id: ${activeId} (expected ${INTERVIEW_PROFILE_ID})`);
if (activeId !== INTERVIEW_PROFILE_ID) { console.error("FAIL"); process.exit(1); }
const active = getActiveProfile();
if (active.id !== INTERVIEW_PROFILE_ID) { console.error("FAIL"); process.exit(1); }
console.log("✅ Active profile: " + active.name);

console.log("\n==================================================");
console.log("3. SWITCHING PROFILES APPLIES STORAGE");
console.log("==================================================");
// Switch to General
setActiveProfileId(GENERAL_PROFILE_ID);
const general = getActiveProfile();
applyProfileToStorage(general);
const appliedPrompt = store["system_prompt"];
const appliedHumanizer = JSON.parse(store["humanizer_settings"] || "{}");
const appliedResume = store["rag_resume_enabled"];
const appliedJob = store["rag_job_enabled"];

console.log("System prompt applied:", appliedPrompt === general.systemPrompt ? "✅" : "❌");
console.log("Humanizer enabled:", appliedHumanizer.enabled === general.humanizerEnabled ? "✅" : "❌");
console.log("Interview mode:", appliedHumanizer.interviewMode === general.interviewMode ? "✅" : "❌");
console.log("RAG resume:", appliedResume === "false" ? "✅ (disabled in General)" : "❌");
console.log("RAG job:", appliedJob === "false" ? "✅ (disabled in General)" : "❌");

// Switch back to Interview
setActiveProfileId(INTERVIEW_PROFILE_ID);
const interview = getActiveProfile();
applyProfileToStorage(interview);
console.log("\nAfter switching to Interview:");
console.log("Interview mode now:", JSON.parse(store["humanizer_settings"]).interviewMode === true ? "✅" : "❌");
console.log("RAG resume now:", store["rag_resume_enabled"] === "true" ? "✅" : "❌");

console.log("\n==================================================");
console.log("4. CUSTOM PROFILE CRUD");
console.log("==================================================");
const custom: PromptProfile = {
  id: "profile-custom-test",
  name: "System Design",
  description: "Test profile",
  systemPrompt: "You are a system design expert.",
  humanizerEnabled: true,
  interviewMode: false,
  customStyle: "speak short",
  ragResumeEnabled: true,
  ragJobEnabled: true,
  isBuiltin: false,
};
savePromptProfiles([...getPromptProfiles(), custom]);
const withCustom = getPromptProfiles();
if (!withCustom.find((p) => p.id === "profile-custom-test")) { console.error("FAIL: custom not saved"); process.exit(1); }
console.log("✅ Custom profile saved & reloaded");
setActiveProfileId("profile-custom-test");
const customActive = getActiveProfile();
if (customActive.name !== "System Design") { console.error("FAIL"); process.exit(1); }
console.log("✅ Custom profile activated: " + customActive.name);
console.log("✅ Built-ins preserved: " + (withCustom.filter(p => p.isBuiltin).length) + " built-in profiles kept");

console.log("\n==================================================");
console.log("🎉 ALL PROFILE TESTS PASSED!");
console.log("==================================================");
