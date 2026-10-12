# Tasks: Perf+Accuracy wave

Порядок = ранг. Фронты из proposal.md; внутри фронта тикеты последовательны,
фронты F1/F2/F3/F6 независимы и идут первой волной, F4→F5 второй (делят хук).

## F1 — Поиск-параллель
- [ ] T1 P01: `parallelSearchStream` вместо сериального race 1100мс (fixer)

## F2 — Ассемблер
- [ ] T2 P02: сузить `looksUnfinished` до союзов/продолженческой пунктуации (fixer)
- [ ] T9 P09: tail-diff против последнего сегмента вместо Jaccard всего текста (fixer)

## F3 — Промпт
- [ ] T3 P03: единый `Promise.all` + синхронный стиль из кэша (fixer)
- [ ] T13 P13: порог памяти 0.05 → 0.45 (fixer)

## F4 — ASR-слоты
- [ ] T4 P04: кэш base URL + тёплый WS (fixer)
- [ ] T6 P06: закрытие по final + скип IDLE (fixer)

## F5 — Rust/VAD
- [ ] T5 P05: батчи 125мс, safety 350мс, бинарный IPC (fixer)
- [ ] T7 P07: пол шума только в тишине (fixer)
- [ ] T10 P10: envelope-follower вместо waveshaping (fixer)

## F6 — Фильтры
- [ ] T8 P08: сузить фиолетовый regex + русские YouTube-халлюцинации (fixer)
- [ ] T11 P11: стоп-слова раньше ratio в lang-detect (fixer)
- [ ] T12 P12: императивы дизайна в стартеры (fixer)
- [ ] T14 P14: стем+суффиксы в applyCorrections (fixer)
