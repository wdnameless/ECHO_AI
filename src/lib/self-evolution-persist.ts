import { getDatabase } from "@/lib/database/config";
import {
  getUserStylePreferences,
  saveUserStylePreferences,
  getFeedbackLog,
  type FeedbackEntry,
  type UserStylePreference,
} from "@/lib/storage/user-facts";

/**
 * Self-Evolution durability layer.
 *
 * SQLite is the durable TRUTH for what was learned; localStorage is the
 * synchronous write-through CACHE used by render paths (settings page, the
 * 🧠 stats popover). The prompt assembly path reads the DB first via
 * getStyleFromDbOrCache() (400ms timeout guard, cache fallback), and on
 * startup, if localStorage was cleared (WebView storage wipe, reinstall),
 * the learned state is restored FROM the database. This makes self-evolution
 * effectively unbounded-learning + crash-proof.
 */

/** Mirror the current style profile into SQLite (fire-and-forget). */
export async function mirrorStyle(style: UserStylePreference): Promise<void> {
  try {
    const db = await getDatabase();
    await db.execute(
      `INSERT INTO se_style (id, tone, preferred_length, favorite_patterns, avoid_patterns, custom_rules, updated_at)
       VALUES (1, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         tone = excluded.tone,
         preferred_length = excluded.preferred_length,
         favorite_patterns = excluded.favorite_patterns,
         avoid_patterns = excluded.avoid_patterns,
         custom_rules = excluded.custom_rules,
         updated_at = excluded.updated_at`,
      [
        style.tone,
        style.preferredLength,
        JSON.stringify(style.favoritePatterns),
        JSON.stringify(style.avoidPatterns),
        JSON.stringify(style.customRules),
        Date.now(),
      ]
    );
  } catch {
    /* durability mirror is best-effort */
  }
}

/** Mirror one feedback entry into SQLite (fire-and-forget). */
export async function mirrorFeedback(entry: FeedbackEntry): Promise<void> {
  try {
    const db = await getDatabase();
    await db.execute(
      `INSERT OR REPLACE INTO se_feedback_log
       (id, question, response, rating, reason, topic, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.id,
        entry.question,
        entry.response,
        entry.rating,
        entry.reason ?? null,
        entry.topic ?? null,
        entry.timestamp,
      ]
    );
  } catch {
    /* best-effort */
  }
}

/**
 * Startup restore: if the WebView storage was cleared (localStorage empty or
 * has fewer feedback entries than SQLite), restore the learned state from
 * the durable mirror. Idempotent — safe to call on every app start.
 */
export async function restoreSelfEvolution(): Promise<void> {
  try {
    const db = await getDatabase();

    const dbLog = await db.select<
      Array<{
        id: string;
        question: string;
        response: string;
        rating: string;
        reason: string | null;
        topic: string | null;
        timestamp: number;
      }>
    >("SELECT * FROM se_feedback_log ORDER BY timestamp DESC");

    const localLog = getFeedbackLog();

    // Restore feedback log if SQLite holds more history than localStorage
    // (localStorage was cleared or lost).
    if (dbLog.length > localLog.length) {
      const restored: FeedbackEntry[] = dbLog.map((r) => ({
        id: r.id,
        question: r.question,
        response: r.response,
        rating: r.rating as "like" | "dislike",
        reason: r.reason ?? undefined,
        topic: r.topic ?? undefined,
        timestamp: r.timestamp,
      }));
      // Persist back into localStorage via the existing API.
      const { saveFeedbackLog } = await import("@/lib/storage/user-facts");
      saveFeedbackLog(restored);
    }

    // Restore style profile if localStorage lost it but SQLite has learning.
    const localStyle = getUserStylePreferences();
    const rows = await db.select<
      Array<{
        tone: string;
        preferred_length: string;
        favorite_patterns: string;
        avoid_patterns: string;
        custom_rules: string;
      }>
    >("SELECT tone, preferred_length, favorite_patterns, avoid_patterns, custom_rules FROM se_style WHERE id = 1");

    const dbStyle = rows[0];
    const localEmpty =
      localStyle.favoritePatterns.length === 0 &&
      localStyle.avoidPatterns.length === 0;

    if (dbStyle && localEmpty && dbLog.length > 0) {
      saveUserStylePreferences({
        ...localStyle,
        tone: dbStyle.tone,
        preferredLength: dbStyle.preferred_length as
          | "concise"
          | "balanced"
          | "detailed",
        favoritePatterns: JSON.parse(dbStyle.favorite_patterns || "[]"),
        avoidPatterns: JSON.parse(dbStyle.avoid_patterns || "[]"),
        customRules: JSON.parse(dbStyle.custom_rules || "[]"),
      });
    }
  } catch {
    /* restore is best-effort; localStorage keeps working regardless */
  }
}

/**
 * Read the learned style profile straight from SQLite (row id = 1).
 * Returns a UserStylePreference-compatible object or null on ANY failure
 * (DB locked, migration missing, plugin not ready, malformed JSON).
 * NEVER throws.
 */
export async function getStyleFromDb(): Promise<UserStylePreference | null> {
  try {
    const db = await getDatabase();
    const rows = await db.select<
      Array<{
        tone: string | null;
        preferred_length: string | null;
        favorite_patterns: string | null;
        avoid_patterns: string | null;
        custom_rules: string | null;
      }>
    >(
      "SELECT tone, preferred_length, favorite_patterns, avoid_patterns, custom_rules FROM se_style WHERE id = 1"
    );

    const row = rows[0];
    if (!row) return null;

    const parseArray = (raw: string | null): string[] => {
      try {
        const parsed = JSON.parse(raw || "[]");
        return Array.isArray(parsed)
          ? parsed.filter((x): x is string => typeof x === "string")
          : [];
      } catch {
        return [];
      }
    };

    const len = row.preferred_length;
    return {
      tone: row.tone ?? "",
      preferredLength:
        len === "balanced" || len === "detailed" ? len : "concise",
      favoritePatterns: parseArray(row.favorite_patterns),
      avoidPatterns: parseArray(row.avoid_patterns),
      customRules: parseArray(row.custom_rules),
    };
  } catch {
    // DB locked, migration missing, plugin not ready — fall back to cache.
    return null;
  }
}

/**
 * Prompt-path style loader: SQLite TRUTH first with a 400ms timeout guard so
 * prompt building stays fire-fast; DB failure OR timeout falls back to the
 * synchronous localStorage cache. Never throws.
 */
export async function getStyleFromDbOrCache(): Promise<UserStylePreference> {
  try {
    const dbStyle = await Promise.race([
      getStyleFromDb(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 400)),
    ]);
    return dbStyle ?? getUserStylePreferences();
  } catch {
    return getUserStylePreferences();
  }
}