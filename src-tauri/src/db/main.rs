use std::path::Path;
use std::sync::LazyLock;
use sha2::{Digest, Sha384};
use tauri_plugin_sql::{Migration, MigrationKind};

/// Normalizes line endings in SQL string to LF (\n).
pub fn normalize_eol(sql: &str) -> String {
    sql.replace("\r\n", "\n")
}

/// Computes SHA-384 checksum of LF-normalized SQL string as raw 48 bytes.
pub fn compute_migration_checksum(sql: &str) -> Vec<u8> {
    let normalized = normalize_eol(sql);
    Sha384::digest(normalized.as_bytes()).to_vec()
}

struct NormalizedSqlStrings {
    m1: String,
    m2: String,
    m3: String,
    m4: String,
    m5: String,
    m6: String,
}

static NORMALIZED_SQL: LazyLock<NormalizedSqlStrings> = LazyLock::new(|| NormalizedSqlStrings {
    m1: normalize_eol(include_str!("migrations/system-prompts.sql")),
    m2: normalize_eol(include_str!("migrations/chat-history.sql")),
    m3: normalize_eol(include_str!("migrations/rag-contexts.sql")),
    m4: normalize_eol(include_str!("migrations/self-evolution.sql")),
    m5: normalize_eol(include_str!("migrations/asr-corrections.sql")),
    m6: normalize_eol(include_str!("migrations/retention.sql")),
});

/// Returns all database migrations with guaranteed LF-normalized SQL content.
pub fn migrations() -> Vec<Migration> {
    let sql_store = &*NORMALIZED_SQL;
    // Safe transmute of &'store str to &'static str because NORMALIZED_SQL is a static LazyLock
    // and will live for the entire process duration.
    let s1: &'static str = unsafe { &*(sql_store.m1.as_str() as *const str) };
    let s2: &'static str = unsafe { &*(sql_store.m2.as_str() as *const str) };
    let s3: &'static str = unsafe { &*(sql_store.m3.as_str() as *const str) };
    let s4: &'static str = unsafe { &*(sql_store.m4.as_str() as *const str) };
    let s5: &'static str = unsafe { &*(sql_store.m5.as_str() as *const str) };
    let s6: &'static str = unsafe { &*(sql_store.m6.as_str() as *const str) };
    vec![
        // Migration 1: Create system_prompts table with indexes and triggers
        Migration {
            version: 1,
            description: "create_system_prompts_table",
            sql: s1,
            kind: MigrationKind::Up,
        },
        // Migration 2: Create chat history tables (conversations and messages)
        Migration {
            version: 2,
            description: "create_chat_history_tables",
            sql: s2,
            kind: MigrationKind::Up,
        },
        // Migration 3: Create RAG context tables (resume and job description)
        Migration {
            version: 3,
            description: "create_rag_contexts_table",
            sql: s3,
            kind: MigrationKind::Up,
        },
        // Migration 4: Self-Evolution persistence (style profile + feedback log)
        Migration {
            version: 4,
            description: "create_self_evolution_tables",
            sql: s4,
            kind: MigrationKind::Up,
        },
        // Migration 5: User vocabulary ASR corrections
        Migration {
            version: 5,
            description: "create_asr_corrections_table",
            sql: s5,
            kind: MigrationKind::Up,
        },
        // Migration 6: Retention settings and conversation retention
        Migration {
            version: 6,
            description: "create_retention_settings_table",
            sql: s6,
            kind: MigrationKind::Up,
        },
    ]
}

/// Fixes migration checksums in an existing SQLite database file if it has CRLF/mismatched checksums.
///
/// tauri-plugin-sql and sqlx-core calculate checksum = sha384(sql.as_bytes()) without EOL normalization.
/// If a previous build stored sha384(CRLF-bytes), running against LF-normalized migrations would trigger
/// a VersionMismatch panic on startup.
/// This helper inspects `_sqlx_migrations` and updates checksums to sha384(LF-bytes) before the plugin runs.
pub fn patch_migration_checksums(db_path: &Path) {
    if !db_path.exists() {
        return;
    }

    let conn = match rusqlite::Connection::open(db_path) {
        Ok(conn) => conn,
        Err(e) => {
            log::warn!("Could not open db at {:?} to check migration checksums: {e}", db_path);
            return;
        }
    };

    // Check if _sqlx_migrations table exists
    let table_exists: bool = conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_sqlx_migrations'",
            [],
            |_| Ok(true),
        )
        .unwrap_or(false);

    if !table_exists {
        return;
    }

    let current_migrations = migrations();
    for m in current_migrations {
        let expected_checksum = compute_migration_checksum(m.sql);

        let existing_checksum: Option<Vec<u8>> = conn
            .query_row(
                "SELECT checksum FROM _sqlx_migrations WHERE version = ?1",
                [m.version],
                |row| row.get(0),
            )
            .ok();

        if let Some(existing) = existing_checksum {
            if existing != expected_checksum {
                match conn.execute(
                    "UPDATE _sqlx_migrations SET checksum = ?1 WHERE version = ?2",
                    rusqlite::params![expected_checksum, m.version],
                ) {
                    Ok(_) => {
                        log::info!(
                            "Patched migration checksum for version {} ({}) to match LF content (was {:02x?}... now {:02x?}...)",
                            m.version,
                            m.description,
                            &existing[..existing.len().min(8)],
                            &expected_checksum[..expected_checksum.len().min(8)],
                        );
                    }
                    Err(e) => {
                        log::error!(
                            "Failed to update migration checksum for version {}: {e}",
                            m.version
                        );
                    }
                }
            }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_eol_crlf_to_lf() {
        let input = "CREATE TABLE test (\r\n    id INTEGER PRIMARY KEY,\r\n    name TEXT\r\n);\r\n";
        let normalized = normalize_eol(input);
        assert!(!normalized.contains("\r\n"));
        assert!(!normalized.contains('\r'));
        assert_eq!(
            normalized,
            "CREATE TABLE test (\n    id INTEGER PRIMARY KEY,\n    name TEXT\n);\n"
        );
    }

    #[test]
    fn test_migration_4_lf_bytes_and_exact_content() {
        let all_migrations = migrations();
        let migration_4 = all_migrations
            .iter()
            .find(|m| m.version == 4)
            .expect("Migration 4 must exist");

        let raw_sql = migration_4.sql;

        // Ensure line endings are LF only (\n without \r)
        assert!(
            !raw_sql.contains('\r'),
            "Migration 4 SQL contains CRLF carriage return bytes. Must use LF only."
        );

        // Verify exact historical SQL content
        let expected_sql = "-- Migration 4: Self-Evolution persistence (survives WebView storage clears)\n\nCREATE TABLE IF NOT EXISTS se_style (\n    id INTEGER PRIMARY KEY CHECK (id = 1),\n    tone TEXT NOT NULL,\n    preferred_length TEXT NOT NULL DEFAULT 'concise',\n    favorite_patterns TEXT NOT NULL DEFAULT '[]',\n    avoid_patterns TEXT NOT NULL DEFAULT '[]',\n    custom_rules TEXT NOT NULL DEFAULT '[]',\n    updated_at INTEGER NOT NULL\n);\n\nCREATE TABLE IF NOT EXISTS se_feedback_log (\n    id TEXT PRIMARY KEY,\n    question TEXT NOT NULL,\n    response TEXT NOT NULL,\n    rating TEXT NOT NULL CHECK (rating IN ('like', 'dislike')),\n    reason TEXT,\n    topic TEXT,\n    timestamp INTEGER NOT NULL\n);\n\nCREATE INDEX IF NOT EXISTS idx_se_feedback_ts ON se_feedback_log (timestamp DESC);\n\nINSERT OR IGNORE INTO se_style (id, tone, preferred_length, updated_at)\nVALUES (1, 'живой, естественный', 'concise', strftime('%s','now') * 1000);";

        assert_eq!(
            raw_sql, expected_sql,
            "Migration 4 SQL does not match the immutable historical published migration definition."
        );

        // Verify sha384(LF-bytes of migration 4) matches the known checksum 06420b4c...
        let checksum = compute_migration_checksum(raw_sql);
        let hex_checksum: String = checksum.iter().map(|b| format!("{:02x}", b)).collect();
        assert_eq!(
            hex_checksum,
            "06420b4c1a3e3e1459b2cf3c943313945d4510163899348e6fed15e95356678912d9e73bcd175c82a73458de7d466d75"
        );
    }

    #[test]
    fn test_patch_migration_checksums_with_crlf_hash() {
        let temp_dir = std::env::temp_dir().join(format!("pluely_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let db_path = temp_dir.join("test.db");

        let conn = rusqlite::Connection::open(&db_path).unwrap();
        conn.execute(
            "CREATE TABLE _sqlx_migrations (
                version BIGINT PRIMARY KEY,
                description TEXT NOT NULL,
                installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                success BOOLEAN NOT NULL,
                checksum BLOB NOT NULL,
                execution_time BIGINT NOT NULL
            )",
            [],
        )
        .unwrap();

        // Insert fake CRLF checksum for version 1
        let fake_crlf_checksum = vec![0xAB; 48];
        conn.execute(
            "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time) VALUES (1, 'create_system_prompts_table', 1, ?1, 10)",
            [&fake_crlf_checksum],
        )
        .unwrap();
        drop(conn);

        // Run patch
        patch_migration_checksums(&db_path);

        // Re-read checksum from DB
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        let updated_checksum: Vec<u8> = conn
            .query_row(
                "SELECT checksum FROM _sqlx_migrations WHERE version = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();

        let expected_checksum = compute_migration_checksum(include_str!("migrations/system-prompts.sql"));
        assert_eq!(updated_checksum, expected_checksum);
        assert_ne!(updated_checksum, fake_crlf_checksum);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
