use serde::{Deserialize, Serialize};
use sqlx::{sqlite::SqlitePoolOptions, Row, SqlitePool};
use std::sync::LazyLock;
use std::path::PathBuf;
use tauri::AppHandle;
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AsrCorrection {
    pub id: i64,
    pub wrong: String,
    pub right: String,
    pub created_at: Option<i64>,
}
static DB_POOL: LazyLock<Mutex<Option<SqlitePool>>> = LazyLock::new(|| Mutex::new(None));

fn get_pool_mutex() -> &'static Mutex<Option<SqlitePool>> {
    &DB_POOL
}

fn get_db_path<R: tauri::Runtime>(_app: &AppHandle<R>) -> Result<PathBuf, String> {
    // Canonical database resolution shared with settings and SQL plugin (R15).
    crate::settings::ensure_database_path()
}

async fn get_or_init_pool<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<SqlitePool, String> {
    let mutex = get_pool_mutex();
    let mut guard = mutex.lock().await;
    if let Some(pool) = guard.as_ref() {
        return Ok(pool.clone());
    }

    let db_path = get_db_path(app)?;
    if let Some(parent) = db_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    // Connect by filename: a `sqlite://` string breaks on a Windows drive letter,
    // and this pool shares the file with the SQL plugin, so it needs WAL and a
    // wait instead of an immediate "database is locked".
    let options = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(&db_path)
        .create_if_missing(true)
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
        .busy_timeout(std::time::Duration::from_secs(5));
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await
        .map_err(|e| format!("Failed to connect to sqlite: {}", e))?;

    *guard = Some(pool.clone());
    Ok(pool)
}

#[tauri::command]
pub async fn get_corrections<R: tauri::Runtime>(
    app: AppHandle<R>,
) -> Result<Vec<AsrCorrection>, String> {
    let pool = get_or_init_pool(&app).await?;
    let rows = sqlx::query("SELECT id, wrong, right, created_at FROM asr_corrections ORDER BY id ASC")
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?;

    let mut corrections = Vec::with_capacity(rows.len());
    for row in rows {
        corrections.push(AsrCorrection {
            id: row.try_get("id").map_err(|e| e.to_string())?,
            wrong: row.try_get("wrong").map_err(|e| e.to_string())?,
            right: row.try_get("right").map_err(|e| e.to_string())?,
            created_at: row.try_get("created_at").ok(),
        });
    }

    Ok(corrections)
}

#[tauri::command]
pub async fn add_correction<R: tauri::Runtime>(
    app: AppHandle<R>,
    wrong: String,
    right: String,
) -> Result<i64, String> {
    let trimmed_wrong = wrong.trim().to_string();
    let trimmed_right = right.trim().to_string();

    if trimmed_wrong.is_empty() || trimmed_right.is_empty() {
        return Err("Wrong and right values must not be empty".to_string());
    }

    let pool = get_or_init_pool(&app).await?;
    let res = sqlx::query(
        "INSERT INTO asr_corrections (wrong, right) VALUES (?1, ?2) ON CONFLICT(wrong) DO UPDATE SET right = excluded.right",
    )
    .bind(trimmed_wrong)
    .bind(trimmed_right)
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(res.last_insert_rowid())
}

#[tauri::command]
pub async fn delete_correction<R: tauri::Runtime>(
    app: AppHandle<R>,
    id: i64,
) -> Result<bool, String> {
    let pool = get_or_init_pool(&app).await?;
    let res = sqlx::query("DELETE FROM asr_corrections WHERE id = ?1")
        .bind(id)
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(res.rows_affected() > 0)
}

#[cfg(test)]
mod tests {

    #[test]
    fn vocab_db_path_matches_settings_database_path() {
        let db_path = crate::settings::database_path();
        assert!(db_path.ends_with(crate::settings::DB_FILE));
        assert!(db_path.to_string_lossy().contains(crate::settings::APP_IDENTIFIER));
    }
}
