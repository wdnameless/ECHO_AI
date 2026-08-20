# 🚀 Pluely — AI Copilot & Voice Mock Interview

<p align="center">
  <b>Умный AI-ассистент реального времени для встреч, собеседований и мок-интервью</b><br>
  <i>Lightning-fast, privacy-first AI desktop assistant powered by Tauri (Rust), React 19, and Vite.</i>
</p>

---

## 🌟 Основные возможности

### 🎙️ 1. Голосовое Mock Interview с RAG-контекстом
- **Адаптивные вопросы под вакансию**: ИИ выступает в роли интервьюера, задавая вопросы на основе загруженного **Резюме** и **Описания вакансии (Job Description)**.
- **Голосовой ответ**: Ответ кандидата записывается через микрофон с умным распознаванием речи.
- **Реалистичная разговорная генерация ответа («Generate answer»)**:
  - Формирует ответ от первого лица с естественными живыми вводными фразами (*«Ну, смотрите...»*, *«Слушайте, на практике...»* / *«Well, to be honest...»*, *«Yeah, in my previous role...»*).
  - Стриминг текста в реальном времени — слова появляются мгновенно.
  - Без роботизированных ИИ-клише и громоздких академических конструкций.
- **Оценка и разбор**: В конце интервью ИИ выставляет балл из 10, отмечает сильные стороны и точки роста.

### 🧠 2. RAG Context Storage (Резюме и Вакансии)
- Загрузка файлов `.pdf`, `.txt`, `.md` в разделе **Settings**.
- Автоматическое извлечение текста из PDF-документов.
- Мгновенное подключение/отключение контекста в системный промпт через тумблеры.

### ⚡ 3. Локальный STT (Handy / Whisper) + Облачный Fallback (Groq)
- **Автозапуск локального STT**: При старте Pluely автоматически поднимается локальный сервер распознавания речи на `127.0.0.1:8000`, использующий установленную в Handy модель.
- **Cloud Fallback (Groq Whisper)**: Если локальный сервер недоступен, распознавание речи автоматически переключается на облачный Groq (`whisper-large-v3-turbo`).

### 🔄 4. Встроенный модуль автообновлений (Tauri Auto-Updater)
- Проверка обновлений напрямую через **GitHub Releases** (`wdnameless/pluely`).
- Обновление одной кнопкой **«Download & Install Update»** прямо в интерфейсе без необходимости ручной переустановки.

---

## 🛠️ Архитектура и технологии

| Компонент | Стек |
|---|---|
| **Core / Desktop** | [Tauri v2](https://tauri.app/) (Rust) |
| **Frontend** | React 19, TypeScript, Tailwind CSS, Lucide Icons |
| **Локальная БД** | SQLite (`tauri-plugin-sql`) с автоматическими миграциями |
| **VAD / Аудио** | Silero VAD (`@ricky0123/vad-web`), Web Audio API |
| **STT Engine** | Handy Local STT (16 kHz mono WAV) + Groq Whisper API Fallback |
| **Автообновления** | `tauri-plugin-updater` с криптографической подписью Minisign |

---

## 🚀 Установка и запуск из исходников

### Требования
1. **Node.js**: `v20+`
2. **Rust & Cargo**: `stable` (`rustup default stable`)
3. **Python**: `3.10+` (для локального STT моста)
4. **Handy** (опционально для локального офлайн-распознавания): установлен в `D:\progg\Handy` или системный путь.

### Установка зависимостей
```bash
npm install
```

### Запуск в режиме разработки
```bash
npm run tauri dev
```

### Сборка релизного инсталлятора
```bash
npm run tauri build
```
Готовые установщики появятся в:
- `src-tauri/target/release/bundle/nsis/Pluely_x.x.x_x64-setup.exe`
- `src-tauri/target/release/bundle/msi/Pluely_x.x.x_x64_en-US.msi`

---

## ⚙️ Настройка провайдеров и ключей

1. **AI Провайдеры**:
   - Откройте раздел **Dev Space → AI Providers** и укажите свой API-ключ для OpenAI, Anthropic, DeepSeek, Groq или локальной Ollama.
2. **Резюме и Вакансия**:
   - Перейдите в **Settings** → блоки **My Resume** и **Job Description**.
   - Нажмите **Upload document** и выберите ваш PDF или текстовый файл.
3. **STT (Распознавание речи)**:
   - **Handy Local STT**: используется по умолчанию при наличии Handy.
   - **Groq Fallback**: введите ключ `gsk_...` в разделе **Dev Space → STT Providers → Cloud fallback key**.

---

## 📦 Репозиторий и автообновления

- **GitHub Repository**: [https://github.com/wdnameless/pluely](https://github.com/wdnameless/pluely)
- **CI/CD**: Каждый push в ветку `master` автоматически собирает приложение под Windows, подписывает артефакты и публикует новый GitHub Release с манифестом `latest.json`.
- **Обновление в приложении**: При появлении нового релиза в окне Pluely отображается кнопка обновления, скачивающая и применяющая апдейт на лету.

---

## 📄 Лицензия

Проект распространяется под лицензией GNU General Public License v3.0.
