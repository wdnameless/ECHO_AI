import Database from "@tauri-apps/plugin-sql";

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
      .then((db) => {
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
