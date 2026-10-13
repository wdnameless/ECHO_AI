# Requirements Manifest — Tech-debt wave (R01–R09)

Источник: сессия 2026-10-13.
Статусы: `open` | `in-spec` | `in-ticket` | `done` | `placeholder` | `deferred` | `dropped`.

## Запросы пользователя (verbatim)

- «что мы еще можем улучшить ?»
- «Делай все кроме фич»

## Ответы интервью Волны 0 (verbatim)

| id | Значение |
|---|---|
| state_mgr | «Zustand» |
| native_ws | «Полный редизайн» |
| sql_bridge | «Полный мост» |

## Реестр требований

| id | Требование | Цитата-источник | Статус | Слайс |
|---|---|---|---|---|
| R01 | SubtitleFeed (2269 строк) разбит на FeedRow/AICard/Popovers/RulePreview; поведение 1:1 | «Делай все кроме фич» (№1) | done | S1 |
| R02 | app.context (1158 строк) → Zustand-сторы по доменам; ререндеры ужаты | «Zustand» | done | S2 |
| R03 | Нативный WS Rust→ASR + редизайн asr-gate; JS-хоп убран | «Полный редизайн» | done | S3 |
| R04 | Все SQL через tauri-команды; sql:allow-execute убран | «Полный мост» | done | S4 |
| R05 | prompt-builder.ts выделен из ai-response; превью и тесты тривиальны | «Делай все кроме фич» (№5) | done | S5 |
| R06 | useSystemAudioCapture (1105 строк) → захват/транскрибация/восстановление | «Делай все кроме фич» (№6) | done | S6 |
| R07 | Clippy ноль warning (transmute-аннотации, dead new, Result) | «Делай все кроме фич» (№7) | done | S7 |
| R08 | Все существующие тесты зелёные после каждого слайса; поведение 1:1 | неявное `i` | in-spec | все |
| R09 | Фичи (Phone Mirror, Companion, оплата, mac/linux) НЕ делаются | «кроме фич» | deferred | — |

## G1 gate

- Нет `open`: R01–R08 `in-spec`, R09 `deferred` с цитатой. Gate G1: PASS.
