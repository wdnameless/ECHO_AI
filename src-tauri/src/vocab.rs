use serde::{Deserialize, Serialize};
use sqlx::{sqlite::SqlitePoolOptions, Row, SqlitePool};
use std::sync::LazyLock;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
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

fn get_db_path<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    // Same file the SQL plugin preloads and migrates, in every mode.
    let mut path = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Failed to get app config dir: {}", e))?;
    path.push("pluely.db");
    Ok(path)
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
    let conn_str = format!("sqlite://{}", db_path.to_string_lossy());
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect(&conn_str)
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
