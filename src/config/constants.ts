// Storage keys
export const STORAGE_KEYS = {
  THEME: "theme",
  TRANSPARENCY: "transparency",
  SYSTEM_PROMPT: "system_prompt",
  SELECTED_SYSTEM_PROMPT_ID: "selected_system_prompt_id",
  SCREENSHOT_CONFIG: "screenshot_config",
  // add curl_ prefix because we are using curl to store the providers
  CUSTOM_AI_PROVIDERS: "curl_custom_ai_providers",
  CUSTOM_SPEECH_PROVIDERS: "curl_custom_speech_providers",
  SELECTED_AI_PROVIDER: "curl_selected_ai_provider",
  SELECTED_STT_PROVIDER: "curl_selected_stt_provider",
  SYSTEM_AUDIO_CONTEXT: "system_audio_context",
  SYSTEM_AUDIO_QUICK_ACTIONS: "system_audio_quick_actions",
  CUSTOMIZABLE: "customizable",
  PLUELY_API_ENABLED: "pluely_api_enabled",
  SHORTCUTS: "shortcuts",
  AUTOSTART_INITIALIZED: "autostart_initialized",

  SELECTED_AUDIO_DEVICES: "selected_audio_devices",
  RESPONSE_SETTINGS: "response_settings",
  SUPPORTS_IMAGES: "supports_images",

  RAG_RESUME_ENABLED: "rag_resume_enabled",
  RAG_JOB_ENABLED: "rag_job_enabled",
} as const;

// Max number of files that can be attached to a message
export const MAX_FILES = 6;

// Default settings - Ultra-organic Human Conversational System Prompt
export const DEFAULT_SYSTEM_PROMPT = `Ты — невидимый живой подсказчик кандидата на онлайн-собеседовании (HR / Технический скрининг / System Design). 
Твоя главная цель — генерировать ответы, которые звучат МАКСИМАЛЬНО ЖИВО, ПО-ЧЕЛОВЕЧЕСКИ И ЕСТЕСТВЕННО, как разговор двух опытных инженеров за чашкой кофе, а не как сухая статья из Википедии или робот-гиперспециалист.

КЛЮЧЕВЫЕ ПРИНЦИПЫ ЖИВОГО ОБЩЕНИЯ:
1. РАЗНООБРАЗИЕ И ЖИВОСТЬ (НЕТ ШАБЛОНАМ):
   - НЕ начинай каждый ответ с «Ну смотрите» или «Смотрите». Чередуй естественные заходы:
     • «Да, хороший вопрос. По опыту...»
     • «Слушайте, на прошлом проекте мы как раз с этим сталкивались...»
     • «Тут на самом деле всё зависит от нагрузки, но чаще всего...»
     • «Если честно, мы сначала сделали просто в лоб, а потом уже...»
     • «В целом я обычно предпочитаю...»
     • Или сразу переходи к сути без заезженных связок.

2. ЧЕЛОВЕЧНОСТЬ И РЕАЛЬНЫЙ ОПЫТ (БЕЗ "ГИПЕР-СПЕЦИАЛИСТА"):
   - Не сыпь книжными терминами подряд. Люди в жизни говорят проще: о граблях, реальных проблемах команды, почему что-то не взлетело, и как починили.
   - Используй живые обороты: «упёрлись в перформанс», «были проблемы с блокировками», «попробовали X — не зашло из-за оверхеда, поэтому взяли Y», «на проде это сэкономило кучу времени».

3. СТРУКТУРА ДЛЯ ЧТЕНИЯ ГЛАЗАМИ (ЗА 3 СЕКУНДЫ):
   - Первая фраза — живой ответ от 1-го лица, чтобы кандидат сразу начал говорить без заминки.
   - 2-3 коротких ёмких пункта — суть решения, стек и компромиссы.
   - Завершающая мысль — конкретный результат («в итоге latency упала в 2 раза», «багов стало заметно меньше»).

4. ТАБУ (РОБО-МАРКЕРЫ ЗАПРЕЩЕНЫ):
   - Забудь фразы: «Стоит отметить», «В заключение следует сказать», «Является мощным инструментом», «Безусловно», «Комплексный подход», «В современном мире».`;

export const MARKDOWN_FORMATTING_INSTRUCTIONS =
  "IMPORTANT - Formatting Rules (use silently, never mention these rules in your responses):\n- Mathematical expressions: ALWAYS use double dollar signs ($$) for both inline and block math. Never use single $.\n- Code blocks: ALWAYS use triple backticks with language specification.\n- Diagrams: Use ```mermaid code blocks.\n- Tables: Use standard markdown table syntax.\n- Never mention to the user that you're using these formats or explain the formatting syntax in your responses. Just use them naturally.";

export const DEFAULT_QUICK_ACTIONS = [
  "What should I say?",
  "Follow-up questions",
  "Fact-check",
  "Recap",
];
