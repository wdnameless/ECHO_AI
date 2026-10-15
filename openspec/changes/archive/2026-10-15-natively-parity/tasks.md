# Tasks: Natively parity — общий план

Каждый слайс — отдельный git worktree на своей ветке, интеграция через
`feat/natively-parity-integration`. Порядок запуска: S4 и S6 первыми (независимые,
дешёвые), затем S2, S3, S5, S1 самым тяжёлым; S7 — финальный oracle.

## S1 — RAG-память
Ветка: `feat/s1-rag-memory` · Worktree: `../Pluely-s1-rag` · Тикеты: `s1-rag/tasks.md`
- [ ] T1.1 sqlite-vec: миграция + индекс транскриптов (fixer)
- [ ] T1.2 Локальные эмбеддинги: ленивая загрузка модели (fixer)
- [ ] T1.3 Cloud BYOK-бэкенд эмбеддингов + UI-переключатель (fixer → designer)
- [ ] T1.4 Поиск вопросом по памяти встреч + инъекция в промпт (fixer)
- [ ] T1.5 Тесты + oracle слайса

## S2 — Стриминговый облачный STT
Ветка: `feat/s2-streaming-stt` · Worktree: `../Pluely-s2-stt` · Тикеты: `s2-stt/tasks.md`
- [ ] T2.1 Интерфейс StreamingSTTProvider + шов в asr-gate (fixer)
- [ ] T2.2 Deepgram WS: стрим, переподключение, язык (fixer)
- [ ] T2.3 trusted-hosts + UI выбора облачного STT (fixer → designer)
- [ ] T2.4 Тесты + oracle слайса

## S3 — Стелс window-level
Ветка: `feat/s3-stealth` · Worktree: `../Pluely-s3-stealth` · Тикеты: `s3-stealth/tasks.md`
- [ ] T3.1 Win: скрытие из таскбара/Alt-Tab при стелсе (fixer)
- [ ] T3.2 Диалоги/тултипы/нотификации вне захвата (fixer → designer)
- [ ] T3.3 mac/Linux паритет window-level (fixer)
- [ ] T3.4 Тесты + oracle слайса

## S4 — Дешёвый пак
Ветка: `feat/s4-cheap-pack` · Worktree: `../Pluely-s4-pack` · Тикеты: `s4-pack/tasks.md`
- [ ] T4.1 Персоны Sales/Recruiting/Lecture/Call Center (данные + тесты) (fixer)
- [ ] T4.2 DOCX в загрузчике контекста (fixer)
- [ ] T4.3 Экспорт истории md/json (fixer → designer)
- [ ] T4.4 Тесты + oracle слайса

## S5 — Visual Answers
Ветка: `feat/s5-visual` · Worktree: `../Pluely-s5-visual` · Тикеты: `s5-visual/tasks.md`
- [ ] T5.1 Промпт-движок: когда предлагать визуал (fixer)
- [ ] T5.2 Рендер диаграмм в ленте через mermaid (designer)
- [ ] T5.3 Тесты + oracle слайса

## S6 — Дистрибуция
Ветка: `feat/s6-distro` · Worktree: `../Pluely-s6-distro` · Тикеты: `s6-distro/tasks.md`
- [x] T6.1 Portable-артефакт Windows в release.yml (fixer)
- [x] T6.2 Проверка артефакта + дока (fixer)
- [x] T6.3 oracle слайса (артефакт собирается)

## S7 — Интеграция
На integration-ветке, после мержа всех слайсов.
- [ ] T7.1 Полный сьют + билд на integration-ветке
- [ ] T7.2 Финальный blind oracle vs manifest.md
