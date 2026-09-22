import { getDatabase } from "@/lib/database/config";
import { safeLocalStorage } from "@/lib/storage/helper";

export const RETENTION_STORAGE_KEY = "chat_retention_days";
export const DEFAULT_RETENTION_DAYS = 30;

/**
 * Calculates cutoff timestamp (in ms) given retention days and current time.
 * If retentionDays <= 0, returns null (meaning keep indefinitely).
 */
export function calculateRetentionCutoff(
  retentionDays: number,
  nowMs: number = Date.now()
): number | null {
  if (retentionDays <= 0 || !Number.isFinite(retentionDays)) {
    return null;
  }
  return nowMs - retentionDays * 24 * 60 * 60 * 1000;
}

/**
 * Get current retention days setting.
 * SQLite `app_settings` is the authoritative source of truth.
 * localStorage is maintained as a derived cache that cannot silently diverge.
 */
export async function getRetentionDays(): Promise<number> {
  try {
    const db = await getDatabase();
    const rows = await db.select<{ value: string }[]>(
      `SELECT value FROM app_settings WHERE key = 'retention_days' LIMIT 1`
    );
    if (rows && rows.length > 0) {
      const parsed = parseInt(rows[0].value, 10);
      if (Number.isFinite(parsed) && parsed >= 0) {
        safeLocalStorage.setItem(RETENTION_STORAGE_KEY, parsed.toString());
        return parsed;
      }
    }
  } catch {
    // Fall back to derived cache when SQLite is unreachable (e.g. unit tests or early boot)
  }

  const stored = safeLocalStorage.getItem(RETENTION_STORAGE_KEY);
  if (stored === null || stored === undefined) {
    return DEFAULT_RETENTION_DAYS;
  }
  const parsed = parseInt(stored, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_RETENTION_DAYS;
}

/**
 * Check if a timestamp is expired according to a given cutoffMs.
 */
export function isRetentionExpired(updatedAtMs: number, cutoffMs: number | null): boolean {
  if (cutoffMs === null) return false;
  return updatedAtMs < cutoffMs;
}

/**
 * Save retention days setting to localStorage and SQLite app_settings.
 */
export async function setRetentionDays(days: number): Promise<void> {
  const safeDays = Math.max(0, Math.floor(days));

  try {
    const db = await getDatabase();
    await db.execute(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ('retention_days', $1, unixepoch())
       ON CONFLICT(key) DO UPDATE SET value = $1, updated_at = unixepoch()`,
      [safeDays.toString()]
    );
  } catch (err) {
    console.warn("[retention] Failed to sync retention setting to SQLite:", err);
  }

  safeLocalStorage.setItem(RETENTION_STORAGE_KEY, safeDays.toString());
}

/**
 * Run conversation & message retention purge.
 * Deletes conversations and their messages (via ON DELETE CASCADE or explicit subquery)
 * older than retentionDays.
 * Returns the number of deleted conversations.
 */
export async function runRetentionCleanup(
  customRetentionDays?: number,
  nowMs: number = Date.now()
): Promise<{ deletedConversations: number; cutoffMs: number | null }> {
  const retentionDays =
    customRetentionDays !== undefined ? customRetentionDays : await getRetentionDays();

  const cutoffMs = calculateRetentionCutoff(retentionDays, nowMs);
  if (cutoffMs === null) {
    return { deletedConversations: 0, cutoffMs: null };
  }

  try {
    const db = await getDatabase();

    // Find conversations whose updated_at (or created_at) is older than cutoff
    const oldConvs = await db.select<{ id: string }[]>(
      `SELECT id FROM conversations WHERE updated_at < $1`,
      [cutoffMs]
    );

    if (!oldConvs || oldConvs.length === 0) {
      return { deletedConversations: 0, cutoffMs };
    }

    // Delete messages and conversations
    await db.execute(
      `DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE updated_at < $1)`,
      [cutoffMs]
    );

    const res = await db.execute(
      `DELETE FROM conversations WHERE updated_at < $1`,
      [cutoffMs]
    );

    return {
      deletedConversations: res?.rowsAffected ?? oldConvs.length,
      cutoffMs,
    };
  } catch (err) {
    console.warn("[retention] Cleanup error:", err);
    return { deletedConversations: 0, cutoffMs };
  }
}

/**
 * Alias for runRetentionCleanup
 */
export const cleanOldConversations = runRetentionCleanup;

/**
 * Auto clean on application startup
 */
export async function autoCleanOnStartup(): Promise<{
  deletedConversations: number;
  cutoffMs: number | null;
}> {
  return runRetentionCleanup();
}
