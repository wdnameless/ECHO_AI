# Tasks: S2 — Контроль исходящих запросов и защита ключей

## T2.1 — Реестр доверенных хостов
- [ ] Создать `src/lib/trusted-hosts.ts`:
  - извлечение host из curl-шаблона (`url`, `headers`, `body`) с обработкой подстановок `{{VAR}}`
  - localhost (`127.0.0.1`, `localhost`) — доверенные всегда
  - хост выбранного провайдера — доверенный автоматически
  - подтверждённые пользователем хосты хранятся в localStorage и переиспользуются
- [ ] Публичный API: `isTrustedHost(url)`, `getHostOfCurlTemplate(curl)`, `trustHost(host)`, `getTrustedHosts()`

## T2.2 — Диалог подтверждения
- [ ] Компонент `src/components/TrustHostDialog/index.tsx`: показывает host, назначение запроса и список секретов, которые будут отправлены
- [ ] Действия: «Доверять и отправить» (запоминает хост), «Отправить без ключа», «Отмена»
- [ ] Экспорт из `src/components/index.ts`

## T2.3 — Перехват на уровне отправки
- [ ] `src/lib/functions/ai-response.function.ts`: перед `tauriFetch` проверять host через `isTrustedHost`; при незнакомом — запрашивать подтверждение; при отказе не добавлять заголовки авторизации
- [ ] `src/lib/functions/stt.function.ts`: та же проверка для STT-запросов
- [ ] `src/lib/functions/custom-stt.function.ts` и `custom-provider.function.ts`: та же проверка

## T2.4 — Сужение capability
- [ ] `src-tauri/capabilities/default.json` и `cross-platform.json`: заменить `http://**`/`https://**` на явные домены провайдеров + localhost
- [ ] `src-tauri/src/lib.rs`: настроить runtime-scope для хостов, подтверждённых пользователем
- [ ] Проверить, что Ollama/LMStudio на localhost и локальный сайдкар продолжают работать

## T2.5 — Тесты
- [ ] Юнит-тест `src/lib/__tests__/trusted-hosts.test.ts`:
  - host корректно извлекается из curl с подстановками и без
  - localhost распознаётся как доверенный
  - чужой хост требует подтверждения
  - после `trustHost` хост считается доверенным
- [ ] Тест на отсутствие заголовков авторизации при отказе

## T2.6 — Верификация
- [ ] `npm test` — зелёный
- [ ] `npm run build` — без ошибок типов
- [ ] Смоук: запрос к настроенному провайдеру проходит без диалога
- [ ] Смоук: шаблон с чужим хостом вызывает диалог; при отказе ключ не отправлен
