# Interfaces: границы и владельцы

## `PORTABLE_UPDATE_TARGET` + `checkForUpdateForLayout` (фронт, владелец: updater)
- `PORTABLE_UPDATE_TARGET = "windows-x86_64-portable"` — MUST совпадать с ключом,
  который CI пишет в `latest.json`. Расхождение = `TargetNotFound`, обновление
  молча не находится (fail-closed со стороны updater).
- `checkForUpdateForLayout(isPortable)`: portable → `check({ target })`,
  installed → `check()`. Единая точка; оба места (бар, настройки) её используют.
- Установка обеих веток — `update.downloadAndInstall()` + `relaunch()`: у zip
  плагин извлекает exe/msi из архива сам (feature `zip` в default).

## `release.yml` (CI, владелец: release-инфра)
- Порядок: `Build portable archive` → `Sign portable archive` → `Build & Publish`
  (tauri-action с `includeArchives: zip;zip.sig`) → `Upload portable archive`
  (zip + sig через `--clobber`).
- Подпись: `tauri signer sign` тем же `TAURI_SIGNING_PRIVATE_KEY`, что MSI/NSIS.
  Updater сверяет байты zip с подписью из `latest.json` (minisign, fail-closed).

## `useIsPortable` / `PortableUpdateNotice` (UI, владелец: updater)
- Источник: `getPaths().root_kind === "portable"`. Неизвестная раскладка =
  обычная установка (не угадывать).
- Текст обещает in-place с сохранением `.echo-ai/` — и кнопка это делает.
