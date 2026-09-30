# Interfaces: границы и владельцы

## VAD-пресеты (UI+движок, владелец: audio)
- `SENSITIVITY_PRESETS`: studio / office / noisy — по 4 поля
  (sensitivity_rms, peak_threshold, noise_gate_threshold, min_speech_chunks).
  Матч пресета — по 4 полям (min_speech точным равенством).
- Advanced-слайдеры: Sensitivity (есть), Silence (min 8 — был 20, дефолт 12
  невосстановим), Noise Gate (есть), **Min Speech 3–15** (новый).
- `handleResetDefaults` — из `DEFAULT_VAD_CONFIG`, не хардкод.
- Инвариант пары: gate вниз + min_speech вниз (Studio) или оба вверх (Noisy);
  gate в ноль отдельным слайдером запрещён (min 0 оставлен, но пресет туда
  не ведёт; подсказка объясняет «Yeah»-риск).

## Хоткей lang_switch (ввод, владелец: audio)
- `DEFAULT_SHORTCUT_ACTIONS` += `lang_switch` (ctrl+shift+l везде) → Rust
  `custom-shortcut-triggered` → `useSystemAudioKeyboard.onLangSwitch` →
  тогл `speechModel.lang`. Тот же `switchTo` с локом `switching`.
- Слияние конфигов (`getShortcutsConfig` merge defaults) подхватывает новый
  хоткей без миграций.

## Кванты (модели, владелец: audio)
- `MODEL_BY_LANG`: ru `{ Q8 }`, en `{ Q4_K_M }`. Выбор файла: want.quant →
  Q8 → первый. RU без Q4 в списке — осознанно (каталог Q4 для TDTv3 имеет,
  но WER-приоритет выше экономии).
- `downloadModel(id, quant)` уже умеет квант — докачка из Моделей.

## Каданс (движок, владелец: audio)
- `LIVE_BATCH_MS` 300→250. Охрана: `liveBusyRef` дропает наложение;
  `LIVE_MAX_UTTERANCE_MS` режет хвост; финальный batch-путь полный.
