## Why
Аудит нашёл 5 подтверждённых дефектов: перевёрнутая история, филлер в БД, гонка секретов, залипший turn-gate, голодание HTTP-транскрипции.

## What Changes
- История в Pluely API — в хронологическом порядке.
- Филлер — только визуальный, в историю не пишется.
- Секреты: мьютекс + атомарная запись.
- Turn-gate сбрасывается на всех путях диспетчеризации; мёртвый код удалён.
- ASR-gate будит HTTP-ожидающих честно.

## Capabilities
### New Capabilities
- `audit-mustfix`: пять точечных исправлений без смены архитектуры.
### Modified Capabilities

## Impact
ai-response.function.ts, useAIStreaming.ts, activate.rs, useQuestionPipeline.ts, asr-gate.ts + тесты. Без новых зависимостей, без миграций.
