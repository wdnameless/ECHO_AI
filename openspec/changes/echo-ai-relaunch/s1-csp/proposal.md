# Proposal: S1 — Закрытие XSS-цепочки в WebView

## Why
Аудит безопасности (2026-09-14) подтвердил эмпирически, что ответы AI-моделей и результаты веб-поиска рендерятся в WebView без действенной санитизации:

1. `src-tauri/tauri.conf.json:33-35` — `"csp": null`: единственный слой, ограничивающий исполнение скриптов, отключён.
2. `src/components/Markdown/index.tsx:14` — ответы модели идут через Streamdown, который по умолчанию применяет `rehype-raw` (`node_modules/streamdown/dist/chunk-OGVTOU66.js:29235`), то есть HTML из ответа интерпретируется.
3. Санитайзер `rehype-harden` внутри Streamdown обрабатывает **только теги `<a>` и `<img>`** и вызывается с `allowedProtocols: ["*"]`. Проверено запуском реального пайплайна: теги `script`, `iframe`, `svg`, а также атрибуты `onerror`/`onload`/`onclick` проходят насквозь и становятся **живыми обработчиками** в DOM (подтверждено через jsdom).
4. `src/lib/functions/parallel-search.ts:62` вставляет внешние сниппеты веб-поиска в контекст промпта дословно — то есть вектор инъекции доступен из внешнего источника, а не только от модели.
5. `@tauri-apps/api/core.js:190` — `__TAURI_INTERNALS__.invoke` доступен странице всегда (независимо от `withGlobalTauri`).

Итог цепочки: инъекция в ответ модели или в сниппет поиска → исполнение произвольного JS в WebView → вызов любых Tauri-команд, включая чтение `secure_storage.json` (ключ лицензии) и SQL-доступ к истории чатов и резюме.

## What Changes
1. **CSP** (`tauri.conf.json`): включается строгая политика вместо `null`. Директивы выведены из фактического инвентаря сетевых и исполняемых ресурсов (см. design.md):
   - `script-src` — только `'self'` + `'wasm-unsafe-eval'` (ONNX Runtime WASM), без `unsafe-inline`/`unsafe-eval`;
   - `connect-src` — только `'self'` + localhost-порты сайдкаров;
   - `worker-src 'self' blob:` — `src/lib/timer-worker.ts:16` создаёт Worker через `URL.createObjectURL`;
   - `img-src 'self' data:` — превью вложений и скриншотов идут как data-URL;
   - `style-src`, `font-src` — под Tailwind arbitrary values, inline `style={{}}` и шрифты KaTeX.
2. **Отказ от raw HTML** (`src/components/Markdown/index.tsx`): явно передаётся проп `rehypePlugins`, исключающий `rehype-raw`. Streamdown принимает этот проп (`chunk-OGVTOU66.js:30498`), поэтому переопределение возможно без форка библиотеки.
3. **Санитайзер как второй слой**: вместо `harden` с `allowedProtocols: ["*"]` используется локальный плагин с явным allowlist тегов и полным удалением `on*`-атрибутов, `script`, `iframe`, `object`, `embed`, `style`-атрибутов.
4. **Веб-поиск**: внешние сниппеты экранируются перед вставкой в контекст промпта.

## Capabilities & Impact
- **Capabilities affected**: `webview-security`, `rendering-pipeline`.
- **Frontend**: `src/components/Markdown/index.tsx`, новый `src/lib/sanitize-schema.ts`, `src/lib/functions/parallel-search.ts`.
- **Config**: `src-tauri/tauri.conf.json` (`app.security.csp`).
- **Риски регрессии**: mermaid (код-блоки), KaTeX (remark-math), shiki, таблицы GFM, вложенные изображения, Worker таймера, WASM-загрузка ONNX.
- **Не затрагивается**: SQL-доступ фронтенда, логика лицензий, ребрендинг.

## Verification
- Юнит-тест санитайзера: инъекции (`<script>`, `<img onerror>`, `<svg onload>`, `<iframe>`, `javascript:`-ссылка) не дают живых обработчиков и запрещённых тегов в результирующем HAST.
- Смоук-тест рендеринга: ответ с mermaid-блоком, формулой KaTeX, таблицей и код-блоком отображается корректно.
- Проверка в живом приложении: CSP не блокирует работу приложения (лог консоли WebView без CSP-нарушений при старте, диктовке и стриминге ответа).
