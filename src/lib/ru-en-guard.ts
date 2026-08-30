// Strict RU/EN subtitle guard — mirrors the server-side check in
// pluely-asr (transcribe.rs::text_acceptable). Applied client-side as a
// second layer so non-RU/EN fragments never reach the feed.

export function isRuEnSubtitle(text: string): boolean {
  let rusCyr = 0;
  let badCyr = 0;
  let latin = 0;

  for (const c of text) {
    if (!/\p{L}/u.test(c)) continue;
    if (/[a-zA-Z]/.test(c)) {
      latin++;
      continue;
    }
    const cp = c.codePointAt(0)!;
    if (
      cp === 0x0456 || // і
      cp === 0x0457 || // ї
      cp === 0x0454 || // є
      cp === 0x0491 || // ґ
      cp === 0x04d9 || // ә
      cp === 0x0493 || // ғ
      cp === 0x049b || // қ
      cp === 0x04a3 || // ң
      cp === 0x04e9 || // ө
      cp === 0x04b1 || // ұ
      cp === 0x04af || // ү
      cp === 0x04bb || // һ
      cp === 0x045e // ў
    ) {
      badCyr++;
      continue;
    }
    rusCyr++;
  }

  const total = rusCyr + badCyr + latin;
  if (total < 3) return true; // too short to judge

  if (badCyr > 0) return false;

  if (rusCyr > 0 && latin > 0) {
    const minority = Math.min(rusCyr, latin);
    if (minority / total > 0.25) return false; // mixed-script garbage
  }

  return true;
}
