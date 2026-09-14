# Proposal: S5 — Ребрендинг в Echo AI

## Why
Пользователь просит переименовать продукт в **Echo AI** и выпустить как **1.0.0**. Выбран режим «Визуал + имя приложения»: меняются пользовательские строки и иконки, внутренние идентификаторы остаются.

Сохранить идентификаторы критично по двум причинам:
1. **Данные пользователя.** `src-tauri/src/lib.rs:40-48` разрешает путь БД от `identifier` (`com.srikanthnani.pluely`); `src-tauri/src/activate.rs:22-32` — путь `secure_storage.json` от `app_data_dir()`, который тоже завязан на identifier. Смена identifier осиротит существующую БД со всей историей чатов, резюме и словарём ASR.
2. **Канал обновлений.** `src-tauri/tauri.conf.json:64-72` содержит endpoint и pubkey апдейтера. Смена endpoint без публикации под новым ключом лишит обновлений уже установленные копии.

## What Changes
1. **Отображаемое имя**: `productName` → `Echo AI`; заголовки окон; лого и название в сайдбаре (`src/components/Sidebar.tsx:26`), компактный заголовок (`src/layouts/ErrorLayout.tsx:29`); tray-меню (`src-tauri/src/tray.rs`); `pluely.desktop` (Linux); описания разрешений в `info.plist` (macOS); метаданные установщика.
2. **Версия 1.0.0**: синхронно в `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`.
3. **Иконки**: сгенерированный плейсхолдер-знак (звуковая волна/эхо) → полный набор `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.png`, `icon.ico`, `icon.icns`.
4. **Тексты интерфейса**: `src/components/Contribute.tsx:10` («Pluely Fork»), `src/components/Promote.tsx:32-52` («Promote Pluely», ссылка `Pluely.com/promote`), `src/config/shortcuts.ts:27` (описание шортката), сообщения о разрешениях в `useChatCompletion.ts:722` и `useCompletion.ts:882`, префиксы сообщений об ошибках хостируемого API (`Pluely API Error`, `Pluely STT Error`).
5. **README и `PROVENANCE.md`**: описание продукта и происхождение сборки.
6. **Что НЕ меняется**: `identifier`, `pluely.db`, `secure_storage.json`, `STORAGE_KEYS.PLUELY_API_ENABLED`, имя бинарника, updater-endpoint/pubkey, имена файлов sidecar и ассетов релиза.

## Capabilities & Impact
- **Capabilities affected**: `branding`, `release-packaging`.
- **Config**: `src-tauri/tauri.conf.json`, `package.json`, `src-tauri/Cargo.toml`.
- **Frontend**: `src/components/Sidebar.tsx`, `src/components/Contribute.tsx`, `src/components/Promote.tsx`, `src/layouts/ErrorLayout.tsx`, `src/config/shortcuts.ts`, `src/hooks/useChatCompletion.ts`, `src/hooks/useCompletion.ts`, `src/lib/functions/ai-response.function.ts`, `src/lib/functions/stt-fallback.ts`.
- **Rust/платформа**: `src-tauri/src/tray.rs`, `src-tauri/pluely.desktop`, `src-tauri/info.plist`, `src-tauri/icons/*`.
- **Риски регрессии**: переименование строки версии в манифесте апдейтера при смене формата; замена иконок должна сохранять размеры и форматы; путь БД обязан остаться прежним.
- **Не затрагивается**: CSP, HTTP-права, логика лицензий, хранение секретов, SQL.

## Verification
- Смоук: приложение запускается, заголовок окна и сайдбар показывают «Echo AI», версия — 1.0.0.
- Проверка сохранности данных: существующая БД открывается, история чатов и настройки на месте.
- Проверка апдейтера: манифест формируется с версией 1.0.0, pubkey не изменён.
- Проверка иконок: приложение, трей и установщик отображают новый знак.
