# Tasks: S1 — Закрытие XSS-цепочки в WebView

## T1.1 — Санитайзерный плагин
- [ ] Создать `src/lib/sanitize-schema.ts` с rehype-плагином: allowlist тегов, удаление `on*`-атрибутов, `style`-атрибута и опасных схем в `href`/`src`
- [ ] Запрещённые теги (`script`, `iframe`, `object`, `embed`, `form`, `input`, `textarea`, `button`, `link`, `meta`, `base`) удаляются вместе с потомками
- [ ] Схемы `http`/`https`/`mailto`/`blob`/`data:image/*` разрешены; `javascript:`/`vbscript:`/`file:` блокируются

## T1.2 — Подключение в Markdown
- [ ] `src/components/Markdown/index.tsx`: передать проп `rehypePlugins` = `[[rehypeKatex, {...}], sanitizeSchema]`, исключив `rehype-raw` и ослабленный `harden`
- [ ] `remarkPlugins` не менять (gfm, math, cjk не влияют на безопасность)
- [ ] Убедиться, что mermaid-блок остаётся код-блоком и рендерится как прежде

## T1.3 — CSP
- [ ] `src-tauri/tauri.conf.json`: заменить `"csp": null` на строгую политику из design.md
- [ ] Проверить, что `index.html` не содержит инлайн-скриптов (иначе потребуется nonce)

## T1.4 — Веб-поиск
- [ ] `src/lib/functions/parallel-search.ts`: экранировать HTML-спецсимволы в `title`, `url`, `snippet` перед вставкой в контекст промпта

## T1.5 — Тесты
- [ ] Юнит-тест `src/lib/__tests__/sanitize-schema.test.ts`:
  - `<script>alert(1)</script>` — тег отсутствует в выходе
  - `<img src=x onerror=alert(1)>` — атрибут `onerror` отсутствует
  - `<svg onload=alert(1)>` — атрибут `onload` отсутствует
  - `<iframe src=...>` — тег отсутствует
  - `<a href="javascript:alert(1)">` — ссылка заблокирована
  - `<p style="...">` — атрибут `style` отсутствует
- [ ] Регрессионный тест: mermaid-блок, `$$`-формула, GFM-таблица, код-блок сохраняются в выходе

## T1.6 — Верификация
- [ ] `npm test` — все тесты зелёные
- [ ] `npm run build` — сборка без ошибок типов
- [ ] Релизная сборка запущена; консоль WebView без CSP-нарушений при старте, диктовке и стриминге ответа
- [ ] Визуально: ответ с mermaid-диаграммой, формулой и таблицей отображается корректно
