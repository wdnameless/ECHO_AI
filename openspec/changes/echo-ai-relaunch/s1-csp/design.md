# Design: S1 — Закрытие XSS-цепочки

## Контекст: факты из инвентаря

Полный инвентарь сетевой и исполняемой активности WebView (источник: рекогносцировка 2026-09-14):

| Что | Откуда | Требование CSP |
|---|---|---|
| `window.fetch` → `http://127.0.0.1:8765/health` | `src/hooks/useHandyStatus.ts:40` | `connect-src http://127.0.0.1:*` |
| `window.fetch` → `http://127.0.0.1:8765/v1/audio/transcriptions` | `src/lib/functions/stt-fallback.ts:68` | `connect-src http://127.0.0.1:*` |
| WebSocket → `ws://127.0.0.1:8765/v1/asr/stream` | `src/hooks/useMicWsStreaming.ts:98`, `src/workers/asr.worker.ts:101` | `connect-src ws://127.0.0.1:*` |
| `<img src="data:...">` | `src/pages/app/components/completion/Files.tsx:102`, `src/pages/chats/components/ChatFiles.tsx:115`, `src/pages/app/components/speech/index.tsx:316` | `img-src 'self' data:` |
| ONNX WASM | `src/hooks/useMicCapture.tsx:11-20`, файлы в `public/ort-wasm*.wasm` | `script-src 'wasm-unsafe-eval'` |
| AudioWorklet | `node_modules/@ricky0123/vad-web`, `/vad.worklet.bundle.min.js` | `script-src 'self'`, `worker-src 'self'` |
| Worker из Blob | `src/lib/timer-worker.ts:16` | `worker-src blob:` |
| Шрифты KaTeX (`url(fonts/KaTeX_*)`) | `node_modules/katex/dist/katex.min.css` | `font-src 'self' data:` |
| Inline `style={{}}` | `src/pages/chats/components/ChatInput.tsx:431`, `src/components/ui/tooltip.tsx:128`, KaTeX-разметка | `style-src 'unsafe-inline'` |
| Все внешние AI/STT-запросы | через Rust-мост `tauriFetch` (`@tauri-apps/plugin-http`) | CSP не применяется (запрос вне WebView) |

**Ключевой вывод:** внешние AI/STT-запросы идут через Rust-плагин, а не через WebView, поэтому `connect-src` можно ограничить localhost'ом, не ломая провайдеров.

## Решение 1: точный набор CSP-директив

```
default-src 'self';
script-src 'self' 'wasm-unsafe-eval';
style-src 'self' 'unsafe-inline';
img-src 'self' data:;
font-src 'self' data:;
connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:* http://localhost:* ws://localhost:*;
worker-src 'self' blob:;
object-src 'none';
frame-src 'none';
base-uri 'self';
form-action 'none'
```

Обоснование каждой директивы — в таблице выше. `object-src 'none'` и `frame-src 'none'` закрывают `object`/`embed`/`iframe` на уровне браузера — второй слой поверх санитайзера.

**Отвергнутая альтернатива:** `script-src 'self' 'unsafe-inline'`. Открывает инлайн-скрипты, то есть ровно тот вектор, который закрываем. Строгий `script-src` без nonce возможен, потому что Vite-сборка эмитит скрипты как внешние файлы, а инлайн-скриптов в `index.html` нет.

## Решение 2: отказ от rehype-raw через проп Streamdown

Streamdown (`node_modules/streamdown/dist/chunk-OGVTOU66.js:30498`) принимает `rehypePlugins` как проп с дефолтом `Vo = Object.values(Jo)`, где:

```js
Jo = {
  raw: qo,                                    // rehype-raw
  katex: [we, {errorColor: "..."}],           // rehype-katex
  harden: [harden, {allowedProtocols: ["*"]}] // ослабленный санитайзер
}
```

Передаём собственный массив: `[katex, ourSanitizer]` — без `raw`, с нашим санитайзером вместо `harden`. `remarkPlugins` не трогаем (gfm, math, cjk не связаны с безопасностью).

**Почему не патчим node_modules:** проп — публичный API; патч библиотеки потеряется при `npm ci` и сломает сборку CI.

## Решение 3: санитайзерный плагин

Собственный rehype-плагин вместо `rehype-harden`:

- **Запрещённые теги** (удаляются целиком вместе с потомками): `script`, `iframe`, `object`, `embed`, `form`, `input`, `textarea`, `button`, `link`, `meta`, `base`.
- **Все атрибуты, начинающиеся с `on`** — удаляются (единственное надёжное правило против `onerror`/`onload`/`onclick`).
- **`style`-атрибут** — удаляется (CSS-инъекция через `expression()`/`url()`).
- **`href`/`src`** — пропускаются только схемы `http`, `https`, `mailto`, `blob`, `data:image/*`; `javascript:`, `vbscript:`, `file:` блокируются.
- **Разрешённые теги** — явный allowlist: markdown-набор (`p`, `em`, `strong`, `code`, `pre`, `blockquote`, `ul`, `ol`, `li`, `h1`–`h6`, `table`, `thead`, `tbody`, `tr`, `th`, `td`, `a`, `img`, `hr`, `br`, `del`, `sup`, `sub`, `span`, `div`) + то, что эмитят KaTeX и shiki.
- **KaTeX и shiki**: их разметка идёт через `components`-проп Streamdown и рендерится React-элементами, а не через raw HTML, поэтому allowlist должен покрывать только markdown-набор. Mermaid — код-блок с языком `mermaid`, обрабатывается до HAST.

## Решение 4: экранирование сниппетов веб-поиска

`src/lib/functions/parallel-search.ts:60-63` формирует текст вида `[N] title (url):\n snippet`. Сниппет приходит из внешнего API. Перед вставкой в контекст промпта HTML-спецсимволы заменяются на сущности, чтобы модель не могла получить из поиска управляющую разметку. Это защита от prompt-injection через поиск, а не от XSS (XSS закрыт на рендере), поэтому она дешёвая и не влияет на читаемость результатов для модели.

## Тестирование

1. **Юнит-тест санитайзера** (новый `src/lib/__tests__/sanitize-schema.test.ts`): прогон пайплайна с инъекциями, проверка отсутствия запрещённых тегов и `on*`-атрибутов, проверка сохранности markdown-структуры.
2. **Регрессионный тест рендеринга**: mermaid-блок, `$$`-формула, GFM-таблица, код-блок с языком — на выходе пайплайна присутствуют ожидаемые узлы.
3. **Смоук в приложении**: запуск релизной сборки, проверка консоли WebView на CSP-нарушения при старте, диктовке и стриминге ответа.
