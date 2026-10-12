# Tasks: Perf+Accuracy wave

Порядок = ранг. Фронты из proposal.md; внутри фронта тикеты последовательны,
фронты F1/F2/F3/F6 независимы и идут первой волной, F4→F5 второй (делят хук).

## F1 — Поиск-параллель
- [x] T1 R01: `parallelSearchStream` вместо сериального race 1100мс (fixer) — f05634d

## F2 — Ассемблер
- [x] T2 R02: сузить `looksUnfinished` до союзов/продолженческой пунктуации (fixer) — fd85398
- [x] T9 R09: tail-diff против последнего сегмента вместо Jaccard всего текста (fixer) — fd85398

## F3 — Промпт
- [x] T3 R03: единый `Promise.all` + синхронный стиль из кэша (fixer) — b90a494
- [x] T13 R13: порог памяти 0.05 → 0.45 (fixer) — b90a494

## F4 — ASR-слоты
- [x] T4 R04: кэш base URL + тёплый WS (fixer) — 28e3dbe
- [x] T6 R06: закрытие по final + скип IDLE (fixer) — 28e3dbe

## F5 — Rust/VAD
- [x] T5 R05: батчи 125мс, safety 350мс, бинарный IPC (fixer) — 63aa049
- [x] T7 R07: пол шума только в тишине (fixer) — 63aa049
- [x] T10 R10: envelope-follower вместо waveshaping (fixer) — 63aa049

## F6 — Фильтры
- [x] T8 R08: сузить фиолетовый regex + русские YouTube-халлюцинации (fixer) — b9a70c6
- [x] T11 R11: стоп-слова раньше ratio в lang-detect (fixer) — b9a70c6
- [x] T12 R12: императивы дизайна в стартеры (fixer) — b9a70c6
- [x] T14 R14: стем+суффиксы в applyCorrections (fixer) — b9a70c6
