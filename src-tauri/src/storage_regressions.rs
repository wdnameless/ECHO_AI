use super::*;
use crate::db;
use rusqlite::Connection;
use sqlx::migrate::{MigrateError, Migration, Migrator};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::borrow::Cow;

struct Scratch(PathBuf);
impl Scratch {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("pluely-storage-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        Self(root)
    }
}
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

struct LocalPaths;
impl LocalPaths {
    fn install(root: &Path) -> Self {
        let executable = root.join("executable");
        let host = root.join("host");
        std::fs::create_dir_all(&executable).unwrap();
        std::fs::create_dir_all(&host).unwrap();
        TEST_PATHS.with(|paths| {
            assert!(paths.borrow().is_none());
            *paths.borrow_mut() = Some((executable, host));
        });
        Self
    }
}
impl Drop for LocalPaths {
    fn drop(&mut self) {
        TEST_PATHS.with(|paths| *paths.borrow_mut() = None);
    }
}

fn migrator() -> Migrator {
    // The installed SQL plugin makes this exact conversion of the bundled SQL.
    Migrator {
        migrations: Cow::Owned(db::migrations().into_iter().map(|migration| {
            Migration::new(migration.version, migration.description.into(),
                migration.kind.into(), migration.sql.into(), false)
        }).collect()),
        ..Migrator::DEFAULT
    }
}

fn create_chat_database(path: &Path, content: &str) -> Connection {
    let connection = Connection::open(path).unwrap();
    for migration in db::migrations() {
        connection.execute_batch(migration.sql).unwrap();
    }
    connection.execute_batch("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;").unwrap();
    connection.execute("INSERT INTO conversations (id,title,created_at,updated_at) VALUES ('chat','History',1,1)", []).unwrap();
    insert_message(&connection, "first", content);
    connection.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)").unwrap();
    connection
}

fn insert_message(connection: &Connection, id: &str, content: &str) {
    connection.execute(
        "INSERT INTO messages (id,conversation_id,role,content,timestamp,source) VALUES (?1,'chat','user',?2,2,'mic')",
        rusqlite::params![id, content],
    ).unwrap();
}

fn messages(path: &Path) -> Vec<String> {
    let connection = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    let mut statement = connection.prepare("SELECT content FROM messages ORDER BY id").unwrap();
    let rows = statement.query_map([], |row| row.get(0)).unwrap()
        .collect::<Result<Vec<String>, _>>().unwrap();
    rows
}

#[tokio::test]
async fn storage_sqlite_schema_messages_wal_snapshot_and_checksum_drift() {
    let scratch = Scratch::new();
    let source = scratch.0.join("source.db");
    let destination = scratch.0.join("portable").join(DB_FILE);
    let pool = SqlitePoolOptions::new().max_connections(1).connect_with(
        SqliteConnectOptions::new().filename(&source).create_if_missing(true),
    ).await.unwrap();
    let migrations = migrator();
    migrations.run(&pool).await.unwrap();
    let versions: Vec<i64> = sqlx::query_scalar("SELECT version FROM _sqlx_migrations ORDER BY version")
        .fetch_all(&pool).await.unwrap();
    assert_eq!(versions, vec![1, 2, 3, 4, 5, 6, 7]);
    pool.close().await;

    let writer = Connection::open(&source).unwrap();
    writer.execute_batch("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;
        INSERT INTO conversations (id,title,created_at,updated_at) VALUES ('chat','History',1,1);
        PRAGMA wal_checkpoint(TRUNCATE);").unwrap();
    insert_message(&writer, "committed-in-wal", "Last committed message");
    assert!(std::fs::metadata(source.with_extension("db-wal")).unwrap().len() > 0);
    prepare_database_path(&source, &destination, false).unwrap();
    assert_eq!(messages(&destination), vec!["Last committed message"]);
    assert_eq!(messages(&source), vec!["Last committed message"]);
    assert!(source.is_file());

    let snapshot = Connection::open(&destination).unwrap();
    let integrity: String = snapshot.query_row("PRAGMA integrity_check", [], |row| row.get(0)).unwrap();
    assert_eq!(integrity, "ok");
    let bundled = db::migrations();
    use sha2::{Digest, Sha384};
    let crlf = Sha384::digest(bundled[0].sql.replace('\n', "\r\n").as_bytes()).to_vec();
    snapshot.execute("UPDATE _sqlx_migrations SET checksum=?1 WHERE version=1", [&crlf]).unwrap();
    db::patch_migration_checksums(&destination).unwrap();
    drop(snapshot);
    let migrated_snapshot = SqlitePoolOptions::new().max_connections(1).connect_with(
        SqliteConnectOptions::new().filename(&destination),
    ).await.unwrap();
    migrations.run(&migrated_snapshot).await.unwrap();
    sqlx::query("UPDATE _sqlx_migrations SET checksum=?1 WHERE version=2")
        .bind(vec![0xab_u8; 48]).execute(&migrated_snapshot).await.unwrap();
    assert!(db::patch_migration_checksums(&destination).unwrap_err().contains("checksum drift"));
    assert!(matches!(migrations.run(&migrated_snapshot).await, Err(MigrateError::VersionMismatch(2))));
    let checksum: Vec<u8> = sqlx::query_scalar("SELECT checksum FROM _sqlx_migrations WHERE version=2")
        .fetch_one(&migrated_snapshot).await.unwrap();
    assert_eq!(checksum, vec![0xab_u8; 48]);
    migrated_snapshot.close().await;
    drop(writer);
}

#[test]
fn storage_existing_destination_wins_and_explicit_collisions_preserve_both() {
    let scratch = Scratch::new();
    let source = scratch.0.join("host.db");
    let destination = scratch.0.join("portable.db");
    let host = create_chat_database(&source, "Host history");
    let portable = create_chat_database(&destination, "Portable history");
    insert_message(&portable, "last", "Portable WAL history");
    prepare_database_path(&source, &destination, false).unwrap();
    assert_eq!(messages(&destination), vec!["Portable history", "Portable WAL history"]);
    assert!(prepare_database_path(&source, &destination, true).unwrap_err().contains("conflict"));
    assert_eq!(messages(&source), vec!["Host history"]);
    assert_eq!(messages(&destination), vec!["Portable history", "Portable WAL history"]);
    assert!(db::snapshot_database(&source, &destination).unwrap_err().contains("conflict"));

    let empty_destination = scratch.0.join("sidecar.db");
    let sidecar = empty_destination.with_extension("db-wal");
    std::fs::write(&sidecar, b"retained journal").unwrap();
    assert!(prepare_database_path(&source, &empty_destination, true).unwrap_err().contains("conflict"));
    assert!(!empty_destination.exists());
    assert_eq!(std::fs::read(sidecar).unwrap(), b"retained journal");
    drop(portable);
    drop(host);
}

#[test]
fn storage_restart_transitions_capture_last_writes_and_refuse_stale_host_history() {
    let scratch = Scratch::new();
    let _paths = LocalPaths::install(&scratch.0);
    let host_path = app_data_root().join(DB_FILE);
    let host = create_chat_database(&host_path, "Before enable");
    let current_url = database_url(&database_path());
    let requested = commands::enable_portable().unwrap();
    assert!(requested.restart_required);
    assert_eq!(requested.root_kind, RootKind::AppData);
    assert_eq!(database_url(&database_path()), current_url);
    let portable_path = exe_dir().unwrap().join(".echo-ai").join(DB_FILE);
    assert!(!portable_path.exists(), "button click must not snapshot or move the DB");
    let canceled = commands::disable_portable().unwrap();
    assert!(!canceled.restart_required);
    assert!(!portable_path.exists());
    assert_eq!(database_url(&database_path()), current_url);
    assert!(commands::enable_portable().unwrap().restart_required);
    insert_message(&host, "last", "After enable, before restart");
    let planned_url = database_url(&planned_database_path().unwrap());
    assert_eq!(startup_database_path().unwrap(), portable_path);
    assert_eq!(database_url(&database_path()), planned_url);
    assert_eq!(messages(&portable_path), vec!["Before enable", "After enable, before restart"]);
    assert!(load_settings().pending_database_transition.is_none());
    assert_eq!(resolved_paths().root_kind, RootKind::Portable);
    assert!(host_path.is_file());
    assert!(commands::disable_portable().unwrap_err().contains("conflict"));
    assert_eq!(resolved_paths().root_kind, RootKind::Portable);
    assert_eq!(messages(&host_path), vec!["Before enable", "After enable, before restart"]);

    // User resolves the reported conflict by retaining the old host DB as a backup.
    drop(host); // flush/close its WAL before moving the fixture backup
    let backup = scratch.0.join("retained-host.db");
    std::fs::rename(&host_path, &backup).unwrap();
    let portable = Connection::open(&portable_path).unwrap();
    portable.execute_batch("PRAGMA wal_autocheckpoint=0;").unwrap();
    insert_message(&portable, "portable", "Latest portable history");
    let current_url = database_url(&database_path());
    let requested = commands::disable_portable().unwrap();
    assert!(requested.restart_required);
    assert_eq!(requested.root_kind, RootKind::Portable);
    assert_eq!(database_url(&database_path()), current_url);
    assert!(!host_path.exists());
    insert_message(&portable, "return", "After disable, before restart");
    assert_eq!(startup_database_path().unwrap(), host_path);
    assert_eq!(messages(&host_path), vec!["Before enable", "After enable, before restart", "Latest portable history", "After disable, before restart"]);
    assert_eq!(messages(&backup), vec!["Before enable", "After enable, before restart"]);
    assert_eq!(messages(&portable_path), messages(&host_path));
    assert_eq!(resolved_paths().root_kind, RootKind::AppData);
    assert_eq!(startup_database_path().unwrap(), host_path, "retained portable folder must not re-enable portable mode");
    drop(portable);
}

#[test]
fn storage_restart_collision_after_queue_leaves_pending_transition_and_source() {
    let scratch = Scratch::new();
    let _paths = LocalPaths::install(&scratch.0);
    let host_path = app_data_root().join(DB_FILE);
    let host = create_chat_database(&host_path, "Source retained");
    commands::enable_portable().unwrap();
    let destination = planned_database_path().unwrap();
    std::fs::create_dir_all(destination.parent().unwrap()).unwrap();
    let competing = create_chat_database(&destination, "Competing destination retained");
    assert!(startup_database_path().unwrap_err().contains("conflict"));
    assert!(load_settings().pending_database_transition.is_some());
    assert_eq!(messages(&host_path), vec!["Source retained"]);
    assert_eq!(messages(&destination), vec!["Competing destination retained"]);
    drop(competing);
    drop(host);
}
