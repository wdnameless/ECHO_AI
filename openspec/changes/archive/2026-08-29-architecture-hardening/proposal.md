# Proposal: Architecture Hardening — Round 2

## Why
После v0.1.68-74 (WS-субтитры, двойные GPU-сессии, гарды) аудит выявил остаточные
слабые места: висящий VRAM при force-kill, троттлинг JS-таймеров в свёрнутом окне,
кумулятивный O(n²) STT для микрофона, потеря Self-Evolution при очистке
localStorage, невидимые ошибки, захардкоженный порт.

## What Changes
1. **RUST / job-object**: сайдкар привязывается к Windows Job Object с
   KILL_ON_JOB_CLOSE — умирает вместе с Pluely (убирает сироту-процесс и VRAM-утечку).
2. **RUST / emission-timer**: дедлайн-эмиссия вопросов в Rust (tokio) вместо
   JS setTimeout — стабильные 250/800 мс при любом фокусе окна.
3. **RUST+FE / mic-ws**: микрофонные кадры идут по тому же WS-протоколу, что и
   собеседник — свои слова в ленте с задержкой ~100 мс вместо 1 с.
4. **FE / code-splitting**: dynamic import() для katex/mermaid/cytoscape/highlight
   (3.7 МБ бандл → ~1.2 МБ стартового).
5. **RUST+FE / port-discovery**: автофоллбек порта 9877→9880→9881, выбранный порт
   пишется в %APPDATA%/pluely/asr-port; Pluely и сайдкар согласуют порт.
6. **FE / sqlite-persist**: Self-Evolution (эталоны/правила/лог) в
   tauri_plugin_sql вместо localStorage.
7. **FE / error-surface**: последняя ошибка пайплайна видима в футере ленты.
8. **RUST / third-session**: опционально — третья сессия для одновременных
   двусторонних стримов.

## Impact
- Specs: asr-service, meeting-copilot, provider-settings
- Код: pluely-asr (state/ws/commands), src-tauri (lib.rs job object),
  src/hooks/useSystemAudio.ts, src/pages/dev/components/ai-configs
- Риски: dual-session память (+0.7 ГБ/сессия — ОК на 12 ГБ); миграция localStorage
  → SQLite требует идемпотентного переноса.

## Verification
- 503-нагрузочный тест: 3 batch + 2 WS параллельно — все 200.
- Джоб-обджект: kill -9 Pluely → сайдкар умирает в течение 1 с.
- Мик-WS: слова в ленте < 200 мс от речи.
- Бандл: стартовый JS < 1.5 МБ.