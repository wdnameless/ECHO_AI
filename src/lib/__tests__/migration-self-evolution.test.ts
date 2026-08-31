import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const currentDir =
  typeof __dirname !== "undefined"
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));

describe("Database Migration 4 Byte-Exact and LF Invariant", () => {
  it("should preserve LF-only line endings and exact historical content", () => {
    const migrationPath = path.resolve(
      currentDir,
      "../../../src-tauri/src/db/migrations/self-evolution.sql"
    );

    const fileBuffer = fs.readFileSync(migrationPath);
    const content = fileBuffer.toString("utf-8");

    // Must not contain CRLF / \r
    expect(fileBuffer.includes(0x0d)).toBe(false);
    expect(content.includes("\r")).toBe(false);

    // Exact expected content with LF line endings
    const expectedSql = `-- Migration 4: Self-Evolution persistence (survives WebView storage clears)

CREATE TABLE IF NOT EXISTS se_style (\n    id INTEGER PRIMARY KEY CHECK (id = 1),\n    tone TEXT NOT NULL,\n    preferred_length TEXT NOT NULL DEFAULT 'concise',\n    favorite_patterns TEXT NOT NULL DEFAULT '[]',\n    avoid_patterns TEXT NOT NULL DEFAULT '[]',\n    custom_rules TEXT NOT NULL DEFAULT '[]',\n    updated_at INTEGER NOT NULL\n);

CREATE TABLE IF NOT EXISTS se_feedback_log (\n    id TEXT PRIMARY KEY,\n    question TEXT NOT NULL,\n    response TEXT NOT NULL,\n    rating TEXT NOT NULL CHECK (rating IN ('like', 'dislike')),\n    reason TEXT,\n    topic TEXT,\n    timestamp INTEGER NOT NULL\n);

CREATE INDEX IF NOT EXISTS idx_se_feedback_ts ON se_feedback_log (timestamp DESC);

INSERT OR IGNORE INTO se_style (id, tone, preferred_length, updated_at)\nVALUES (1, 'живой, естественный', 'concise', strftime('%s','now') * 1000);`;

    expect(content).toBe(expectedSql);
  });
});
