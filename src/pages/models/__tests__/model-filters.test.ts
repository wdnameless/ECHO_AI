import { describe, it, expect } from "vitest";
import { compareModels, matchesFilters, selectDownloadedModels } from "../index";
import type { ModelEntry, InstalledModel } from "@/lib/storage/app-paths";

/**
 * The models page renders two lists — the catalogue and what the user has
 * downloaded — and used to share nothing between them. The downloaded list had
 * no sort at all, while the speed/accuracy buttons sit in *its* header, so
 * pressing a button reordered only the list below the fold and the toolbar read
 * as broken for exactly the models a user already has. That copy of the filter
 * had also dropped the language test for uncatalogued files.
 *
 * These pin the two behaviours to one implementation.
 */
const model = (over: Partial<ModelEntry>): ModelEntry =>
  ({
    id: "m",
    name: "Model",
    description: "",
    languages: ["ru"],
    files: [{ filename: "f.gguf", quant: "Q8_0", size_bytes: 100, sha256: "0" }],
    accuracy_score: 5,
    speed_score: 5,
    ...over,
  }) as ModelEntry;

describe("models page sorting", () => {
  const slowAccurate = model({ id: "a", name: "Alpha", speed_score: 3, accuracy_score: 9 });
  const fastRough = model({ id: "b", name: "Beta", speed_score: 9, accuracy_score: 3 });

  it("orders by speed and honours the direction", () => {
    const desc = [slowAccurate, fastRough].sort((a, b) => compareModels(a, b, "speed", "desc"));
    expect(desc.map((m) => m.id)).toEqual(["b", "a"]);
    const asc = [slowAccurate, fastRough].sort((a, b) => compareModels(a, b, "speed", "asc"));
    expect(asc.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("orders by accuracy independently of speed", () => {
    const byAcc = [fastRough, slowAccurate].sort((a, b) => compareModels(a, b, "accuracy", "desc"));
    expect(byAcc.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("orders by size and by name", () => {
    const small = model({ id: "s", name: "Zed", files: [{ filename: "s.gguf", quant: "Q8_0", size_bytes: 10, sha256: "0" }] });
    const big = model({ id: "l", name: "Abe", files: [{ filename: "l.gguf", quant: "Q8_0", size_bytes: 900, sha256: "0" }] });
    expect([big, small].sort((a, b) => compareModels(a, b, "size", "desc")).map((m) => m.id))
      .toEqual(["l", "s"]);
    expect([big, small].sort((a, b) => compareModels(a, b, "name", "asc")).map((m) => m.id))
      .toEqual(["l", "s"]);
  });

  it("treats a missing score as zero instead of producing NaN", () => {
    const scored = model({ id: "x", speed_score: undefined });
    const other = model({ id: "y", speed_score: 1 });
    // A NaN comparator makes Array.prototype.sort order arbitrary.
    const out = [scored, other].sort((a, b) => compareModels(a, b, "speed", "desc"));
    expect(out.map((m) => m.id)).toEqual(["y", "x"]);
  });
});

describe("models page filtering", () => {
  it("matches the search box against name and description", () => {
    const m = model({ name: "Nemotron Streaming", description: "Russian speech" });
    expect(matchesFilters(m, "nemotron", "all")).toBe(true);
    expect(matchesFilters(m, "russian", "all")).toBe(true);
    expect(matchesFilters(m, "parakeet", "all")).toBe(false);
  });

  it("matches the language filter across code formats", () => {
    // The dropdown emits the short code; catalogue entries may use either form.
    const short = model({ languages: ["ru"] });
    const long = model({ languages: ["ru-RU"] });
    expect(matchesFilters(short, "", "ru")).toBe(true);
    expect(matchesFilters(long, "", "ru")).toBe(true);
    expect(matchesFilters(model({ languages: ["en"] }), "", "ru")).toBe(false);
  });

  it("lets the language filter through as 'all'", () => {
    expect(matchesFilters(model({ languages: [] }), "", "all")).toBe(true);
  });
});

/**
 * The wiring, not just the comparator.
 *
 * A test of `compareModels` alone passed even when the downloaded list ignored
 * its result entirely — which is exactly the bug users hit: the buttons changed
 * nothing. These exercise the same function the component calls.
 */
describe("downloaded list pipeline", () => {
  const installed = (file_name: string, model_id: string | null): InstalledModel => ({
    file_name,
    path: `/models/${file_name}`,
    size_bytes: 1,
    model_id,
    quant: "Q8_0",
  });

  const slow = model({ id: "slow", name: "Slow", speed_score: 2, accuracy_score: 9 });
  const fast = model({ id: "fast", name: "Fast", speed_score: 9, accuracy_score: 2 });
  const catalog = [slow, fast];

  const files = [installed("slow.gguf", "slow"), installed("fast.gguf", "fast")];
  const base = { searchQuery: "", selectedLanguage: "all", sortDirection: "desc" as const };

  it("orders the downloaded list by speed — the button is in its header", () => {
    const out = selectDownloadedModels(files, catalog, { ...base, sortBy: "speed" });
    expect(out.map((f) => f.model_id)).toEqual(["fast", "slow"]);
  });

  it("orders the downloaded list by accuracy", () => {
    const out = selectDownloadedModels(files, catalog, { ...base, sortBy: "accuracy" });
    expect(out.map((f) => f.model_id)).toEqual(["slow", "fast"]);
  });

  it("reverses direction", () => {
    const out = selectDownloadedModels(files, catalog, {
      ...base,
      sortBy: "speed",
      sortDirection: "asc",
    });
    expect(out.map((f) => f.model_id)).toEqual(["slow", "fast"]);
  });

  it("applies search and language to the downloaded list too", () => {
    expect(
      selectDownloadedModels(files, catalog, { ...base, sortBy: "speed", searchQuery: "fast" })
    ).toHaveLength(1);
    expect(
      selectDownloadedModels(
        [installed("parakeet-en-0.6b.gguf", null)],
        catalog,
        { ...base, sortBy: "speed", selectedLanguage: "ru" }
      )
    ).toHaveLength(0);
    expect(
      selectDownloadedModels(
        [installed("parakeet-ru-0.6b.gguf", null)],
        catalog,
        { ...base, sortBy: "speed", selectedLanguage: "ru" }
      )
    ).toHaveLength(1);
  });

  it("does not false-match a language code inside another word", () => {
    const cases: Array<[string, number]> = [
      // `en` appears inside "nemotron" but is not a language token -> excluded.
      ["nemotron-0.6b-Q8_0.gguf", 0],
      // `it` appears inside "quantized" -> excluded.
      ["quantized-model.gguf", 0],
      // a real language token -> included.
      ["parakeet-en-0.6b.gguf", 1],
    ];
    for (const [name, expected] of cases) {
      const out = selectDownloadedModels([installed(name, null)], catalog, {
        ...base,
        sortBy: "speed",
        selectedLanguage: "en",
      });
      expect(out, `${name} filtered by "en"`).toHaveLength(expected);
    }
  });
});
