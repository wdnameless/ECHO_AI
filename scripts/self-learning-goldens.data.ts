export interface GoldenTestCase {
  id: string;
  name: string;
  category:
    | "tone"
    | "length"
    | "lists"
    | "filler_words"
    | "stack_fact"
    | "no_fabricated_facts";
  question1: string;
  answer1: string;
  feedback?: {
    rating: "like" | "dislike";
    reason?: string;
  };
  manualFact?: {
    fact: string;
    category?: "background" | "stack" | "role" | "preference" | "general";
  };
  question2: string;
  expectedInPromptBlock: string[];
  forbiddenInPromptBlock?: string[];
  description: string;
}

export const GOLDEN_TEST_CASES: GoldenTestCase[] = [
  {
    id: "case-1-tone",
    name: "Адаптация тональности при жалобе на сухость",
    category: "tone",
    question1: "Как устроена репликация в PostgreSQL?",
    answer1:
      "Репликация осуществляется посредством передачи WAL-записей через протокол потоковой передачи данных.",
    feedback: {
      rating: "dislike",
      reason: "слишком сухо и как робот",
    },
    question2: "Что такое connection pooling?",
    expectedInPromptBlock: ["живой и тёплый, как разговор с коллегой"],
    description:
      "Дизлайк с причиной «сухо/робот» переключает тональность на живую и тёплую",
  },
  {
    id: "case-2-length",
    name: "Сокращение объёма при жалобе на длинный ответ",
    category: "length",
    question1: "Что такое индекс B-Tree?",
    answer1:
      "B-дерево — это сбалансированное дерево поиска. Оно хранит ключи в отсортированном порядке... (очень длинный абзац)",
    feedback: {
      rating: "dislike",
      reason: "слишком длинно, много воды",
    },
    question2: "Зачем нужен WAL?",
    expectedInPromptBlock: ["Максимально краткий", "БЕЗ ЛИШНЕЙ ВОДЫ"],
    description:
      "Дизлайк с причиной «длинно/вода» переключает preferredLength на concise",
  },
  {
    id: "case-3-lists",
    name: "Запрет списков при замечании на перечисления",
    category: "lists",
    question1: "Какие уровни изоляции транзакций существуют?",
    answer1:
      "1. Read Uncommitted 2. Read Committed 3. Repeatable Read 4. Serializable",
    feedback: {
      rating: "dislike",
      reason: "нумерованные списки",
    },
    question2: "Что такое ACID?",
    expectedInPromptBlock: ["нумерованные списки"],
    description:
      "Дизлайк с замечанием на списки добавляет ограничение в avoidPatterns",
  },
  {
    id: "case-4-filler-words",
    name: "Запрет вводных слов при жалобе на шаблонные зачины",
    category: "filler_words",
    question1: "Почему падает стек при рекурсии?",
    answer1:
      "Ну, итак, давайте разберёмся, стек переполняется из-за отсутствия базового случая.",
    feedback: {
      rating: "dislike",
      reason: "вводные слова",
    },
    question2: "Что такое хвостовая рекурсия?",
    expectedInPromptBlock: ["без вводных слов"],
    description:
      "Дизлайк на вводные слова добавляет правило начинать прямо с сути",
  },
  {
    id: "case-5-stack-fact",
    name: "Запоминание стека пользователя",
    category: "stack_fact",
    question1: "Какой стек я использую?",
    answer1: "Пока не знаю ваш стек.",
    manualFact: {
      fact: "Основной стек: TypeScript, React, Rust, PostgreSQL, Tailwind",
      category: "stack",
    },
    question2: "Как оптимизировать сборку?",
    expectedInPromptBlock: [
      "TypeScript, React, Rust, PostgreSQL, Tailwind",
    ],
    description:
      "Ручное добавление факта о стеке немедленно отражается в базе знаний промпта",
  },
  {
    id: "case-6-no-fabricated-facts",
    name: "Честный пустой профиль без выдуманных фактов",
    category: "no_fabricated_facts",
    question1: "Привет, кто я?",
    answer1: "Привет!",
    question2: "Расскажи обо мне",
    expectedInPromptBlock: [],
    forbiddenInPromptBlock: [
      "Senior Software Engineer",
      "Team Lead",
      "fact-init-1",
      "fact-init-2",
    ],
    description:
      "При отсутствии фактов профиль не выдумывает опыт и роли (R01/R03/R09i)",
  },
];
