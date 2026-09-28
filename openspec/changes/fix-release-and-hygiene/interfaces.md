# Interfaces: границы и владельцы

## `.github/workflows/release.yml` (CI, владелец: release-инфра)
- Вход: `push tags v* | branches master/main`, `workflow_dispatch`.
- `check` → outputs `should_release: bool`, `version: X.Y.Z` (из `tauri.conf.json`).
- `Ensure release exists (PAT)`: `gh release view v<ver> || gh release create v<ver>`
  (без `--verify-tag`), нужен secret `RELEASE_PAT`.
- `tauri-action`: `tagName: v__VERSION__` — версия подставляется экшеном.
- Инвариант: один ран за раз (`concurrency.group: release`).

## `scripts/bump-version.mjs` (DX, владелец: мейнтейнер)
- Сигнатура: `node scripts/bump-version.mjs <X.Y.Z>` (строго semver, иначе exit 1).
- Пишет: `tauri.conf.json.version` → `package.json.version` →
  `Cargo.toml [package] version` (первая строка `^version =`).
- НЕ трогает версии зависимостей (`tauri = { version = "2" }` и т.п.).

## `src/lib/host-trust-gate.ts :: gatedFetch` (безопасность, владелец: сеть)
- Сигнатура: `gatedFetch(url, { method, headers, body, signal }?, fetchImpl?)`.
- Потребители: `web-search`, `fast-translator` (оба пути), `fetchProviderModels`
  (кнопка Test), `ai-response`, `models`, `stt`.
- Fail-closed: без обработчика подтверждения — throw, запрос не уходит.

## `src-tauri/src/embedded.rs :: ENGINE_ASSETS` (дистрибуция, владелец: Rust)
- Вшивает `pluely-asr.exe` + 14 DLL через `include_bytes!`; модель `.gguf` НЕ вшита.
- Целостность — `src-tauri/resources/CHECKSUMS.sha256` (CI-шаг `Verify engine resources`).
