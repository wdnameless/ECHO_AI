import { invoke } from "@tauri-apps/api/core";
import { getDatabase } from "@/lib/database/config";
import {
  getUserStylePreferences,
  saveUserStylePreferences,
  getFeedbackLog,
  saveFeedbackLog,
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
    if (typeof window !== "undefined" && ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)) {
      await invoke("db_save_se_style", {
        style: {
          tone: style.tone,
          preferredLength: style.preferredLength,
          favoritePatterns: style.favoritePatterns,
          avoidPatterns: style.avoidPatterns,
          customRules: style.customRules,
        },
      });
      return;
    }
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
    if (typeof window !== "undefined" && ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)) {
      await invoke("db_append_se_feedback", {
        entry: {
          id: entry.id,
          question: entry.question,
          response: entry.response,
          rating: entry.rating,
          reason: entry.reason ?? null,
          topic: entry.topic ?? null,
          timestamp: entry.timestamp,
        },
      });
      return;
    }
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

function toFeedbackEntry(r: {
  id: string;
  question: string;
  response: string;
  rating: string;
  reason?: string | null;
  topic?: string | null;
  timestamp: number;
}): FeedbackEntry {
  return {
    id: r.id,
    question: r.question,
    response: r.response,
    rating: r.rating === "dislike" ? "dislike" : "like",
    reason: r.reason ?? undefined,
    topic: r.topic ?? undefined,
    timestamp: r.timestamp,
  };
}

/**
 * Startup restore: if the WebView storage was cleared (localStorage empty or
 * has fewer feedback entries than SQLite), restore the learned state from
 * the durable mirror. Idempotent — safe to call on every app start.
 */
export async function restoreSelfEvolution(): Promise<void> {
  try {
    const isTauri =
      typeof window !== "undefined" &&
      ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);

    let restoredFeedback: FeedbackEntry[] | null = null;
    let dbStyleDto: {
      tone: string;
      preferredLength: string;
      favoritePatterns: string[];
      avoidPatterns: string[];
      customRules: string[];
    } | null = null;
    let dbFeedbackCount = 0;

    if (isTauri) {
      const feedbackDtos = await invoke<
        Array<{
          id: string;
          question: string;
          response: string;
          rating: string;
          reason?: string | null;
          topic?: string | null;
          timestamp: number;
        }>
      >("db_get_se_feedback", { limit: 10000 });
      dbFeedbackCount = feedbackDtos.length;
      const localLog = getFeedbackLog();
      if (feedbackDtos.length > localLog.length) {
        restoredFeedback = feedbackDtos.map(toFeedbackEntry);
      }
      dbStyleDto = await invoke<{
        tone: string;
        preferredLength: string;
        favoritePatterns: string[];
        avoidPatterns: string[];
        customRules: string[];
      } | null>("db_get_se_style");
    } else {
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
      dbFeedbackCount = dbLog.length;
      const localLog = getFeedbackLog();

      // Restore feedback log if SQLite holds more history than localStorage
      // (localStorage was cleared or lost).
      if (dbLog.length > localLog.length) {
        restoredFeedback = dbLog.map(toFeedbackEntry);
      }

      // Restore style profile if localStorage lost it but SQLite has learning.
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
      if (dbStyle) {
        const favs = JSON.parse(dbStyle.favorite_patterns || "[]");
        const avoids = JSON.parse(dbStyle.avoid_patterns || "[]");
        const rules = JSON.parse(dbStyle.custom_rules || "[]");
        dbStyleDto = {
          tone: dbStyle.tone,
          preferredLength: dbStyle.preferred_length,
          favoritePatterns: Array.isArray(favs) ? favs : [],
          avoidPatterns: Array.isArray(avoids) ? avoids : [],
          customRules: Array.isArray(rules) ? rules : [],
        };
      }
    }

    if (restoredFeedback) {
      saveFeedbackLog(restoredFeedback);
    }

    const localStyle = getUserStylePreferences();
    const localEmpty =
      localStyle.favoritePatterns.length === 0 &&
      localStyle.avoidPatterns.length === 0 &&
      localStyle.customRules.length === 0;

    if (dbStyleDto && localEmpty) {
      const favs = dbStyleDto.favoritePatterns || [];
      const avoids = dbStyleDto.avoidPatterns || [];
      const rules = dbStyleDto.customRules || [];
      if (favs.length > 0 || avoids.length > 0 || rules.length > 0 || dbFeedbackCount > 0) {
        saveUserStylePreferences({
          ...localStyle,
          tone: dbStyleDto.tone,
          preferredLength: (dbStyleDto.preferredLength as
            | "concise"
            | "balanced"
            | "detailed") || "concise",
          favoritePatterns: favs,
          avoidPatterns: avoids,
          customRules: rules,
        });
      }
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
    if (typeof window !== "undefined" && ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)) {
      const style = await invoke<UserStylePreference | null>("db_get_se_style");
      return style;
    }
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
 * Prompt-path style loader: synchronous write-through cache read to avoid
 * 400ms SQLite await on hot path (R03). Never throws.
 */
export async function getStyleFromDbOrCache(): Promise<UserStylePreference> {
  return getUserStylePreferences();
}

/**
 * Clears learned state in SQLite (both feedback log and style).
 */
export async function resetSelfEvolutionDb(): Promise<void> {
  try {
    if (typeof window !== "undefined" && ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)) {
      await invoke("db_reset_se_data");
      return;
    }
    const db = await getDatabase();
    await db.execute("DELETE FROM se_feedback_log");
    await db.execute("DELETE FROM se_style");
    await db.execute(
      `INSERT OR REPLACE INTO se_style (id, tone, preferred_length, favorite_patterns, avoid_patterns, custom_rules, updated_at)
       VALUES (1, 'живой, естественный', 'concise', '[]', '[]', '[]', ?)`,
      [Date.now()]
    );
  } catch {
    /* durability clear is best-effort */
  }
}