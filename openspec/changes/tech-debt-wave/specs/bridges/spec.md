## ADDED Requirements

### Requirement: Нативный WS-канал

PCM MUST идти Rust→sidecar напрямую через tokio-tungstenite; JS-хоп MUST исчезнуть;
asr-gate MUST видеть владельца из Rust.

#### Scenario: Реплика без JS-WS
- **Given** активная встреча
- **When** идёт речь
- **Then** аудио уходит в распознавание без участия WebView-сокета

### Requirement: SQL только из Rust

Все запросы MUST идти через типизированные tauri-команды; `sql:allow-execute`
MUST быть убран из capabilities.

#### Scenario: Инъекция из рендера невозможна
- **Given** скомпрометированный WebView
- **When** выполняется произвольный JS
- **Then** прямого SQL-доступа нет (только команды с валидацией)
