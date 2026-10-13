# Proposal: Tech-debt wave — 7 слайсов без фич

## Why
Накопленный структурный долг: 4 монолита (2269/1158/1105/1070 строк), лишний
JS-хоп аудио, прямой SQL из WebView, clippy-предупреждения. Пользователь:
«Делай все кроме фич». Wave-0: Zustand, полный WS-редизайн, полный SQL-мост.

## What Changes
7 слайсов, порядок — от независимых к рискованным. Каждый слайс: свой worktree,
своя ветка, свой oracle; поведение 1:1, тесты зелёные.

| Слайс | Содержание | R | Ветка |
|---|---|---|---|
| **S1** | SubtitleFeed → FeedRow/AICard/Popovers/RulePreview | R01 | `refactor/s1-feed-split` |
| **S2** | app.context → Zustand-сторы | R02 | `refactor/s2-zustand` |
| **S3** | Нативный WS Rust→ASR + редизайн asr-gate | R03 | `feat/s3-native-ws` |
| **S4** | SQL-мост в Rust, убрать allow-execute | R04 | `feat/s4-sql-bridge` |
| **S5** | prompt-builder.ts из ai-response | R05 | `refactor/s5-prompt-builder` |
| **S6** | useSystemAudioCapture → 3 модуля | R06 | `refactor/s6-audio-split` |
| **S7** | Clippy ноль + финальный oracle | R07–R08 | на integration |

Интеграция: `feat/tech-debt-integration`. Порядок запуска: S7 первым (дешёвый,
разблокирует тишину CI), затем S1+S5 параллельно, S2, S6, S4, S3 самым
рискованным последним.

Спеки: `specs/refactors/spec.md` (R01–R02, R05–R07), `specs/bridges/spec.md`
(R03–R04). Манифест: `manifest.md` (G1 PASS).

## Границы объёма
- Вне: фичи R09 (Phone Mirror, Companion, оплата, mac/linux).
- Инварианты: поведение 1:1 каждый слайс; Expand–Contract для широких
  рефакторов; `zustand` — единственная новая TS-зависимость (согласована);
  `tokio-tungstenite` для S3 (нужен редизайну, уже используется в stt_stream).
