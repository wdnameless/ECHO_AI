# Tasks: S3 — Честное состояние лицензии и гейты сборки

## T3.1 — Rust: честное состояние
- [x] `src-tauri/src/shortcuts.rs:40` — `LicenseState::default()`: `AtomicBool::new(false)`
- [x] `src-tauri/src/shortcuts.rs:504-508` — `set_license_status`: использовать переданный `has_license`, убрать принудительный `true`, переименовать параметр из `_has_license` в `has_license`
- [x] `src-tauri/src/activate.rs:306-312` — `validate_license_api`: убрать константный `is_active: true`; без серверной валидации возвращать неактивное состояние

## T3.2 — Rust: развязка базовых функций
- [x] `src-tauri/src/shortcuts.rs:651-657` — убрать гейт `LicenseState` из `move_window`: перемещение окна не является платной функцией
- [x] Проверить остальные использования `LicenseState::is_active` и убедиться, что ни одна базовая функция не заблокирована

## T3.3 — Разделение по типу сборки
- [x] Добавить признак сборки (dev/release) для гейтов Pro-возможностей
- [x] В dev-сборке `hasActiveLicense` эффективно `true` (все возможности доступны)
- [x] В release-сборке `hasActiveLicense` отражает реальный entitlement (без серверной валидации → Free)

## T3.4 — Фронтенд: единый источник истины
- [x] `src/contexts/app.context.tsx` — `getActiveLicenseStatus`: не полагаться на фиктивный успех; корректно обрабатывать отсутствие лицензии
- [x] `src/lib/functions/pluely.api.ts` — сохранить кэш 30 с, но не кэшировать фиктивную валидность
- [x] `src-tauri/src/api.rs:1127-1130` — `check_license_status`: не считать лицензию валидной только по наличию файла

## T3.5 — Заглушка оплаты
- [x] `src/components/GetLicense.tsx` — экран апгрейда честно сообщает, что оплата недоступна (placeholder), вместо имитации покупки
- [x] Убрать/нейтрализовать вызов checkout, если он ведёт на нерабочий endpoint

## T3.6 — Тесты
- [x] Rust-тест: `LicenseState::default()` неактивен
- [x] Rust-тест: `set_license_status(false)` оставляет неактивным; `set_license_status(true)` активирует
- [x] Rust-тест: `validate_license_api` не возвращает активную лицензию без серверной валидации
- [x] Frontend-тест: dev-режим открывает Pro-возможности; release-режим закрывает
- [x] Тест: перемещение окна работает при неактивной лицензии

## T3.7 — Верификация
- [x] `cargo test --manifest-path src-tauri/Cargo.toml` — зелёный
- [x] `npm test` — зелёный
- [x] `npm run build` — без ошибок типов
- [x] Смоук dev-сборки: все возможности доступны, окно перемещается
- [x] Смоук release-сборки: Free-возможности работают, Pro показывают экран апгрейда
