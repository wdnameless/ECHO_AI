import Database from "@tauri-apps/plugin-sql";

/**
 * Serialises the transaction-scoped writers.
 *
 * Every writer here shares ONE plugin connection, and `BEGIN TRANSACTION` is
 * connection-wide. Two overlapping saves therefore interleave: the second BEGIN
 * fails ("cannot start a transaction within a transaction"), the first COMMIT
 * closes the shared transaction, and the second one then fails with
 *
 *   cannot commit - no transaction is active
 *
 * which is what the meeting screen logged while recording — the turn was shown
 * on screen and never reached the database. Reproduced on a single node:sqlite
 * connection: BEGIN, BEGIN, COMMIT, COMMIT produces exactly that message.
 *
 * A promise chain is enough here: the work is short, and a queue is the whole
 * requirement. Anything that opens a transaction must go through `withWriteLock`.
 */
let writeLock: Promise<unknown> = Promise.resolve();

export function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeLock.then(fn, fn);
  // Keep the chain alive even when a writer rejects, so one failure cannot
  // deadlock every later write.
  writeLock = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/**
 * Database configuration
 *
 * The chat database stays in app data even in portable mode: the SQL plugin's
 * migrations are registered per URL and its `preload` opens that same URL, so
 * pointing a portable copy at its own file would open a database with no
 * migrations applied. Moving it needs the plugin's migration registration to
 * follow the runtime path first.
 */
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
    dbLoading = Database.load("sqlite:pluely.db")
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
        } catch (error) {
          // A read-only or already-configured connection must not stop startup.
          console.warn("[db] could not set busy_timeout:", error);
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
