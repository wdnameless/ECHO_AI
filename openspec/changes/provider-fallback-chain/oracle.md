# Oracle: приёмка provider-fallback-chain (P4)

## Verdict: ACCEPT (независимый oracle, слепо по manifest + дереву)

1. R01: throw И failure-чанки (`isFailureChunk`, ai-response.function.ts:999)
   ведут дальше; аборт — тихий return (:1012). Тест fallback:74.
2. R02: выбранный первым (:934), остальные дедупом (:941, `seenIds`).
   Тест fallback:188.
3. R03: yield `(переключаю на …)` (:1046); break до yield (:999);
   частичный успех блокирует фолбэк (:1030) — склейки нет.
4. R04: throw `Все провайдеры недоступны (пробовали: …): <last>` (:1051).
   Тест fallback:229.
5. Проводка: useAIStreaming:165, useCompletionCommon:646,
   useChatCompletion:138, useCompletion:173.
6. `tsc` чист; полный сьют **556/556** (74 файла, +6 fallback-тестов);
   пара fallback+retry-trust: 7/7 зелёных.

GAPS: none. Остаточный риск: упавший после N чанков провайдер уже сжёг
токены, новый начинает заново (цена надёжности); trust-gate спрашивает
на каждый новый хост отдельно — правильно, но на собесе это диалог.
