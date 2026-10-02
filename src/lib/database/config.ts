import Database from "@tauri-apps/plugin-sql";
import { getDatabaseUrl } from "../storage/app-paths";

/** The native startup URL also owns migration registration and stays session-stable. */
let dbInstance: Database | null = null;
let dbLoading: Promise<Database> | null = null;

/**
 * Get database instance
 *
 * Concurrent callers share one load: two `Database.load` calls in flight run the
 * plugin's migrations twice, which races on `_sqlx_migrations` and locks the file.
 */
export function getDatabase(): Promise<Database> {
  if (dbInstance) return Promise.resolve(dbInstance);
  if (!dbLoading) {
    dbLoading = getDatabaseUrl().then((url) => Database.load(url))
      .then(async (db) => {
        // Wait for a competing writer instead of failing instantly.
        //
        // Several modules write this file (chat history, system prompts,
        // retention, self-evolution) and each conversation save wraps its work
        // in BEGIN/COMMIT. Without a busy timeout SQLite returns
        // "database is locked" (code 5) the moment two of them overlap, and the
        // save is lost — observed live as repeated
        // "Failed to save system audio conversation: ... database is locked"
        // while the meeting screen was recording.
        try {
          await db.execute("PRAGMA busy_timeout = 5000");
          // Foreign keys are per-CONNECTION in SQLite, and this is the plugin's
          // pooled connection — the only one the renderer writes through. The
          // same pragma in Rust (`db/main.rs`) runs on a separate connection
          // opened just to apply it, so it never affected these writes. Without
          // it here, `ON DELETE CASCADE` on `messages` did nothing:
          // `deleteConversation` removed the parent row and left every message
          // orphaned, and retention's parent-only deletes did the same.
          await db.execute("PRAGMA foreign_keys = ON");
        } catch (error) {
          // A read-only or already-configured connection must not stop startup.
          console.warn("[db] could not set pragmas:", error);
        }
        dbInstance = db;
        return db;
      })
      .catch((error) => {
        dbLoading = null;
        throw new Error(
          `Failed to initialize database: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      });
  }
  return dbLoading;
}
