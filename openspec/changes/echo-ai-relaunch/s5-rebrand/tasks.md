# Tasks: S5 — Ребрендинг в Echo AI

## T5.1 — Идентификаторы и версия
- [ ] `src-tauri/tauri.conf.json`: `productName` → `Echo AI`; `version` → `1.0.0`; НЕ менять `identifier`
- [ ] `package.json`: `version` → `1.0.0`, обновить `description`
- [ ] `src-tauri/Cargo.toml`: `version` → `1.0.0`, обновить `description`
- [ ] НЕ менять: `identifier`, `pluely.db`, `secure_storage.json`, updater endpoint/pubkey

## T5.2 — Заголовки и UI-строки
- [ ] `src-tauri/tauri.conf.json:16` — заголовок главного окна → `Echo AI`
- [ ] `src-tauri/src/window.rs` — заголовок окна дашборда (`Pluely - Dashboard` → `Echo AI - Dashboard`)
- [ ] `src/components/Sidebar.tsx:26` — название продукта в сайдбаре
- [ ] `src/layouts/ErrorLayout.tsx:29` — компактный заголовок
- [ ] `src/components/Contribute.tsx:10` — «Pluely Fork» → «Echo AI»
- [ ] `src/components/Promote.tsx:32-52` — тексты и ссылка промо
- [ ] `src/config/shortcuts.ts:27` — описание шортката «Bring Pluely forward» → «Bring Echo AI forward»
- [ ] `src/hooks/useChatCompletion.ts:722`, `src/hooks/useCompletion.ts:882` — текст про разрешение Screen Recording
- [ ] `src/lib/functions/ai-response.function.ts:308,312` — префикс ошибки хостируемого API
- [ ] `src/lib/functions/stt-fallback.ts:85,94` — префикс ошибки STT и текст про локальный сервер

## T5.3 — Rust: tray-меню
- [ ] `src-tauri/src/tray.rs:8-11` — пункты меню («Показать / Скрыть Pluely» → «Показать / Скрыть Echo AI», «Выход из Pluely» → «Выход из Echo AI»)

## T5.4 — Платформенные дескрипторы
- [ ] `src-tauri/pluely.desktop` — `Name`, `Comment`, `Keywords`; `Exec` и `Icon` НЕ менять (имя бинарника сохраняем)
- [ ] `src-tauri/info.plist` — описания разрешений микрофона, экрана, системного звука
- [ ] `README.md` — название продукта и описание
- [ ] `release-resources/PROVENANCE.md` — происхождение сборки

## T5.5 — Иконки (плейсхолдер)
- [ ] Создать SVG-знак «эхо» (звуковая волна / концентрические дуги)
- [ ] Сгенерировать полный набор: `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.png`, `icon.ico`, `icon.icns`
- [ ] Проверить, что размеры и форматы совпадают с исходными (`src-tauri/icons/`)

## T5.6 — Тесты
- [ ] Обновить тесты, где «Pluely» используется как тестовые данные, если они проверяют пользовательские строки
- [ ] НЕ менять тесты, где «Pluely» — произвольное содержимое фикстуры (например, словарь ASR), если они не привязаны к бренду
- [ ] Проверить, что тесты версии (если есть) ожидают 1.0.0

## T5.7 — Верификация
- [ ] `npm test` — зелёный
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` — зелёный
- [ ] `npm run build` — без ошибок типов
- [ ] `npm run tauri build -- --no-bundle` — релизная сборка успешна
- [ ] Смоук: окно показывает «Echo AI», версия 1.0.0, трей обновлён, иконка заменена
- [ ] Критично: существующая БД открывается, история чатов и настройки сохранены
