# Tasks: Dashboard White Screen Fix & Main Window Adaptability

- [x] 1. Перевести роутинг на `HashRouter` в `src/routes/index.tsx`
- [x] 2. Обновить вызов создания окна Dashboard в `src-tauri/src/window.rs` на чистый `index.html` + роутинг по window label
- [x] 3. Обернуть корневой рендер окон в `src/main.tsx` в `ErrorBoundary`
- [x] 4. Увеличить дефолтную ширину главного окна в `src-tauri/tauri.conf.json` до 680px
- [x] 5. Обеспечить адаптивность инпута в `src/pages/app/components/completion/Input.tsx` (устранить обрезку "Ask me anything...")
- [x] 6. Прогнать тесты и пересобрать релизный бинарник `pluely.exe`
- [x] 7. Проверить запуск и открытие Dashboard окна без белого экрана
