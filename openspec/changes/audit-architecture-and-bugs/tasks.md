# Tasks

## Сделано
- [x] R01 `vadConfig` в зависимостях `runLiveBatch`
- [x] R02 разделить тик перерисовки и тик перезапуска очереди
- [x] R03 сохранять результат перевода, пришедший во время teardown

## Далее — проверено, уже в коде (2026-09-28, тесты зелёные)
- [x] R04 выбор STT переживает рестарт (`selected-stt-provider.test.tsx`, 3 теста)
- [x] R05 единый `gatedFetch`: web-search, fast-translator, Test через `fetchProviderModels` (`gated-fetch`, `web-search-secrets`, `host-trust-gate`, `translation-gateway` — 65 тестов)
- [x] R06 mic WS ref при создании сокета (`useMicWsStreaming.test.ts`)
- [x] R07 `releaseStream` только для текущего сокета (`useThemWsStreaming.test.ts`)
- [x] R08 flush сохранения при размонтировании (`conversation-save-flush.test.ts`)
- [x] R09 мьютекс `START_LOCK` на старт сайдкара (`handy_server.rs:635-670`)
