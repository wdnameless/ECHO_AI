# Oracle: blind acceptance — filler-style-coaching (double, flash-class model)

Model: nullform-gateway/gemini-3.8-flash-high (flash → two independent passes required).

## Pass 1: ACCEPT
- Suite 97/795, renderer/KaTeX в живом DOM без сырого `$$`, дефолт фильтра OFF + рабочие тумблеры, речевые маркеры с капом в промпте, coach-правило в редакторе/журнале/промпте, perf-notes с узкими местами.
- Все R01–R07i PROVEN на running artifact.

## Pass 2: ACCEPT (независимый)
- 9 файлов/109 тестов зоны + полный 97/795 + tsc чисто.
- Живой UI: KaTeX `.katex` без `$$`; тумблер фильтра OFF→ON→OFF пишет localStorage; маркеры юзера («короче говоря», «по факту»…) в блоке с капом 3; coach-правило в UI и в `3. КАСТОМНЫЕ ПРАВИЛА`; perf-notes + маскировка филлером в `useAIStreaming.ts:162-164`.

## Reconciliation
Оба прохода независимы, оба ACCEPT, противоречий нет.

ACCEPT
