# Interfaces — fix-audit-2026-09-25

Владелец: оркестратор. Слайсы пишут только свои файлы (один владелец на файл).
Ниже — границы, которые слайсы обязаны соблюсти, чтобы не столкнуться.

## S1 — `src/lib/database/*` (владелец: S1)

Только чтение/запись в своих файлах. Не трогает `src/hooks/**`.

- `updateConversation(conversation: ChatConversation): Promise<ChatConversation>`
  — инвариант: после успешного вызова в таблице `messages` ровно `keptIds.length`
  строк с этим `conversation_id` и ни одной лишней. Существующий порядок
  (messages oldest-first при записи) сохраняется.
- `getAllConversations(): Promise<ChatConversation[]>`
  — инвариант: не более `MESSAGES_PER_QUERY` (100) параметров в одном запросе;
  при большем числе чатов сообщения догружаются порциями.
- `migrateLocalStorageToSQLite` — источник удаляется только при `errorCount === 0`,
  флаг завершения ставится только тогда же.
- `useConversationStore.buildHistory` и `loadConversation` (файл S5 по владению):
  S1 НЕ трогает `src/hooks/**`; R06 делает S5, S1 только гарантирует порядок
  сообщений из БД (oldest-first).

## S2 — `src-tauri/src/speaker/*` (владелец: S2)

- `SpeakerStream` (trait `Stream`): `poll_next` возвращает `Pending` при отсутствии
  данных; **никогда** не завершает поток из-за таймаута тишины.
- Таймаут `wait_for_event` → `continue` + инкремент счётчика; фатальным считается
  только разрыв устройства (`read_from_device_to_deque` / init).
- `is_capturing` в `AudioState` выставляется в `false`, если поток завершился.
- Буфер сэмплов: мьютекс берётся на батч/чанк, не на каждый `f32`.

## S3 — Rust backend lifecycle (владелец: S3)

- `handy_server::stop_server()` остаётся **синхронным** (вызывается из sync-команд),
  но не блокирует главный поток дольше ~150 мс: ожидание выносится в
  `spawn_blocking`, вызывающие sync-команды (`shortcuts::exit_app`, `tray "quit"`)
  получают неблокирующий путь.
- Watchdog: порог `N` подряд проверок без порта при живом pid → `kill()` + респавн.
- `vocab.rs` открывает ту же БД, что `tauri-plugin-sql` (`app_data_dir`).
- `settings.rs`: portable-режим включается только при явном флаге/наличии маркера;
  записываемость каталога — не достаточное условие.
- `activate.rs`: не-Windows — шифрование доступным системным средством (или явная
  честная деградация с предупреждением), legacy plaintext перешифровывается при
  первой же записи/чтении.

## S4 — лицензия + секреты (владелец: S4)

- `PluelyApiSetup.handleRemoveLicense`: порядок — `deactivate_license_api` →
  (успех|окончательный отказ) → `secure_storage_remove`.
- `useSystemAudioCapture.setupContinuousListeners`: асинхронный cleanup —
  `unlisten*` живут в ref и снимаются в cleanup после резолва.
- `Providers.tsx`: запись ключа только по blur/дебаунсу, строго
  последовательная (последняя операция отменяет предыдущую).

## S5 — hooks state/WS (владелец: S5)

- `useConversationStore`: `buildHistory`/`loadConversation` возвращают историю
  oldest-first (R06); debounce-сохранение не теряет изменения, пришедшие во время
  активной записи (dirty-флаг + один отложенный повторный запуск).
- `useSystemAudioCapture`: WS закрывается в cleanup unmount.
- `useCompletion` / `useChatCompletion`: одна реализация; второй хук —
  тонкая обёртка без дублирования логики.
- Утечки: `useGlobalShortcuts` возвращает unregister; `useQuestionPipeline`
  снимает worker-таймер; `useMicWsStreaming` не открывает сокет после cleanup.

## S6 — security + barrel + филлеры (владелец: S6)

- `host-trust-gate`: проверка конечного хоста; редирект на недоверенный хост →
  запрос без секретов или отказ.
- `stt-fallback`: признак ошибки — код/маркер движка, не совпадение текста с regex.
- `components/index.ts`: `ui`-тяжёлые модули (chart/cmdk) не реэкспортируются
  через корневой barrel; импортёры переведены на прямые пути.
- `filler-manager.ts` удалён, если не используется; иначе — единственный механизм.
- `transcript-stabilizer.resetRecentFillers` сбрасывает оба массива индексов.
- `asr-gate.withNoStream`: пробуждение перепроверяет `activeOwner`.

## S7 — UI-рендер (владелец: S7)

- `app.context.tsx`: `value` — `useMemo`, хендлеры — `useCallback`.
- `SubtitleFeed`: стриминг ответа не инвалидирует `useMemo` всего фида
  (мемоизация списка + строк; тяжёлая нормализация не на каждый токен).
- `PromptProfilesSettings`: выбор другого профиля во время правки не теряет и не
  переносит черновик.
- `audio-visualizer`: canvas очищается и в тишине.

## Общие правила

- Никаких новых внешних зависимостей.
- Тесты: чинить/добавлять в своей зоне; полный прогон — оркестратор.
- Форматирование и сборка — только в конце, оркестратором.
