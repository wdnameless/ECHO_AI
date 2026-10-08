# Audit Must-Fix — границы и владельцы

## FrontendFix (владелец: frontend worktree)
- `ai-response.function.ts:350` — убрать `.reverse()`; история уже хронологическая. Тест: порядок сообщений в payload.
- `useAIStreaming.ts:241-248` — разделить `displayResponse` (с филлером) и `storedResponse` (чистый); `addInteraction` получает чистый. Тест: филлер в UI есть, в истории нет.

## NativeFix (владелец: native worktree)
- `activate.rs:384-410` — `tokio::sync::Mutex` (или std Mutex вокруг load+save) + write-to-temp + rename. Тест Rust: параллельные save не теряют ключи; truncate-восстановление.

## PipelineFix (владелец: pipeline worktree)
- `useQuestionPipeline.ts` — сброс turn-gate во всех ветках flush (monologue-fallback, semi/manual completion, empty); удалить мёртвый дубль emission-блока. Тест: статус гаснет на каждом пути.
- `asr-gate.ts:107-118` — при handoff слота будить и `waiters` (или очередь с приоритетом HTTP). Тест: withNoStream не голодает при чередовании каналов.
