import { test } from "node:test";
import assert from "node:assert/strict";
import { detectLanguage } from "./language-detect.ts";

test("чистая кириллица → russian", () => {
  assert.equal(detectLanguage("Расскажите о вашем опыте работы с React"), "russian");
  assert.equal(detectLanguage("Привет"), "russian");
});

test("кириллица с ё/Ё → russian", () => {
  assert.equal(detectLanguage("Всё ещё работает"), "russian");
  assert.equal(detectLanguage("Ёлка и ёжик"), "russian");
});

test("чистая латиница → english", () => {
  assert.equal(detectLanguage("Tell me about your experience with React"), "english");
  assert.equal(detectLanguage("Hello"), "english");
});

test("смешанный текст с преобладанием кириллицы (ratio > 0.3) → russian", () => {
  assert.equal(detectLanguage("Привет, world! 123"), "russian");
  assert.equal(detectLanguage("Hello, мир!"), "russian");
});

test("смешанный текст с преобладанием латиницы (ratio <= 0.3) → english", () => {
  assert.equal(detectLanguage("This is a test, мир"), "english");
  assert.equal(detectLanguage("React и TypeScript — это tools"), "english");
});

test("граничный случай: ratio ровно 0.3 → english (строгое >)", () => {
  assert.equal(detectLanguage("абв abcdefg"), "english");
});

test("пустая строка → null", () => {
  assert.equal(detectLanguage(""), null);
});

test("строка только из пробелов → null", () => {
  assert.equal(detectLanguage("   "), null);
});

test("строка без букв (цифры и символы) → null", () => {
  assert.equal(detectLanguage("12345"), null);
  assert.equal(detectLanguage("!!! ??? ---"), null);
});

test("цифры и пунктуация отбрасываются при подсчёте", () => {
  assert.equal(detectLanguage("Расскажите, пожалуйста, о себе! 123"), "russian");
  assert.equal(detectLanguage("What is your experience? (5 years)"), "english");
});
