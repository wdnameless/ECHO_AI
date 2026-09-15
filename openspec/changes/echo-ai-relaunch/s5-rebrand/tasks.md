# Tasks: S5 — Ребрендинг в Echo AI

## T5.1 — Идентификаторы и версия
- [x] `src-tauri/tauri.conf.json`: `productName` → `Echo AI`; `version` → `1.0.0`; НЕ менять `identifier`
- [x] `package.json`: `version` → `1.0.0`, обновить `description`
- [x] `src-tauri/Cargo.toml`: `version` → `1.0.0`, обновить `description`
- [x] НЕ менять: `identifier`, `pluely.db`, `secure_storage.json`, updater endpoint/pubkey

## T5.2 — Заголовки и UI-строки
- [x] `src-tauri/tauri.conf.json:16` — заголовок главного окна → `Echo AI`
- [x] `src-tauri/src/window.rs` — заголовок окна дашборда (`Pluely - Dashboard` → `Echo AI - Dashboard`)
- [x] `src/components/Sidebar.tsx:26` — название продукта в сайдбаре
- [x] `src/layouts/ErrorLayout.tsx:29` — компактный заголовок
- [x] `src/components/Contribute.tsx:10` — «Pluely Fork» → «Echo AI»
- [x] `src/components/Promote.tsx:32-52` — тексты и ссылка промо
- [x] `src/config/shortcuts.ts:27` — описание шортката «Bring Pluely forward» → «Bring Echo AI forward»
- [x] `src/hooks/useChatCompletion.ts:722`, `src/hooks/useCompletion.ts:882` — текст про разрешение Screen Recording
- [x] `src/lib/functions/ai-response.function.ts:308,312` — префикс ошибки хостируемого API
- [x] `src/lib/functions/stt-fallback.ts:85,94` — префикс ошибки STT и текст про локальный сервер

## T5.3 — Rust: tray-меню
- [x] `src-tauri/src/tray.rs:8-11` — пункты меню («Показать / Скрыть Pluely» → «Показать / Скрыть Echo AI», «Выход из Pluely» → «Выход из Echo AI»)

## T5.4 — Платформенные дескрипторы
- [x] `src-tauri/pluely.desktop` — `Name`, `Comment`, `Keywords`; `Exec` и `Icon` НЕ менять (имя бинарника сохраняем)
- [x] `src-tauri/info.plist` — описания разрешений микрофона, экрана, системного звука
- [x] `README.md` — название продукта и описание
- [x] `release-resources/PROVENANCE.md` — происхождение сборки

## T5.5 — Иконки (плейсхолдер)
- [x] Создать SVG-знак «эхо» (звуковая волна / концентрические дуги)
- [x] Сгенерировать полный набор: `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.png`, `icon.ico`, `icon.icns`
- [x] Проверить, что размеры и форматы совпадают с исходными (`src-tauri/icons/`)

## T5.6 — Тесты
- [x] Обновить тесты, где «Pluely» используется как тестовые данные, если они проверяют пользовательские строки
- [x] НЕ менять тесты, где «Pluely» — произвольное содержимое фикстуры (например, словарь ASR), если они не привязаны к бренду
- [x] Проверить, что тесты версии (если есть) ожидают 1.0.0

## T5.7 — Верификация
- [x] `npm test` — зелёный
- [x] `cargo test --manifest-path src-tauri/Cargo.toml` — зелёный
- [x] `npm run build` — без ошибок типов
- [x] `npm run tauri build -- --no-bundle` — релизная сборка успешна
- [x] Смоук: окно показывает «Echo AI», версия 1.0.0, трей обновлён, иконка заменена
- [x] Критично: существующая БД открывается, история чатов и настройки сохранены
