import { describe, it, expect } from "vitest";
import { extractDocxText } from "../docx";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("T4.2 DOCX extraction (R13: extractDocxText)", () => {
  it("extracts text from a valid .docx file locally", async () => {
    const fixturePath = resolve(
      process.cwd(),
      "node_modules/mammoth/test/test-data/single-paragraph.docx"
    );
    const buffer = readFileSync(fixturePath);
    const file = new File([buffer], "resume.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    const text = await extractDocxText(file);
    expect(text).toContain("Walking on imported air");
  });

  it("handles empty or multi-element docx files gracefully", async () => {
    const fixturePath = resolve(
      process.cwd(),
      "node_modules/mammoth/test/test-data/empty.docx"
    );
    const buffer = readFileSync(fixturePath);
    const file = new File([buffer], "empty.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    const text = await extractDocxText(file);
    expect(typeof text).toBe("string");
  });
});
