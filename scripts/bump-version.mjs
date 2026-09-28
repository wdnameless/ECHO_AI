#!/usr/bin/env node
// Single source of truth for the app version: src-tauri/tauri.conf.json.
// Usage: node scripts/bump-version.mjs 1.2.28
// Syncs package.json and src-tauri/Cargo.toml ([package] version only).
import { readFileSync, writeFileSync } from "node:fs";

const next = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(next ?? "")) {
  console.error("usage: node scripts/bump-version.mjs <X.Y.Z>");
  process.exit(1);
}

const TAURI_CONF = "src-tauri/tauri.conf.json";
const PACKAGE_JSON = "package.json";
const CARGO_TOML = "src-tauri/Cargo.toml";

// tauri.conf.json: exact key, preserves formatting (2-space indent).
{
  const raw = readFileSync(TAURI_CONF, "utf8");
  const json = JSON.parse(raw);
  json.version = next;
  writeFileSync(TAURI_CONF, JSON.stringify(json, null, 2) + "\n");
}

// package.json: exact key, preserves formatting.
{
  const raw = readFileSync(PACKAGE_JSON, "utf8");
  const json = JSON.parse(raw);
  json.version = next;
  writeFileSync(PACKAGE_JSON, JSON.stringify(json, null, 2) + "\n");
}

// Cargo.toml: only the [package] version (first occurrence at line start),
// never dependency versions like `tauri = { version = "2" }`.
// NOTE: match is tested separately — replacing 1.2.27 with 1.2.27 is a no-op
// that must still succeed, so `out === raw` cannot mean "not found".
{
  const raw = readFileSync(CARGO_TOML, "utf8");
  const re = /^version = "\d+\.\d+\.\d+"$/m;
  if (!re.test(raw)) {
    console.error("Cargo.toml: no [package] version line found, aborting");
    process.exit(1);
  }
  writeFileSync(CARGO_TOML, raw.replace(re, `version = "${next}"`));
}

console.log(`version -> ${next} (tauri.conf.json, package.json, Cargo.toml)`);
