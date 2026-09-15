# Tasks: S4 — Перенос секретов в защищённое хранилище ОС

## T4.1 — Rust: обобщённое хранилище секретов
- [x] Расширить Rust-слой: команды сохранения/чтения/удаления секрета по произвольному ключу (не только whitelist лицензии)
- [x] Хранение — защищённое хранилище ОС; при недоступности предоставить явный fallback с предупреждением
- [x] Зарегистрировать команды в `src-tauri/src/lib.rs`

## T4.2 — Frontend: слой доступа к секретам
- [x] Создать `src/lib/storage/secret-store.ts`: асинхронные `saveSecret(key, value)`, `getSecret(key)`, `removeSecret(key)`, `migrateSecretsFromLocalStorage()`
- [x] Ключи секретов: `ai_provider:<providerId>:API_KEY`, `stt_provider:<providerId>:API_KEY`, `web_search:brave`, `web_search:exa`, `web_search:tavily`

## T4.3 — Разделение настроек и секретов
- [x] `src/lib/storage/ai-providers.ts` — сохранять провайдера без `API_KEY`, ключ писать в защищённое хранилище
- [x] `src/lib/storage/stt-providers.ts` — то же
- [x] `src/lib/web-search.ts` — `braveApiKey`/`exaApiKey`/`tavilyApiKey` вынести из `web_search_settings` в защищённое хранилище; настройки без ключей оставить в localStorage
- [x] `src/contexts/app.context.tsx` — при загрузке провайдеров подгружать ключи асинхронно

## T4.4 — Миграция существующих ключей
- [x] При старте: найти в localStorage сохранённые `API_KEY` в провайдерах и поисковых настройках
- [x] Перенести в защищённое хранилище, затем удалить из localStorage
- [x] Миграция идемпотентна: повторный запуск ничего не ломает и не дублирует
- [x] Пометить факт миграции, чтобы не сканировать localStorage каждый раз

## T4.5 — Асинхронное чтение при отправке
- [x] `src/lib/functions/ai-response.function.ts` — получать ключ асинхронно перед подстановкой в curl-шаблон
- [x] `src/lib/functions/stt.function.ts`, `custom-stt.function.ts`, `custom-provider.function.ts` — то же
- [x] `src/lib/web-search.ts` — ключи получать асинхронно перед запросом
- [x] Убедиться, что типы `TYPE_PROVIDER` и интерфейсы UI не требуют переписывания

## T4.6 — Логи
- [x] Проверить, что секреты не попадают в `console.*` и в сообщения об ошибках
- [x] `src-tauri/src/api.rs` — не логировать payload с ключом лицензии целиком

## T4.7 — Тесты
- [x] Тест: сохранённый секрет возвращается и подставляется в запрос
- [x] Тест миграции: ключ уходит из localStorage в защищённое хранилище
- [x] Тест идемпотентности: повторная миграция не меняет состояние
- [x] Тест изоляции: после миграции `API_KEY` отсутствует в localStorage

## T4.8 — Верификация
- [x] `npm test` — зелёный
- [x] `cargo test --manifest-path src-tauri/Cargo.toml` — зелёный
- [x] `npm run build` — без ошибок типов
- [x] Смоук: провайдер с ключом работает после обновления; ключ отсутствует в localStorage (проверка через DevTools)
