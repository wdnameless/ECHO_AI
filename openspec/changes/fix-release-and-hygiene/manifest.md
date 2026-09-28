# Manifest: чинить по порядку (релиз, версия, вес, R04–R09, гигиена)

## R01 — гонка релизов устранена
- Quote: "Чини все по порядку"
- Change: `concurrency: group: release, cancel-in-progress: false` в `release.yml:22-24`
- Evidence: два рана (тег + merge) больше не проходят `gh release create` параллельно

## R02 — `--verify-tag` убран
- Quote: "Чини все по порядку"
- Change: `release.yml:185-190` — `gh release create` без `--verify-tag`, тег минтится через API
- Evidence: веточный пуш с новой версией больше не падает после полной сборки

## R03 — единый источник версии
- Quote: "Единый источник версии. Сейчас 1.2.27 в трёх файлах руками"
- Change: `scripts/bump-version.mjs` — истина в `tauri.conf.json`, синк в `package.json` + `Cargo.toml` (только `[package]`)
- Evidence: smoke `9.9.9` в трёх файлах, затем restore; `tsc` + 511 тестов зелёные

## R04 — вес репо под контролем
- Quote: "Вес репо: .git 1.1 ГБ, resources/ 773 МБ"
- Change: `.gitignore` — точный путь 751-МБ `.gguf`, `/backups/`, `asr-port`; движок (`pluely-asr.exe` + ggml) остаётся tracked осознанно (`include_bytes!`, `embedded.rs:24-76` + `CHECKSUMS.sha256`)
- Evidence: `git status` чист от тяжёлых файлов; история не переписывалась (LFS-миграция отложена)

## R05 — R04–R09 аудита закрыты кодом
- Quote: "R04-R09 кодовые фиксы"
- Change: все шесть уже в коде, помечены в `audit-architecture-and-bugs/tasks.md:8-14`
- Evidence: 65 тестов (selected-stt, mic/them WS, flush, gated-fetch, gateway, web-search-secrets, host-trust-gate) + полный сьют 511/511 зелёный

## R06 — гигиена веток
- Quote: "Гигиена веток"
- Change: удалены 13 локальных + 6 remote (все `ahead=0 IN master` или с преемником в мастере); оставлены `feat/filler-removal` (fa87356, реальный уникальный diff) и `origin/fix/portable-update-notice` (2987181, PortableUpdateNotice отсутствует в мастере)
- Evidence: `git ls-remote --heads` показывает только `master`, `fix/asr-language-batch`, `fix/portable-update-notice`
