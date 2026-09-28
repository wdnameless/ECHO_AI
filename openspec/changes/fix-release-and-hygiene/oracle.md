# Oracle: приёмка слайса fix-release-and-hygiene

## Verdict: ACCEPT

Проверено на текущем дереве (все команды выполнены, вывод наблюдался):

1. `release.yml:22-24` — `concurrency: group: release, cancel-in-progress: false`
   на месте; `verify-tag` остался только в комментарии-объяснении (строка 189).
   Структура `if view/edit else create/fi` восстановлена (строки 179-191).
2. `scripts/bump-version.mjs` — smoke `9.9.9` записал версию в три файла
   (`tauri.conf.json`, `package.json`, `Cargo.toml [package]`), затем restore.
   Зависимости (`tauri = { version = "2" }`) не задеты (якорь `^version =`).
3. `.gitignore:53-57` — 751-МБ `.gguf`, `/backups/`, `asr-port` игнорируются;
   `git status` больше их не показывает.
4. R04–R09: 8 файлов / 65 тестов зелёные, затем полный сьют **69 файлов /
   511 тестов — все passed**, `tsc --noEmit` RC=0.
5. Ветки: 13 локальных + 6 remote удалены; `git ls-remote --heads` =
   `master`, `fix/asr-language-batch`, `fix/portable-update-notice`.
   Оставленные `feat/filler-removal` (fa87356) и `portable-update-notice`
   (2987181) имеют уникальные diff, зафиксированы как следующие слайсы.

Гэпов нет: каждый пункт плана либо изменён в коде, либо доказан тестами,
либо осознанно отложен (LFS-миграция, cherry-pick филлеров).
