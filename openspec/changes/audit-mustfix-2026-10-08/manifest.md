# Audit Must-Fix — requirements manifest

Wave 0: skipped — all 5 items are unambiguous bugfixes with behavior defined by audit evidence; no user forks.

| ID | Verbatim user quote | Status | Required observable behavior |
|---|---|---|---|
| R01 | "Чинить по порядку 1→5?" / "да" (п.1: перевёрнутая история в Pluely API) | in-spec | Hosted Pluely API получает историю в хронологическом порядке; мультишаг-диалог не теряет контекст. |
| R02 | "да" (п.2: филлер навсегда в истории) | in-spec | Перебивка не попадает в SQLite/историю промптов; только визуальный артефакт. |
| R03 | "да" (п.3: гонка записи секретов) | in-spec | Параллельные сохранения не теряют ключи; запись атомарна, обрыв не корраптит файл. |
| R04 | "да" (п.4: turn-gate застревает) | in-spec | Кнопка «ответить всё равно» исчезает после любой диспетчеризации; мёртвый дубль удалён. |
| R05 | "да" (п.5: голодание HTTP-транскрипции) | in-spec | `withNoStream` не получает ложный «model busy» при быстрой смене каналов. |
