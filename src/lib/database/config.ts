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

/**
 * Get database instance
 */
export async function getDatabase(): Promise<Database> {
  if (!dbInstance) {
    try {
      dbInstance = await Database.load("sqlite:pluely.db");
    } catch (error) {
      throw new Error(
        `Failed to initialize database: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
  return dbInstance;
}
