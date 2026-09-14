# Tasks: S4 — Перенос секретов в защищённое хранилище ОС

## T4.1 — Rust: обобщённое хранилище секретов
- [ ] Расширить Rust-слой: команды сохранения/чтения/удаления секрета по произвольному ключу (не только whitelist лицензии)
- [ ] Хранение — защищённое хранилище ОС; при недоступности предоставить явный fallback с предупреждением
- [ ] Зарегистрировать команды в `src-tauri/src/lib.rs`

## T4.2 — Frontend: слой доступа к секретам
- [ ] Создать `src/lib/storage/secret-store.ts`: асинхронные `saveSecret(key, value)`, `getSecret(key)`, `removeSecret(key)`, `migrateSecretsFromLocalStorage()`
- [ ] Ключи секретов: `ai_provider:<providerId>:API_KEY`, `stt_provider:<providerId>:API_KEY`, `web_search:brave`, `web_search:exa`, `web_search:tavily`

## T4.3 — Разделение настроек и секретов
- [ ] `src/lib/storage/ai-providers.ts` — сохранять провайдера без `API_KEY`, ключ писать в защищённое хранилище
- [ ] `src/lib/storage/stt-providers.ts` — то же
- [ ] `src/lib/web-search.ts` — `braveApiKey`/`exaApiKey`/`tavilyApiKey` вынести из `web_search_settings` в защищённое хранилище; настройки без ключей оставить в localStorage
- [ ] `src/contexts/app.context.tsx` — при загрузке провайдеров подгружать ключи асинхронно

## T4.4 — Миграция существующих ключей
- [ ] При старте: найти в localStorage сохранённые `API_KEY` в провайдерах и поисковых настройках
- [ ] Перенести в защищённое хранилище, затем удалить из localStorage
- [ ] Миграция идемпотентна: повторный запуск ничего не ломает и не дублирует
- [ ] Пометить факт миграции, чтобы не сканировать localStorage каждый раз

## T4.5 — Асинхронное чтение при отправке
- [ ] `src/lib/functions/ai-response.function.ts` — получать ключ асинхронно перед подстановкой в curl-шаблон
- [ ] `src/lib/functions/stt.function.ts`, `custom-stt.function.ts`, `custom-provider.function.ts` — то же
- [ ] `src/lib/web-search.ts` — ключи получать асинхронно перед запросом
- [ ] Убедиться, что типы `TYPE_PROVIDER` и интерфейсы UI не требуют переписывания

## T4.6 — Логи
- [ ] Проверить, что секреты не попадают в `console.*` и в сообщения об ошибках
- [ ] `src-tauri/src/api.rs` — не логировать payload с ключом лицензии целиком

## T4.7 — Тесты
- [ ] Тест: сохранённый секрет возвращается и подставляется в запрос
- [ ] Тест миграции: ключ уходит из localStorage в защищённое хранилище
- [ ] Тест идемпотентности: повторная миграция не меняет состояние
- [ ] Тест изоляции: после миграции `API_KEY` отсутствует в localStorage

## T4.8 — Верификация
- [ ] `npm test` — зелёный
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` — зелёный
- [ ] `npm run build` — без ошибок типов
- [ ] Смоук: провайдер с ключом работает после обновления; ключ отсутствует в localStorage (проверка через DevTools)
