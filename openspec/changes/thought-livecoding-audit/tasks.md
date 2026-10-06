## 1. Thought-trace slice
- [ ] 1.1 Answer-mode store (localStorage, по образцу answer-length-override) + тумблеры в тулбаре speech/index.tsx
- [ ] 1.2 Thought-блок в buildEnhancedSystemPrompt; bypass humanizer-капа/длин для thought-режима
- [ ] 1.3 Рендер обоснования в SubtitleFeed в той же ленте; регрессии R01

## 2. Livecoding slice
- [ ] 2.1 Persistent livecode-toggle; auto-ask маршрутизирует в triggerCodeAnswer
- [ ] 2.2 LLM-генерация plan-fallback вместо статичной заглушки; парсер терпит незакрытые бэктики при стриминге
- [ ] 2.3 Диктовочная рамка кода; регрессии R02

## 3. Audit slice
- [ ] 3.1 Полный отчёт: 8 блокеров + 8 багов с file:line, ранжирование, что блокирует R01/R02
- [ ] 3.2 Фикс апстрим-багов, мешающих режимам (история наоборот, филлер в истории, stale-ref abort)

## 4. Integrate
- [ ] 4.1 Слияние слайсов, полный прогон, Stage B упрощение
- [ ] 4.2 Двойная слепая приёмка по манифесту R01/R02/R04
