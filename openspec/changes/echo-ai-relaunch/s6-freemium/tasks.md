# Tasks: S6 — Freemium: разделение Free и Pro

## T6.1 — Реестр возможностей
- [x] Создать `src/lib/entitlements.ts`:
  - перечисление возможностей (`FEATURES`) с явной принадлежностью тарифу `free` | `pro`
  - `canUseFeature(feature, context): boolean` — единая точка проверки доступа
  - учёт типа сборки: dev открывает всё, release применяет тариф
- [x] Free: `dictation`, `meeting`, `localStt`, `byoKey`, `chatHistory`, `customPrompts`
- [x] Pro: `hostedApi`, `screenshot`, `selectionMode`, `themes`, `fonts`, `customShortcuts`, `promptGeneration`, `analytics`, `responseLength`, `language`, `autoScroll`

## T6.2 — Снятие гейтов с Free-ядра
- [x] `src/pages/chats/components/View.tsx:239-311` — убрать оверлей пейволла, разблокировать инпут, аудио и кнопку отправки
- [x] `src/pages/chats/components/View.tsx:273,288` — гейт файлов и скриншотов заменить на проверку Pro-возможности (не лицензии вообще)
- [x] `src/pages/system-prompts/PluelyPrompts.tsx:255-283` — библиотека промптов доступна без лицензии
- [x] `src/pages/responses/index.tsx:17` — убрать общий блокирующий баннер Premium, оставив гейты только на Pro-контролах
- [x] `src/pages/app/components/speech/index.tsx:223` — screenshot остаётся Pro, но проверка идёт через реестр

## T6.3 — Приведение гейтов к реестру
- [x] `src/hooks/useChatCompletion.ts:747` — Selection Mode через `canUseFeature`
- [x] `src/pages/settings/components/Theme.tsx` — тема и прозрачность через реестр
- [x] `src/pages/shortcuts/components/shortcuts/ShortcutManager.tsx:209` — кастомные шорткаты через реестр
- [x] `src/pages/system-prompts/Generate.tsx:103` — генерация промптов через реестр
- [x] `src/pages/dashboard/index.tsx:17-43` — аналитика через реестр
- [x] `src/pages/responses/components/ResponseLength.tsx:42`, `LanguageSelector.tsx:46`, `AutoScrollToggle.tsx:47` — настройки ответа через реестр
- [x] Убрать прямые проверки `hasActiveLicense` из UI там, где они заменены реестром

## T6.4 — Экран апгрейда
- [x] Компонент `UpgradePrompt` (или переработка `src/components/GetLicense.tsx`): объясняет, что возможность входит в Pro, и что оплата пока недоступна
- [x] Возможность остаётся видимой, но неактивной с понятным объяснением — не исчезает и не выглядит сломанной
- [x] Экспорт из `src/components/index.ts`

## T6.5 — Тесты
- [x] Тест реестра: каждая возможность имеет корректный тариф
- [x] Тест dev-режима: все возможности доступны
- [x] Тест release-режима: Free доступны, Pro закрыты
- [x] Тест Free-ядра: при неактивной лицензии диктовка, встреча, локальный STT, BYO-key, история, свои промпты доступны
- [x] Тест Pro-гейта: при неактивной лицензии Pro-возможность сообщает о недоступности

## T6.6 — Верификация
- [x] `npm test` — зелёный
- [x] `npm run build` — без ошибок типов
- [x] Смоук release-сборки: полный Free-сценарий (диктовка → распознавание → ответ через свой ключ → история чатов)
- [x] Смоук: Pro-возможность показывает экран апгрейда с честным сообщением об оплате
