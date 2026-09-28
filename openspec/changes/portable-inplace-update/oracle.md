# Oracle: приёмка portable-inplace-update

## Verdict: ACCEPT

Проверено на текущем дереве:

1. `check({ target })` проброшен из JS в Rust (`commands.rs:48-65` →
   `builder.target()`, `updater.rs:269-271`): таргет переопределяет ключ
   `platforms` в `latest.json`. Дефолт untouched для installed-копий.
2. Zip-установка — штатный путь плагина (feature `zip` в default,
   `extract_zip` извлекает exe/msi, `verify_signature` minisign fail-closed),
   а не ручная распаковка: файл под замком ОС обрабатывает сам плагин через
   temp-dir, а не фронт.
3. `tsc --noEmit` чист; `PortableUpdateNotice.test.tsx` 5/5
   (таргет portable/default + текст + молчание для installed + fallback);
   полный сьют **523/523** (70 файлов).
4. CI-порядок корректен: архив → подпись → publish с `includeArchives`
   (zip попадает в `latest.json` как подписанный таргет) → upload zip+sig.
5. Флаг `updaterJsonKeepUniversal: false` осознанно не стирает MSI/NSIS:
   universal-ключ `windows-x86_64` остаётся для installed-копий, добавляется
   только `windows-x86_64-portable`.

Остаточный риск (честно): первый релиз с новым ключом надо глазами проверить
в `latest.json` (есть ли `windows-x86_64-portable` с подписью) — до этого
портативка будет говорить "обновлений нет", а не ломаться.
