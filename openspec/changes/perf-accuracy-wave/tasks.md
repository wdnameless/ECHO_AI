# Tasks: Perf+Accuracy wave

Порядок = ранг. Фронты из proposal.md; внутри фронта тикеты последовательны,
фронты F1/F2/F3/F6 независимы и идут первой волной, F4→F5 второй (делят хук).

## F1 — Поиск-параллель
- [ ] T1 R01: `parallelSearchStream` вместо сериального race 1100мс (fixer)

## F2 — Ассемблер
- [ ] T2 R02: сузить `looksUnfinished` до союзов/продолженческой пунктуации (fixer)
- [ ] T9 R09: tail-diff против последнего сегмента вместо Jaccard всего текста (fixer)

## F3 — Промпт
- [ ] T3 R03: единый `Promise.all` + синхронный стиль из кэша (fixer)
- [ ] T13 R13: порог памяти 0.05 → 0.45 (fixer)

## F4 — ASR-слоты
- [ ] T4 R04: кэш base URL + тёплый WS (fixer)
- [ ] T6 R06: закрытие по final + скип IDLE (fixer)

## F5 — Rust/VAD
- [x] T5 R05: батчи 125мс, safety 350мс, бинарный IPC (fixer)
- [x] T7 R07: пол шума только в тишине (fixer)
- [x] T10 R10: envelope-follower вместо waveshaping (fixer)

## F6 — Фильтры
- [ ] T8 R08: сузить фиолетовый regex + русские YouTube-халлюцинации (fixer)
- [ ] T11 R11: стоп-слова раньше ratio в lang-detect (fixer)
- [ ] T12 R12: императивы дизайна в стартеры (fixer)
- [ ] T14 R14: стем+суффиксы в applyCorrections (fixer)
