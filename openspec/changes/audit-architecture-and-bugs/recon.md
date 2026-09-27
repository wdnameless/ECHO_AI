# Recon: аудит

## Что сделано
6 параллельных агентов (reviewer ×3, security-reviewer, scout ×2) по срезам:
1. ASR-конвейер (гонки, сокеты, гейт стримов)
2. LLM/перевод (стриминг, очередь перевода)
3. Безопасность (доверие, ключи, CSP, Rust-инъекции)
4. Rust-бэкенд (сайдкар, порты, мьютексы, паники)
5. Персистентность (дебаунс-записи, миграции, FK)
6. Состояние/UI (контекст, эффекты, структура)

## Проверено лично в коде
- app.context.tsx:538-554 — выбор STT затирается дефолтом (priority 0).
- web-search.ts ×3 + fast-translator.ts + Providers.tsx — сеть без гейта доверия.
- capabilities: `http://**` + `https://**` — гейт единственный контроль исхода.
- useMicWsStreaming.ts:203 — ref присваивается только в onopen.
- useThemWsStreaming.ts:152 — там же, но исправлено (для сравнения).
- useThemWsStreaming.ts:194 — releaseStream вне проверки wsRef.
- useConversationStore.ts:302 — cleanup чистит таймер без flush.
- SubtitleFeed.tsx:1146 + 1132 — эффект отменяет своих же воркеров.
- useSystemAudioCapture.ts:571 — устаревшее замыкание vadConfig.
- handy_server.rs:604 — нет мьютекса на старте сайдкара.
- useSystemAudio.ts:308 + useAIStreaming.ts:193 — удержанный вопрос не уходит.

## Acceptance
Отчёт с проверенными находками, разделёнными на «проверено лично» и «заявка агента».
Код не менялся — это аудит.
