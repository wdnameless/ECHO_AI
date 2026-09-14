# Tasks: S6 — Freemium: разделение Free и Pro

## T6.1 — Реестр возможностей
- [ ] Создать `src/lib/entitlements.ts`:
  - перечисление возможностей (`FEATURES`) с явной принадлежностью тарифу `free` | `pro`
  - `canUseFeature(feature, context): boolean` — единая точка проверки доступа
  - учёт типа сборки: dev открывает всё, release применяет тариф
- [ ] Free: `dictation`, `meeting`, `localStt`, `byoKey`, `chatHistory`, `customPrompts`
- [ ] Pro: `hostedApi`, `screenshot`, `selectionMode`, `themes`, `fonts`, `customShortcuts`, `promptGeneration`, `analytics`, `responseLength`, `language`, `autoScroll`

## T6.2 — Снятие гейтов с Free-ядра
- [ ] `src/pages/chats/components/View.tsx:239-311` — убрать оверлей пейволла, разблокировать инпут, аудио и кнопку отправки
- [ ] `src/pages/chats/components/View.tsx:273,288` — гейт файлов и скриншотов заменить на проверку Pro-возможности (не лицензии вообще)
- [ ] `src/pages/system-prompts/PluelyPrompts.tsx:255-283` — библиотека промптов доступна без лицензии
- [ ] `src/pages/responses/index.tsx:17` — убрать общий блокирующий баннер Premium, оставив гейты только на Pro-контролах
- [ ] `src/pages/app/components/speech/index.tsx:223` — screenshot остаётся Pro, но проверка идёт через реестр

## T6.3 — Приведение гейтов к реестру
- [ ] `src/hooks/useChatCompletion.ts:747` — Selection Mode через `canUseFeature`
- [ ] `src/pages/settings/components/Theme.tsx` — тема и прозрачность через реестр
- [ ] `src/pages/shortcuts/components/shortcuts/ShortcutManager.tsx:209` — кастомные шорткаты через реестр
- [ ] `src/pages/system-prompts/Generate.tsx:103` — генерация промптов через реестр
- [ ] `src/pages/dashboard/index.tsx:17-43` — аналитика через реестр
- [ ] `src/pages/responses/components/ResponseLength.tsx:42`, `LanguageSelector.tsx:46`, `AutoScrollToggle.tsx:47` — настройки ответа через реестр
- [ ] Убрать прямые проверки `hasActiveLicense` из UI там, где они заменены реестром

## T6.4 — Экран апгрейда
- [ ] Компонент `UpgradePrompt` (или переработка `src/components/GetLicense.tsx`): объясняет, что возможность входит в Pro, и что оплата пока недоступна
- [ ] Возможность остаётся видимой, но неактивной с понятным объяснением — не исчезает и не выглядит сломанной
- [ ] Экспорт из `src/components/index.ts`

## T6.5 — Тесты
- [ ] Тест реестра: каждая возможность имеет корректный тариф
- [ ] Тест dev-режима: все возможности доступны
- [ ] Тест release-режима: Free доступны, Pro закрыты
- [ ] Тест Free-ядра: при неактивной лицензии диктовка, встреча, локальный STT, BYO-key, история, свои промпты доступны
- [ ] Тест Pro-гейта: при неактивной лицензии Pro-возможность сообщает о недоступности

## T6.6 — Верификация
- [ ] `npm test` — зелёный
- [ ] `npm run build` — без ошибок типов
- [ ] Смоук release-сборки: полный Free-сценарий (диктовка → распознавание → ответ через свой ключ → история чатов)
- [ ] Смоук: Pro-возможность показывает экран апгрейда с честным сообщением об оплате
