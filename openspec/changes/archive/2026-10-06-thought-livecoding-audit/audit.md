# Аудит пайплайна «Вопрос → Ответ» (Pipeline & Architecture Audit)

**Версия:** 1.0 (Wave 3 — R04)  
**Репозиторий / Рабочее дерево:** `D:/WORK/Pluely/.tmp/pipeline-audit` (базовый коммит `7082cda`)  
**Область аудита:** Пайплайн обработки речи собеседника, сборки вопросов, генерации промптов, потоковой передачи ответов в LLM и рендеринга в оверлее (`src/hooks/useAIStreaming.ts`, `src/hooks/useSystemAudio.ts`, `src/hooks/useQuestionPipeline.ts`, `src/lib/functions/ai-response.function.ts`, `src/lib/functions/common.function.ts`, `src/lib/code-answer.ts`, `src/pages/app/components/speech/SubtitleFeed.tsx`, `src/pages/app/components/speech/index.tsx`, `src/lib/auto-ask.ts`, `src/lib/question-assembler.ts`).  
**Статус:** Исследования завершены. Код продукта не модифицирован (правки требуют отдельного согласования по R04, кроме изолированных фиксов в соответствующих слайсах).

---

## Сводная матрица ранжированных находок (1–16)

| Ранг | Категория | Локализация (`file:line`) | Описание дефекта | Блокирует |
|:---:|:---|:---|:---|:---:|
| **1** | Mode Blocker | `src/lib/functions/ai-response.function.ts:217-222` | Кап длины `SHORT_LENGTH_PROMPT` (35–55 слов) душит ход мыслей | **R01** |
| **2** | Mode Blocker | `src/lib/functions/ai-response.function.ts:592-599` | Хардкод `max_tokens: 600` обрезает русскоязычные рассуждения | **R01** |
| **3** | Mode Blocker | `src/lib/functions/ai-response.function.ts:505-512, 548-555` | `reasoning_effort: "minimal"` блокирует бюджет размышлений моделей | **R01** |
| **4** | Mode Blocker | `src/pages/app/components/speech/SubtitleFeed.tsx:211-213, 277-310` | Отсутствие контейнера/парсера хода мыслей в UI SubtitleFeed | **R01** |
| **5** | Mode Blocker | `src/pages/app/components/speech/index.tsx:315-344` | Режим лайвкодинга существует только в виде разовых кнопок без persistent toggle | **R02** |
| **6** | Mode Blocker | `src/hooks/useSystemAudio.ts:138-152`, `src/lib/auto-ask.ts:109-177` | Auto-ask пайплайн маршрутизирует задачи исключительно в обычный монолог | **R02** |
| **7** | Mode Blocker | `src/lib/functions/ai-response.function.ts:194-253, 843` | Коллизия промптов: humanizer-опенеры и разговорные правила в коде | **R02** |
| **8** | Mode Blocker | `src/lib/code-answer.ts:63-71`, `src/pages/app/components/speech/SubtitleFeed.tsx:219-229` | Статичная заглушка плана + развал рендера при стриминге незакрытых бэктиков | **R02** |
| **9** | Bug (Critical) | `src/lib/functions/ai-response.function.ts:326-328` | `[...history].reverse()` отправляет историю диалога задом наперёд в Pluely API | — |
| **10** | Bug / Pitfall | `src/hooks/useAIStreaming.ts:218-223, 240` | Сшитый филлер задержки (перебивка) навсегда оседает в БД истории | — |
| **11** | Race Condition | `src/hooks/useSystemAudio.ts:339-341`, `src/hooks/useSystemAudio.ts:118` | Рассинхрон `isAIProcessingRef` через `useEffect` абортит стрим на лету | — |
| **12** | Race / Data Loss | `src/hooks/useAIStreaming.ts:176-179, 242-247` | `pendingScreenshotRef` очищается до запроса — потеря скрина при ошибке | — |
| **13** | Prompt Pitfall | `src/lib/functions/ai-response.function.ts:296` | `prompts.join(" ")` склеивает секции промпта пробелом, ломая Markdown | — |
| **14** | Error Gap | `src/lib/functions/common.function.ts:147-171` | Схема сообщений OpenAI ломает REST-запросы к Google Gemini (HTTP 400) | — |
| **15** | Dead Code / Perf | `src/hooks/useQuestionPipeline.ts:26-55, 187-193` | Дублирующий резолвинг URL провайдера и спам фонового warm-up на каждом сегменте | — |
| **16** | ASR / Latency | `src/lib/question-assembler.ts:74-79`, `src/lib/auto-ask.ts:170-177` | Двойное ожидание тишины (Assembler + Manager) добавляет ~1 с задержки | — |

---

## Раздел I. Блокеры режимов (8 Mode Blockers — R01 / R02)

### 1. Кап длины `SHORT_LENGTH_PROMPT` (35–55 слов) подавляет ход мыслей
* **Локализация:** `src/lib/functions/ai-response.function.ts:217-222`, `src/lib/answer-length.ts:82-83`, `src/config/humanizer.rules.ts:25-26, 33`
* **Метка:** `[BLOCKS R01]`
* **Суть проблемы:** Функция `buildEnhancedSystemPrompt` вычисляет длину ответа через `resolveAnswerLength(userMessage, getAnswerLengthOverride())`. Если вопрос не содержит триггеров («почему», «подробно») и тумблер в тулбаре стоит в «Авто», в промпт безусловно пушится `SHORT_LENGTH_PROMPT`:
  ```ts
  "Keep it tight: 1-3 spoken sentences (35-55 words maximum). One thought + one concrete number or example. No lists, no headings."
  ```
  Параллельно `HUMANIZER_INSTRUCTIONS` требует: *«Answer exactly what was asked, then stop. Do not add unnecessary conclusions»*, а `INTERVIEW_MODE_INSTRUCTIONS` запрещает списки и заголовки.
* **Влияние на R01:** Пользователь в R01 прямо требует: *«чтобы наш промт менялся, и ответы были с постепенным ходом мысли, почему я так сделал, что стоит за этим ответом, как это работает и так далее, на что я опирался»*. Ограничение в 35–55 слов физически не позволяет модели выдать цепочку рассуждений (предпосылка → альтернативы → выбор → обоснование), модель вынуждена сразу выдавать сухой финальный вывод.
* **Решение для слайса:** Ввести режим `thought` в `answer-mode.ts`; в `buildEnhancedSystemPrompt` при режиме `thought` отключать `SHORT_LENGTH_PROMPT` и инжектировать блок рассуждений с отдельным лимитом.

---

### 2. Хардкод `max_tokens: 600` обрезает русскоязычные размышления
* **Локализация:** `src/lib/functions/ai-response.function.ts:592-599`
* **Метка:** `[BLOCKS R01]`
* **Суть проблемы:** При формировании тела запроса для кастомных/OpenAI-совместимых провайдеров в `streamAIResponse` срабатывает защитный лимит:
  ```ts
  if (
    typeof bodyObj === "object" &&
    bodyObj !== null &&
    bodyObj.max_tokens === undefined &&
    bodyObj.maxOutputTokens === undefined
  ) {
    bodyObj.max_tokens = 600;
  }
  ```
* **Влияние на R01:** В русском языке 1 токен покрывает в среднем всего 1–2 символа (кириллица токенизируется значительно плотнее латиницы). 600 токенов — это примерно 140–180 русских слов. Если модель выдаёт сначала блок обоснования (ход мыслей на 100 слов), а затем сам развёрнутый ответ на вопрос (150 слов), суммарная длина превышает 600 токенов. Стрим обрывается на полуслове посреди фразы.
* **Решение для слайса:** При активном режиме `thought` или `livecode` поднимать дефолтный `max_tokens` до 1500–2000 токенов (либо использовать динамический расчет в зависимости от режима).

---

### 3. Принудительный `reasoning_effort: "minimal"` блокирует модели рассуждений
* **Локализация:** `src/lib/functions/ai-response.function.ts:505-512, 548-555`
* **Метка:** `[BLOCKS R01]`
* **Суть проблемы:** В `ai-response.function.ts` переменная `REASONING_EFFORT` по умолчанию инициализируется как `"minimal"`, а значения `"0"`, `"none"`, `"disabled"` принудительно нормализуются в `"minimal"`:
  ```ts
  const reasoningEffort = userVariables["REASONING_EFFORT"] || "minimal";
  ...
  // Normalize disabled reasoning to "minimal" for fastest first-token delivery
  bodyObj.reasoning_effort = "minimal";
  ```
* **Влияние на R01:** Для reasoning-моделей (OpenAI o1/o3-mini, Gemini 2.0 Flash Thinking, DeepSeek-R1) параметр `reasoning_effort: "minimal"` жестко урезает внутренний бюджет размышлений модели в угоду latency первого токена. В результате модель выдает поверхностные ответы без глубокого анализа компромиссов, что прямо противоречит цели режима хода мыслей на SBS-интервью.
* **Решение для слайса:** В режиме `thought` не занижать `reasoning_effort` до `"minimal"` (выставлять `"medium"` или передавать значение из настроек).

---

### 4. В SubtitleFeed отсутствует контейнер и парсер для хода мыслей
* **Локализация:** `src/pages/app/components/speech/SubtitleFeed.tsx:211-213, 277-310`
* **Метка:** `[BLOCKS R01]`
* **Суть проблемы:** Компонент `AnswerBody` в `SubtitleFeed.tsx` умеет разделять ответ только на два вида контента:
  1. Блок кода (`splitCodeAnswer`, если найдены бэктики ` ``` `).
  2. Разговорный текст через `formatSpokenAnswer(text)`, который рендерится плоскими параграфами `<p>`.
  Контейнера, аккордеона или визуального разделителя для внутренних рассуждений кандидата (`<thought>`, `[Ход мыслей]` или `Reasoning`) в компоненте нет.
* **Влияние на R01:** Если LLM сгенерирует блок обоснования в едином текстовом потоке, он отобразится как обычная речь кандидата. Кандидат во время звонка впопыхах прочитает с экрана вслух интервьюеру свои внутренние технические заметки («Так, интервьюер хочет проверить знание замыканий, поэтому сначала скажу...»), что приведет к провалу интервью.
* **Решение для слайса:** Добавить в `SubtitleFeed.tsx` парсер мыслей (выделение тегов `<thought>...</thought>` или блока `[Обоснование]`) и рендерить их в отдельном визуальном блоке (полупрозрачная плашка с меткой «Ход мыслей»), визуально отделенном от диктуемого ответа.

---

### 5. Режим лайвкодинга существует только в виде разовых кнопок без persistent toggle
* **Локализация:** `src/pages/app/components/speech/index.tsx:315-344`, `src/pages/app/index.tsx:264-275`
* **Метка:** `[BLOCKS R02]`
* **Суть проблемы:** В панели `speech/index.tsx` функционал кода реализован через независимые кнопки вызова разового действия:
  ```tsx
  <Button onClick={() => answerCodeForLastUtterance?.("plan")}>План</Button>
  <Button onClick={() => answerCodeForLastUtterance?.("full")}>Код</Button>
  <Button onClick={() => answerCodeForLastUtterance?.("full", { screenshot: true })}>Код со скрина</Button>
  ```
  В приложении нет состояния переключателя (toggle), сохраняемого в `localStorage` или общем сторе.
* **Влияние на R02:** Пользователь в R02 прямо сформулировал требование: *«Также хочу еще тумблер лайфкодинг, который я могу включать выключать»*. Без тумблера кандидат вынужден отвлекаться от редактора кода и кликать мышкой по кнопкам интерфейса на каждую реплику интервьюера.
* **Решение для слайса:** Создать `src/lib/answer-mode.ts` со значениями `"interview" | "thought" | "livecode"` и вынести тумблер в тулбар рядом с переключателем длины.

---

### 6. Автоматический пайплайн (`AutoAskManager`) полностью игнорирует режим кода
* **Локализация:** `src/hooks/useSystemAudio.ts:138-152`, `src/lib/auto-ask.ts:109-177`, `src/hooks/useSystemAudio.ts:117-121`
* **Метка:** `[BLOCKS R02]`
* **Суть проблемы:** При завершении реплики собеседника колбэк `dispatchAssembledQuestion` вызывает:
  ```ts
  autoAskManagerRef.current?.dispatchNow(question);
  ```
  В свою очередь `AutoAskManager` при наступлении события вызывает `onDispatch`, который жестко привязан к:
  ```ts
  onDispatch: (question) => {
    void handleTriggerAIRef.current(question, "them");
  }
  ```
  `handleTriggerAIRef` всегда вызывает стандартный `triggerAIForQuestion`, генерирующий устный разговорный ответ.
* **Влияние на R02:** При голосовом лайвкодинге, когда интервьюер озвучивает задачу голосом («Напиши функцию deepClone на TypeScript»), автоматический пайплайн запускает генерацию стандартного монолога без кода, игнорируя лайвкодинг.
* **Решение для слайса:** В точке диспетчеризации (`triggerAIForQuestion` или `useSystemAudio`) проверять текущий `getAnswerMode()`: если включен `livecode`, направлять вопрос в цепочку `triggerCodeAnswer`.

---

### 7. Коллизия промптов: humanizer-опенеры и разговорные правила в коде
* **Локализация:** `src/lib/functions/ai-response.function.ts:194-253, 843`, `src/lib/code-answer.ts:27-40`, `src/hooks/useAIStreaming.ts:358-365`
* **Метка:** `[BLOCKS R02]`
* **Суть проблемы:** В `useAIStreaming.ts` метод `triggerCodeAnswer` формирует специализированный промпт через `buildCodeSystemPrompt(question)`:
  ```ts
  "- Output a single fenced code block with the solution, then a BLANK LINE, then 2-3 SHORT lines of narration..."
  "- No conversational openers, no stories, no markdown headings, no bullet lists."
  ```
  Однако далее в `fetchAIResponse` вызывается `buildEnhancedSystemPrompt(params.systemPrompt, userMessage)`. Эта функция безусловно подмешивает:
  1. Опенеры: `Open with exactly this phrase, then answer: "Ну, смотрите, на самом деле..."`
  2. Лимит длины: `SHORT_LENGTH_PROMPT` (35–55 слов максимум на весь ответ).
  3. Правила хуманизатора первого лица.
* **Влияние на R02:** Модель получает взаимоисключающие инструкции. Вместо чистого кода модель начинает ответ с разговорной вводной фразы («Ну, смотрите, на самом деле...»), а блок кода обрезается из-за попытки уложиться в 35–55 слов.
* **Решение для слайса:** Добавить в `buildEnhancedSystemPrompt` параметр `mode`: если `mode === "livecode"`, не добавлять разговорные опенеры, правила хуманизатора и 35-словный лимит.

---

### 8. Статичная заглушка плана + развал рендера при стриминге незакрытых бэктиков
* **Локализация:** `src/lib/code-answer.ts:63-71`, `src/pages/app/components/speech/SubtitleFeed.tsx:219-229`
* **Метка:** `[BLOCKS R02]`
* **Суть проблемы:**
  1. В `code-answer.ts` функция `buildCodePlan(question)` при отсутствии точного совпадения с одним из 12 жестко зашитых шаблонов возвращает константную статическую строку:
     ```ts
     text: template?.plan ?? "Пишем аккуратно по шагам: сначала каркас, потом детали."
     ```
     Генерация плана через LLM отсутствует.
  2. В `SubtitleFeed.tsx` регулярное выражение в `splitCodeAnswer`:
     ```ts
     const m = text.match(/```(\w*)\n([\s\S]*?)```/);
     ```
     требует **закрывающих** бэктиков ` ``` `. Во время стриминга токенов код еще не закрыт, поэтому регулярка возвращает `null`, и незавершенный код передается в `formatSpokenAnswer(text)`, который схлопывает пробелы и рендерит сломанный текст в обычные параграфы `<p>`.
* **Влияние на R02:** Любая нестандартная задача на лайвкодинге получает бессмысленную заглушку («Пишем аккуратно...») вместо реального плана решения. При стриминге полного решения окно кода прыгает и отображается кашей, пока стрим полностью не завершится.
* **Решение для слайса:** В Stage 1 генерировать план через быстрый стрим LLM при отсутствии шаблона. В `splitCodeAnswer` добавить поддержку незакрытых бэктиков (streaming-tolerant fence parsing).

---

## Раздел II. Баги и архитектурные дефекты пайплайна (8 Pipeline Bugs)

### 9. `[...history].reverse()` отправляет историю диалога задом наперёд в Pluely API
* **Локализация:** `src/lib/functions/ai-response.function.ts:326-328`
* **Метка:** `[BUG]`
* **Суть проблемы:** В функции `fetchPluelyAIResponse` вызов нативного метода `chat_stream_response` сериализует историю:
  ```ts
  history: history.length ? JSON.stringify([...history].reverse().map((msg) => ({
    role: msg.role, content: [{ type: "text", text: msg.content }],
  }))) : undefined,
  ```
  Однако хук `useConversationStore.ts:463-470` (`buildHistory`) уже возвращает массив сообщений в строго **хронологическом** порядке (от старых к новым, что подтверждено тестом `useConversationStore.test.ts:208`).
* **Влияние:** Метод `.reverse()` переворачивает массив так, что самые свежие реплики оказываются в начале, а старые — в конце. Pluely API получает диалог во времени задом наперед. Модель теряет нить разговора в многошаговых интервью и забывает контекст предыдущих вопросов.
* **Триггер:** Задать два связанных вопроса через хостинг Pluely («Что такое Redux?» → «А какие у него минусы?»). Модель во втором ответе не понимает, о чем речь.

---

### 10. Сшитый филлер задержки (перебивка) навсегда оседает в БД истории
* **Локализация:** `src/hooks/useAIStreaming.ts:218-223, 240`
* **Метка:** `[BUG / PITFALL]`
* **Суть проблемы:** Когда приходит первый токен ответа (`firstChunk === true`), в `fullResponse` конкатенируется активный филлер:
  ```ts
  const filler = typeof getActiveFiller === "function" ? getActiveFiller() : null;
  const stitched = filler?.trim() ? filler.trim() + "\n\n" : "";
  fullResponse += stitched;
  buffer += stitched;
  clearFiller();
  ```
  После завершения стрима вызывается:
  ```ts
  addInteraction(transcription, fullResponse, source);
  ```
* **Влияние:** В базу данных SQLite и `localStorage` ответ модели сохраняется вместе с фразой-заглушкой («Секунду, думаю... \n\n Вот решение...»). При последующих запросах `buildHistory` считывает этот грязный ответ и скармливает его обратно в LLM как образец ответов ассистента. С каждой репликой история захламляется мусорными префиксами.
* **Решение:** Сохранять в историю через `addInteraction` чистый ответ модели без префикса `stitched` (филлер должен быть исключительно визуальным артефактом отображения).

---

### 11. Рассинхрон `isAIProcessingRef` через `useEffect` абортит стрим на лету
* **Локализация:** `src/hooks/useSystemAudio.ts:339-341`, `src/hooks/useSystemAudio.ts:118`, `src/hooks/useAIStreaming.ts:130, 153`
* **Метка:** `[RACE CONDITION]`
* **Суть проблемы:** В `useSystemAudio.ts` синхронизация состояния обработки выполнена через пассивный эффект:
  ```ts
  useEffect(() => {
    isAIProcessingRef.current = isAIProcessing;
  }, [isAIProcessing]);
  ```
  Когда `useAIStreaming` начинает запрос, он вызывает `setIsAIProcessing(true)`. Это React state setter, обновление которого происходит асинхронно в следующем тике рендера. До завершения коммита рендера `isAIProcessingRef.current` остается равным `false`.
* **Влияние:** Если в этот момент VAD или сборщик вопросов генерирует новое событие, `isAIProcessing()` возвращает `false`. Срабатывает повторный `handleTriggerAIRef`, который запускает `processWithAI`, где на строке 130 выполняется:
  ```ts
  abortControllerRef.current?.abort();
  ```
  Только что запущенный стрим аварийно прерывается, пользователь видит пустой экран или ошибку «Request aborted».
* **Решение:** Использовать синхронный `useRef` флаг внутри `useAIStreaming` и передавать функцию-геттер наружу без задержки через React re-render.

---

### 12. `pendingScreenshotRef` очищается до запроса — потеря скрина при ошибке
* **Локализация:** `src/hooks/useAIStreaming.ts:176-179, 242-247`
* **Метка:** `[RACE / DATA LOSS]`
* **Суть проблемы:** В `useAIStreaming.ts` перед выполнением запроса скриншот удаляется из рефа:
  ```ts
  if (pendingScreenshotRef.current) {
    pendingScreenshotRef.current = null;
    setPendingScreenshot(null);
  }
  ```
  Это происходит до входа в генератор `fetchAIResponse`.
* **Влияние:** Если провайдер возвращает ошибку (сеть, 401 Unauthorized, 429 Rate Limit, сбой прокси), срабатывает блок `catch`. Скриншот уже стерт. Пользователь нажимает «Повторить» или пытается переключить провайдера, но скриншот безвозвратно потерян, и повторный запрос уходит без контекста экрана.
* **Решение:** Очищать `pendingScreenshotRef` только после успешного получения первого токена (`firstChunk`), а при ошибке сохранять его для возможности retry.

---

### 13. `prompts.join(" ")` склеивает секции промпта пробелом, ломая Markdown
* **Локализация:** `src/lib/functions/ai-response.function.ts:296`
* **Метка:** `[PROMPT PITFALL]`
* **Суть проблемы:** В `buildEnhancedSystemPrompt` массив секций системного промпта соединяется через одиночный пробел:
  ```ts
  return prompts.join(" ");
  ```
* **Влияние:** Секции содержат заголовки Markdown (`# Rules`), списки (`- Item 1`), блоки RAG (`[CONTEXT: MY RESUME]...[/CONTEXT]`) и инструкции по стилю. Склейка через пробел разрушает структуру Markdown-разметки: заголовки сливаются с предыдущим текстом в одну строку, маркированные списки превращаются в сплошной текст. Это ухудшает следование инструкциям современными LLM и провоцирует галлюцинации.
* **Решение:** Использовать соединение через двойной перевод строки: `prompts.join("\n\n")`.

---

### 14. Схема сообщений OpenAI ломает REST-запросы к Google Gemini (HTTP 400)
* **Локализация:** `src/lib/functions/common.function.ts:147-171`, `src/lib/functions/ai-response.function.ts:480-490`
* **Метка:** `[ERROR GAP]`
* **Суть проблемы:** Функция `buildDynamicMessages` подставляет историю `...history` напрямую в массив `messages` или `contents`:
  ```ts
  return [...prefixMessages, ...history, newUserMessage, ...suffixMessages];
  ```
  Элементы `history` имеют формат OpenAI: `{ role: "user" | "assistant", content: string }`. Однако REST API Google Gemini ожидает структуру:
  ```json
  { "role": "user" | "model", "parts": [{ "text": "..." }] }
  ```
* **Влияние:** При использовании прямых шаблонов curl для Google Gemini с историей запросов API Gemini возвращает HTTP 400 Bad Request (`Invalid JSON payload: unknown field 'content'`). Мульти-тур диалог на Gemini полностью ломается.
* **Решение:** В `buildDynamicMessages` или `streamAIResponse` проверять целевой формат провайдера (Gemini vs OpenAI) и трансформировать роли и вложенность полей (`assistant` → `model`, `content` → `parts: [{ text }]`).

---

### 15. Дублирующий резолвинг URL провайдера и спам фонового warm-up на каждом сегменте
* **Локализация:** `src/hooks/useQuestionPipeline.ts:26-55, 187-193`, `src/hooks/useSystemAudio.ts:686`
* **Метка:** `[DEAD CODE / PERF]`
* **Суть проблемы:** В `useQuestionPipeline.ts` объявлена функция `resolveActiveProviderUrl()`, которая синхронно парсит `safeLocalStorage` и выполняет поиск регулярными выражениями по curl-строкам:
  ```ts
  if (!activeProviderUrlRef.current) {
    activeProviderUrlRef.current = resolveActiveProviderUrl();
  }
  const warmUrl = activeProviderUrlRef.current;
  if (warmUrl) {
    void warmProviderConnection(warmUrl).catch(() => {});
  }
  ```
  При этом в `useSystemAudio.ts:686` уже работает специализированный хук `useWarmup`:
  ```ts
  const warmup = useWarmup({ providerUrl: resolveActiveProviderUrl(), modelKey: speechModel.lang });
  ```
* **Влияние:** При каждом промежуточном срабатывании таймера сборщика вопросов (`arm`) запускается неконтролируемый фоновый разогрев соединения, создавая лишнюю нагрузку и дублируя логику `useWarmup`.
* **Решение:** Централизовать прогрев в `useWarmup`, удалив спам вызовами из `useQuestionPipeline`.

---

### 16. Двойное ожидание тишины (Assembler + Manager) добавляет ~1 с задержки
* **Локализация:** `src/lib/question-assembler.ts:74-79`, `src/lib/auto-ask.ts:170-177`, `src/hooks/useQuestionPipeline.ts:167-211`
* **Метка:** `[ASR / LATENCY]`
* **Суть проблемы:** `QuestionAssembler` уже выжидает таймер тишины `flushGapMs` (450 мс в fast mode) перед тем, как признать реплику законченной. Однако после эмита `dispatchAssembledQuestion` передает текст в `AutoAskManager`, где при определенных условиях (если не вызывается `dispatchNow` или взведен `isRepeatOfAsked`) может запуститься повторное ожидание тишины `silenceWindowMs` (еще 1000 мс).
* **Влияние:** Задержка от момента, когда собеседник замолчал, до старта генерации ответа LLM возрастает с оптимальных ~450 мс до 1450–1800 мс. В живом разговоре это воспринимается как неестественная неловкая пауза кандидата.
* **Решение:** Использовать единый источник таймера тишины: раз `QuestionAssembler` уже подтвердил паузу, `AutoAskManager` должен сразу отправлять запрос без повторного наложения таймера.

---

## Архитектурные рекомендации для интеграции (Integrate Wave)

1. **Изоляция режимов ответа:**
   Режим (`"interview" | "thought" | "livecode"`) должен быть единым источником правды (`src/lib/answer-mode.ts`) и передаваться как аргумент первого класса в `buildEnhancedSystemPrompt(base, userMessage, mode)` и `triggerAIForQuestion(question, source, mode)`.
2. **Безопасность истории диалога:**
   Устранить инверсию массива `.reverse()` в Pluely API и отделить стриминговые перебивки (`getActiveFiller()`) от постоянной персистентности в базе данных.
3. **Отказоустойчивость оверлея:**
   Синхронизировать статус генерации через атомарный ref во избежание гонок при прерывании запросов, и не сбрасывать `pendingScreenshotRef` до успешного подтверждения начала ответа провайдером.
