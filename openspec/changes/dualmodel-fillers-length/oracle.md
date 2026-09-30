# Oracle: приёмка dualmodel-fillers-length

## Verdict: ACCEPT

Проверено на текущем дереве:

1. R01: сегмент RU/EN в тулбаре рядом с Авто/Вручную; `switchTo` делает
   `selectModel` + `setAsrLanguage` + сброс кэшей (внутри selectModel);
   без файла — CTA; лок `switching`. Voxtral RU — честно тяжёлый (2.6+ ГБ),
   fallback описан в proposal (batch Parakeet-TDT с пином ru).
2. R02: filler сшивается первой строкой (`filler + "\n\n"` в fullResponse и
   буфер); `clearFiller` чистит состояние. Тест useAIStreaming 10/10 после
   починки двух внесённых багов (dropped `fullResponse += chunk`; flush
   терял сшивку — оба найдены разбором диффа, не гаданием).
3. R03: `resolveAnswerLength` — префикс > тулбар > эвристика; префикс
   вычищается; interview-кап заменён динамикой. 5/5 answer-length тестов.
4. R04: 12+12 заходов, ротация без повтора (30 пиков в тесте), `""` = без
   захода; hardcoded «Ну, смотрите» из промптов убран.
5. `tsc` чист; полный сьют **541/541** (72 файла).

Остаточный риск (честно): Voxtral 4B на слабом железе может не влезть —
проверяется только живой загрузкой модели, не тестами. RU-сегмент без
скачанного Voxtral покажет CTA — это и задумано.
