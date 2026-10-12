# Proposal: Perf+Accuracy wave — 14 оптимизаций по порядку

## Why
T1-брейншторм 2026-10-12 нашёл 6 резервов скорости (до ~1100мс TTFT каждый слой)
и 8 резервов точности (потеря реплик, фрагментация, мусор в промпте) с проверкой
ключевых заявлений в коде. Пользователь: «По порядку».

## What Changes
14 тикетов, порядок = ранг из брейншторма. Каждый тикет: failing-тест → фикс →
зелёный сьют. Группировка по зонам для параллельных фронтов:

| Фронт | Тикеты | Зона |
|---|---|---|
| F1 | T1 (R01 поиск-параллель) | `ai-response.function.ts`, `parallel-search.ts` |
| F2 | T2+T9 (R02+R09 ассемблер) | `question-assembler.ts`, `useQuestionPipeline.ts` |
| F3 | T3+T13 (R03+R13 промпт) | `ai-response.function.ts` (другой участок), `self-evolution-persist.ts` |
| F4 | T4+T6 (R04+R06 ASR-слоты) | `asr-discovery.ts`, `asr-gate.ts`, оба WS-хука |
| F5 | T5+T7+T10 (R05+R07+R10 Rust/VAD) | `speaker/commands.rs`, `useSystemAudioCapture.ts` |
| F6 | T8+T11+T12+T14 (R08+R11+R12+R14 фильтры) | `asr-hallucinations.ts`, `language-detect.ts`, `speech-filter.ts`, `vocab.ts` |

T1 и T3 делят файл, но участки разные (поиск-блок ~887 vs промпт-блок ~328) —
сериализую внутри фронта при конфликте. F4/F5 делят `useSystemAudioCapture.ts` —
только чтение у F5, правки у F4? Нет: F5 правит safety-таймер там же. F4 и F5
пересекаются → запускать последовательно.

Спеки: `specs/latency/spec.md` (R01–R06), `specs/accuracy/spec.md` (R07–R14).
Манифест: `manifest.md` (R01–R14, G1 PASS).

## Границы объёма
- Вне волны: новые провайдеры, новые фичи, редизайн пайплайна.
- Инварианты: дефолтное поведение без регрессий (все существующие тесты зелёные);
  Stage-A тесты заморожены на Stage-B.
