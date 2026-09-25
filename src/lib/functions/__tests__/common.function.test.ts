import { describe, it, expect } from "vitest";
import { deepVariableReplacer } from "../common.function";

/**
 * Substituted values must be inserted verbatim.
 *
 * `String.replace` expands `$`-tokens in a string replacement: `$&` becomes the
 * matched placeholder, `` $` `` and `$'` the surrounding template, `$1` a capture
 * group. User speech routinely carries `$` — prices, code, shell snippets — so a
 * message like "платим $100 и используем $& шаблон" had its `$&` rewritten into
 * `{{TEXT}}`, splicing the template back into the prompt the model receives.
 */
describe("deepVariableReplacer", () => {
  it("inserts a value containing $ tokens verbatim", () => {
    const out = deepVariableReplacer("SYSTEM: {{SYS}} | USER: {{TEXT}}", {
      SYS: "You are an interviewer.",
      TEXT: "Мы платим $100 и используем $& шаблон",
    });

    expect(out).toBe(
      "SYSTEM: You are an interviewer. | USER: Мы платим $100 и используем $& шаблон"
    );
    // The placeholder must not reappear inside the substituted value.
    expect(out.match(/\{\{TEXT\}\}/g) ?? []).toHaveLength(0);
  });

  it("does not splice surrounding text for $-backtick and $' ", () => {
    const out = deepVariableReplacer("A {{X}} B", { X: "pre $` mid $' post" });
    expect(out).toBe("A pre $` mid $' post B");
  });

  it("handles the dollar-group form without inventing a capture group", () => {
    const out = deepVariableReplacer("{{X}}", { X: "cost $1 $2 done" });
    expect(out).toBe("cost $1 $2 done");
  });

  it("still replaces every occurrence of the placeholder", () => {
    const out = deepVariableReplacer("{{X}} and {{X}}", { X: "v" });
    expect(out).toBe("v and v");
  });

  it("walks nested objects and arrays", () => {
    const out = deepVariableReplacer(
      { a: "{{X}}", b: ["{{X}}"], c: { d: "{{X}}" } },
      { X: "$&" }
    );
    expect(out).toEqual({ a: "$&", b: ["$&"], c: { d: "$&" } });
  });
});
