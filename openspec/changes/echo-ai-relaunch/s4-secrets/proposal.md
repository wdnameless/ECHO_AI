# Proposal: S4 — Перенос секретов в защищённое хранилище ОС

## Why
Аудит (2026-09-14) выявил, что все API-ключи пользователя лежат в открытом виде в localStorage:

1. `src/lib/storage/ai-providers.ts:23` — список кастомных провайдеров сериализуется целиком, включая `variables` с `API_KEY`.
2. `src/lib/storage/stt-providers.ts` — то же для STT-провайдеров.
3. `src/lib/web-search.ts:11-13,33` — `braveApiKey`, `exaApiKey`, `tavilyApiKey` хранятся как обычная настройка в `web_search_settings`.
4. `src/lib/storage/helper.ts:10-15` — тонкая обёртка над localStorage без шифрования.

`tauri-plugin-keychain` присутствует в `package.json` и `Cargo.toml`, права `keychain:allow-save-item`/`allow-get-item`/`allow-remove-item` выданы в обоих capability-файлах, но плагин **не вызывается ниоткуда** из `src/**`. Существующие Rust-команды `secure_storage_save/get/remove` имеют жёсткий whitelist (`license_key`, `instance_id`, `selected_pluely_model`) и не подходят для ключей провайдеров.

Следствие: в связке с незакрытой XSS-цепочкой (S1) любой инъецированный скрипт читает все ключи пользователя одним обращением к localStorage.

## What Changes
1. **Расширение бэкенд-хранилища**: Rust-слой получает обобщённый доступ к секретам по ключу, с хранением в защищённом хранилище ОС.
2. **Разделение «настройка / секрет»**: в localStorage остаются идентификаторы, имена провайдеров, модели; `API_KEY` и поисковые ключи переносятся в защищённое хранилище.
3. **Миграция без потери настроек**: при первом запуске после обновления существующие ключи обнаруживаются в localStorage, переносятся в защищённое хранилище и удаляются из localStorage.
4. **Асинхронный доступ**: чтение секрета для отправки запроса становится асинхронным; интерфейс и типы провайдеров сохраняются, чтобы не переписывать UI.

## Capabilities & Impact
- **Capabilities affected**: `secret-storage`, `provider-configuration`.
- **Rust**: `src-tauri/src/activate.rs` или новый модуль секретов; `src-tauri/src/api.rs` (чтение ключа для хостируемого API).
- **Frontend**: `src/lib/storage/ai-providers.ts`, `src/lib/storage/stt-providers.ts`, `src/lib/storage/secret-store.ts` (новый), `src/lib/web-search.ts`, `src/lib/functions/ai-response.function.ts`, `src/lib/functions/stt.function.ts`, `src/contexts/app.context.tsx`.
- **Риски регрессии**: синхронные чтения секретов в момент отправки запроса должны стать асинхронными; миграция обязана быть идемпотентной; провайдеры на localhost могут не использовать ключ вовсе.
- **Не затрагивается**: CSP, SQL, лицензии, брендинг.

## Verification
- Юнит-тест миграции: ключ из localStorage попадает в защищённое хранилище и удаляется из localStorage; повторный запуск не ломает настройки.
- Тест чтения: сохранённый ключ возвращается и корректно подставляется в запрос.
- Тест изоляции: после миграции `API_KEY` отсутствует в localStorage.
- Смоук: провайдер с ключом работает после обновления; ключ не виден в localStorage.
