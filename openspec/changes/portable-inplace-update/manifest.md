# Manifest: портативная версия обновляется in-place

## R01 — CI публикует portable-зип как цель обновления
- Quote: "Я хочу чтобы портативная версия обновлялась без проблем"
- Change: `release.yml` пишет `windows-x86_64-portable` (`url` = zip, `signature` = `.zip.sig`) в `latest.json` через tauri-action archives
- Evidence: `latest.json` содержит ключ `windows-x86_64-portable` после релиза

## R02 — портативка ставится из зипа поверх себя, данные целы
- Quote: "Я хочу чтобы портативная версия обновлялась без проблем"
- Change: `Updater`/`UpdateSettings`: если `useIsPortable()` — скачать zip, распаковать поверх exe-dir (кроме `.echo-ai/`), relaunch; `.echo-ai/` (модели, настройки, движок) не трогается
- Evidence: тест: моки `getPaths` portable + фейк-архив → файлы заменены, `.echo-ai/` нетронут

## R03 — обычная установка идёт старым путём
- Quote: "Я хочу чтобы портативная версия обновлялась без проблем"
- Change: не-портативная копия вызывает `update.downloadAndInstall()` + `relaunch()` как раньше
- Evidence: существующие тесты updater зелёные, поведение не менялось

## R04 — предупреждение остаётся как страховка
- Quote: "Я хочу чтобы портативная версия обновлялась без проблем"
- Change: `PortableUpdateNotice` остаётся, текст обновлён: кнопка теперь обновляет in-place
- Evidence: текст не врёт про "установит обычную копию"
