# pipeline-audit Specification

## Purpose
TBD - created by archiving change thought-livecoding-audit. Update Purpose after archive.

## Requirements

### Requirement: Отчёт аудита пайплайна
Аудит SHALL предоставить ранжированный отчёт по всему пайплайну вопрос→ответ: баги, гонки, мёртвый код, питфоллы промпта/истории — каждый с file:line и пометкой, блокирует ли R01/R02.

#### Scenario: Приёмка аудита
- **WHEN** отчёт готов
- **THEN** каждая находка имеет локализацию и ранг; блокеры режимов явно помечены
