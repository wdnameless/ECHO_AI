# Recon: исправление находок аудита #2 и #5

## Что сделано
- `src/lib/host-trust-gate.ts` — добавлен `gatedFetch` (гейт → запрос,
  `maxRedirections: 0` в контракте).
- `src/lib/trusted-hosts.ts` — `BUILT_IN_SERVICE_HOSTS` + `isBuiltInServiceHost`:
  собственные хосты приложения (поиск, перевод) не поднимают диалог, а
  пользовательские по-прежнему гейтятся.
- `src/lib/web-search.ts` — три провайдера через `gatedFetch`; **ключ Tavily
  перенесён из тела запроса в заголовок** `Authorization: Bearer` (гейт умеет
  вырезать только заголовки, ключ в теле прошёл бы мимо `without-secrets`).
- `src/lib/fast-translator.ts` — оба пути через `gatedFetch`.
- `src/pages/dev/components/ai-configs/Providers.tsx` — кнопка Test через `gatedFetch`.
- `src/hooks/useConversationStore.ts` — cleanup дебаунса теперь выполняет
  отложенную запись вместо её отмены.

## Проверка (снятие фикса → падение)
- старый cleanup → `expected "vi.fn()" to be called at least once` (записи не было вовсе);
- недоверенный хост без обработчика → запрос не уходит (fail closed);
- удаление заголовка с ключом Brave → тест на ключевой поиск падает;
- `isBuiltInServiceHost("https://api.openai.com.evil.example/x")` → `false`.

## Факты, установленные по источникам
- Tavily поддерживает `Authorization: Bearer <key>` — проверено по их OpenAPI
  (`securitySchemes.bearerAuth`), а не по памяти.
- `HostTrustProvider` смонтирован в `main.tsx:46`, поэтому гейт в приложении
  всегда имеет обработчик и не превращается в fail-closed для всей сети.

482 теста, `tsc --noEmit` чисто, версия 1.2.22.
