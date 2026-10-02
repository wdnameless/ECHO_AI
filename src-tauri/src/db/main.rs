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
    m7: String,
}

static NORMALIZED_SQL: LazyLock<NormalizedSqlStrings> = LazyLock::new(|| NormalizedSqlStrings {
    m1: normalize_eol(include_str!("migrations/system-prompts.sql")),
    m2: normalize_eol(include_str!("migrations/chat-history.sql")),
    m3: normalize_eol(include_str!("migrations/rag-contexts.sql")),
    m4: normalize_eol(include_str!("migrations/self-evolution.sql")),
    m5: normalize_eol(include_str!("migrations/asr-corrections.sql")),
    m6: normalize_eol(include_str!("migrations/retention.sql")),
    m7: normalize_eol(include_str!("migrations/message-source.sql")),
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
    let s7: &'static str = unsafe { &*(sql_store.m7.as_str() as *const str) };
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
        // Migration 7: Remember which side said each message
        Migration {
            version: 7,
            description: "add_message_source",
            sql: s7,
            kind: MigrationKind::Up,
        },
    ]
}

/// Repairs only the bundled migration's recognized CRLF checksum to its LF checksum.
/// Unknown hashes remain untouched so SQLx still rejects schema/migration drift.
pub fn patch_migration_checksums(db_path: &Path) -> Result<(), String> {
    use rusqlite::OptionalExtension;
    if !db_path.exists() {
        return Ok(());
    }
    let mut conn = rusqlite::Connection::open(db_path)
        .map_err(|e| format!("cannot inspect database checksums: {e}"))?;
    let transaction = conn.transaction()
        .map_err(|e| format!("cannot begin checksum repair: {e}"))?;
    let table_exists = transaction.query_row(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_sqlx_migrations'",
        [], |_| Ok(()),
    ).optional().map_err(|e| format!("cannot inspect migration table: {e}"))?.is_some();
    if !table_exists {
        return Ok(());
    }
    for migration in migrations() {
        let existing: Option<Vec<u8>> = transaction.query_row(
            "SELECT checksum FROM _sqlx_migrations WHERE version = ?1",
            [migration.version], |row| row.get(0),
        ).optional().map_err(|e| format!("cannot read migration checksum: {e}"))?;
        let Some(existing) = existing else { continue };
        let expected = compute_migration_checksum(migration.sql);
        if existing == expected {
            continue;
        }
        let crlf = Sha384::digest(migration.sql.replace('\n', "\r\n").as_bytes()).to_vec();
        if existing != crlf {
            return Err(format!("Migration {} checksum drift: not a bundled LF/CRLF equivalent; database unchanged", migration.version));
        }
        transaction.execute(
            "UPDATE _sqlx_migrations SET checksum = ?1 WHERE version = ?2",
            rusqlite::params![expected, migration.version],
        ).map_err(|e| format!("cannot repair EOL checksum: {e}"))?;
    }
    transaction.commit().map_err(|e| format!("cannot commit EOL checksum repair: {e}"))
}

/// Never replace either a database or its journal sidecars, even during startup races.
pub fn ensure_snapshot_destination(destination: &Path) -> Result<(), String> {
    for suffix in ["", "-wal", "-shm", "-journal"] {
        let mut name = destination.as_os_str().to_os_string();
        name.push(suffix);
        let path = std::path::PathBuf::from(name);
        if path.try_exists().map_err(|e| format!("cannot inspect {}: {e}", path.display()))? {
            return Err(format!(
                "Database transition conflict: {} already exists. Both histories are retained; move the destination and its sidecars to a backup before retrying.",
                path.display()
            ));
        }
    }
    Ok(())
}

/// VACUUM reads committed WAL rows. Publish the finished snapshot without clobbering
/// a destination created by another process; the original database is never removed.
pub fn snapshot_database(source: &Path, destination: &Path) -> Result<(), String> {
    ensure_snapshot_destination(destination)?;
    let parent = destination.parent().ok_or("database destination has no parent")?;
    std::fs::create_dir_all(parent)
        .map_err(|e| format!("cannot create {}: {e}", parent.display()))?;
    let temporary = parent.join(format!(".pluely-snapshot-{}.db", uuid::Uuid::new_v4()));
    let result = (|| -> Result<(), String> {
        let connection = rusqlite::Connection::open_with_flags(
            source, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        ).map_err(|e| format!("cannot open source database {}: {e}", source.display()))?;
        connection.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|e| format!("cannot configure database snapshot: {e}"))?;
        let temporary_name = temporary.to_str().ok_or("snapshot path is not valid Unicode")?;
        connection.execute("VACUUM INTO ?1", [temporary_name])
            .map_err(|e| format!("cannot snapshot {}: {e}", source.display()))?;
        std::fs::OpenOptions::new().write(true).open(&temporary).and_then(|file| file.sync_all())
            .map_err(|e| format!("cannot sync database snapshot: {e}"))?;
        ensure_snapshot_destination(destination)?;
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::ffi::OsStrExt;
            #[link(name = "kernel32")]
            extern "system" {
                fn MoveFileExW(source: *const u16, destination: *const u16, flags: u32) -> i32;
            }
            let from: Vec<u16> = temporary.as_os_str().encode_wide().chain(Some(0)).collect();
            let to: Vec<u16> = destination.as_os_str().encode_wide().chain(Some(0)).collect();
            // No REPLACE_EXISTING or COPY_ALLOWED: same-directory, no-clobber
            // publication also works on FAT/exFAT portable drives.
            const MOVEFILE_WRITE_THROUGH: u32 = 0x8;
            // SAFETY: both paths are NUL-terminated and live throughout the call.
            if unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), MOVEFILE_WRITE_THROUGH) } == 0 {
                return Err(format!("cannot publish database snapshot without overwriting {}: {}", destination.display(), std::io::Error::last_os_error()));
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            // ponytail: requires hard-link support; use native no-replace rename
            // if portable deployment on a non-Windows FAT filesystem is needed.
            std::fs::hard_link(&temporary, destination)
                .map_err(|e| format!("cannot publish database snapshot without overwriting {}: {e}", destination.display()))?;
        }
        Ok(())
    })();
    let _ = std::fs::remove_file(&temporary);
    result
}

/// Applies performance and integrity pragmas to the SQLite database.
pub fn apply_pragmas(db_path: &Path) {
    if !db_path.exists() {
        return;
    }

    let conn = match rusqlite::Connection::open(db_path) {
        Ok(conn) => conn,
        Err(e) => {
            eprintln!("Warning: Failed to open db at {:?} to apply pragmas: {}", db_path, e);
            return;
        }
    };

    let pragma_sql = "
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA temp_store = MEMORY;
        PRAGMA cache_size = -64000;
        PRAGMA foreign_keys = ON;
    ";

    if let Err(e) = conn.execute_batch(pragma_sql) {
        eprintln!("Warning: Failed to apply SQLite pragmas to {:?}: {}", db_path, e);
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
    fn storage_checksum_accepts_only_eol_equivalence() {
        let temp_dir = std::env::temp_dir().join(format!("pluely-checksum-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let db_path = temp_dir.join("test.db");
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        conn.execute_batch("CREATE TABLE _sqlx_migrations (version INTEGER PRIMARY KEY, checksum BLOB NOT NULL)").unwrap();
        let all = migrations();
        let lf = compute_migration_checksum(all[0].sql);
        let crlf = Sha384::digest(all[1].sql.replace('\n', "\r\n").as_bytes()).to_vec();
        let drift = Sha384::digest(format!("{}\n-- changed schema", all[2].sql).as_bytes()).to_vec();
        for (version, checksum) in [(1, &lf), (2, &crlf)] {
            conn.execute("INSERT INTO _sqlx_migrations VALUES (?1, ?2)", rusqlite::params![version, checksum]).unwrap();
        }
        patch_migration_checksums(&db_path).unwrap();
        let checksum = |version| conn.query_row("SELECT checksum FROM _sqlx_migrations WHERE version = ?1", [version], |row| row.get::<_, Vec<u8>>(0)).unwrap();
        assert_eq!(checksum(1), lf);
        assert_eq!(checksum(2), compute_migration_checksum(all[1].sql));
        conn.execute("INSERT INTO _sqlx_migrations VALUES (3, ?1)", [&drift]).unwrap();
        conn.execute("UPDATE _sqlx_migrations SET checksum=?1 WHERE version=2", [&crlf]).unwrap();
        assert!(patch_migration_checksums(&db_path).unwrap_err().contains("checksum drift"));
        assert_eq!(checksum(3), drift);
        assert_eq!(checksum(2), crlf, "a later drift error must roll back all checksum repairs");
        drop(conn);
        std::fs::remove_dir_all(temp_dir).unwrap();
    }


    #[test]
    fn test_apply_pragmas() {
        let temp_dir = std::env::temp_dir().join(format!("pluely_pragma_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let db_path = temp_dir.join("test_pragma.db");

        // Non-existent db does not panic and does not create file
        apply_pragmas(&db_path);
        assert!(!db_path.exists());

        // Create db file
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        drop(conn);

        // Apply pragmas
        apply_pragmas(&db_path);

        let conn = rusqlite::Connection::open(&db_path).unwrap();
        let journal_mode: String = conn
            .query_row("PRAGMA journal_mode", [], |row| row.get(0))
            .unwrap();
        assert_eq!(journal_mode.to_lowercase(), "wal");

        drop(conn);
        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
