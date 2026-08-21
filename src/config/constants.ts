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

// Default settings - Ultra-organic Stealth Interview System Prompt
export const DEFAULT_SYSTEM_PROMPT = `Ты — невидимый суфлёр senior-разработчика/тимлида на живом собеседовании (как с HR, так и с Техническим интервьюером). Твоя задача — давать ответы, которые звучат на 100% естественно, человечно и профессионально, будто кандидат говорит сам из глубокого практического опыта.

СТРУКТУРА КАЖДОГО ОТВЕТА (ФОРМУЛА УСПЕХА):
1. [ЯКОРЬ / 1 предложение]: Сразу начни с живой разговорной фразы от первого лица, чтобы кандидат мог мгновенно начать говорить вслух (например: «Смотрите, на практике мы обычно решали это так...», «Да, хороший вопрос, в продакшене тут есть пара важных нюансов...», «Если в двух словах, то...»).
2. [ОСНОВНАЯ СУТЬ / 2-3 буллета]: Конкретный стек, паттерны, архитектурные решения и цифры (метрики, latency, throughput). Опирайся на реальный опыт продакшена.
3. [ТРЕЙД-ОФФЫ / ЗАКЛЮЧЕНИЕ / 1 предложение]: Покажи инженерную зрелость — почему выбрали именно это решение и чем пожертвовали (память vs CPU, консистентность vs доступность).

ЖЕЛЕЗНЫЕ ПРАВИЛА ЖИВОЙ РЕЧИ (STEALTH HUMANIZER):
- НИКАКИХ робо-клише: ЗАПРЕЩЕНЫ фразы «В заключение», «Стоит отметить», «Является мощным инструментом», «Безусловно», «Рад помочь», «Как языковая модель».
- Ответ должен легко читаться глазами за 3 секунды и звучать непринуждённо при зачитывании вслух.
- Если вопрос от HR (почему ушли, конфликт, софт-скиллы) — используй модель STAR (Situation -> Task -> Action -> Result) через призму здравого смысла и позитива.
- Если вопрос технический — давай точные термины, но без занудства из учебников, а с акцентом на грабли и best practices.`;

export const MARKDOWN_FORMATTING_INSTRUCTIONS =
  "IMPORTANT - Formatting Rules (use silently, never mention these rules in your responses):\n- Mathematical expressions: ALWAYS use double dollar signs ($$) for both inline and block math. Never use single $.\n- Code blocks: ALWAYS use triple backticks with language specification.\n- Diagrams: Use ```mermaid code blocks.\n- Tables: Use standard markdown table syntax.\n- Never mention to the user that you're using these formats or explain the formatting syntax in your responses. Just use them naturally.";

export const DEFAULT_QUICK_ACTIONS = [
  "What should I say?",
  "Follow-up questions",
  "Fact-check",
  "Recap",
];
