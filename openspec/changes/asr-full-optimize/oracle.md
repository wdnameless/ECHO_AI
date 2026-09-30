# Oracle: приёмка asr-full-optimize

## Verdict: ACCEPT

Проверено на текущем дереве:

1. R01: пресеты studio/office/noisy с парой gate+min_speech; матч по 4 полям;
   Min Speech слайдер 3–15; silence min 8 (дефолт 12 восстановим); reset из
   `DEFAULT_VAD_CONFIG`. Лестница чувствительности — в тесте (gate и
   min_speech монотонны, studio gate > 0).
2. R02: `lang_switch` в дефолтах хоткеев (все 3 ОС); регистрация через
   custom-shortcut канал с cleanup; тогл через тот же `switchTo` (лок
   `switching` игнорит даблклики).
3. R03: EN ищет Q4-файл, fallback Q8; RU строго Q8. Логика выбора — в тесте
   (Q4 есть → Q4; нет → Q8). `InstalledModel.quant` в каталоге есть.
4. R04: `LIVE_BATCH_MS` 250 с обновлённым комментом-замером; silence 12 и
   flushGap не тронуты (подтверждено диффом).
5. `tsc` чист; полный сьют **544/544** (73 файла, +3 vad-presets).

Остаточный риск (честно): 250мс на слабом CPU — дропы проходов через
liveBusyRef (текст реже, не сломан); Studio-пресет на шумной кухне вернёт
галлюцинации (пресет подписан честно). Q4 EN не замерен живьём — WER-дельта
по данным Parakeet, не нашим прогоном.
