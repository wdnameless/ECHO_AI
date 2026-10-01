# Oracle: приёмка stall-manual-resolve (P5)

## Verdict: ACCEPT (независимый oracle, слепо по manifest + дереву)

1. R01: сентинел вместо строки-ошибки (`:792-796`), дальше unbounded
   `reader.read()` без второго таймаута и `cancel`. 4 теста stall.
2. R02: `stallWait/stallRetry/stallNext` (`useAIStreaming:396-443`),
   проброс `ResultsSection:104-106` → `SubtitleFeed:1481-1515`.
   12 тестов хука, 8 тестов баннера.
3. R03: `stallNext` one-off без смены глобального выбора (`:428-439`);
   ссылка `onOpenProviders` → `CustomEvent("open-providers")`
   (`SubtitleFeed:1517-1528`, `index:610-613`).
4. R04: тишина без авто-сдачи (`:761-771,793`); аборт закрывает
   (`reader.cancel`, тест `:200-234`).
5. Слепой oracle нашёл реальную утечку: второй потребитель
   (`useCompletionCommon`, чат/текст) сентинел не фильтровал —
   починено (`continue` до накопления; `STALL_SENTINEL` в импорте).
6. `tsc` чист; полный сьют **563/563** (75 файлов).

GAPS: none. Остаточный риск: зависший стрим держит соединение, пока
пользователь не решит (цена ручного контроля, спиннер честен).
