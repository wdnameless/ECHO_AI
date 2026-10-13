use std::sync::Once;
use rusqlite::ffi::sqlite3_auto_extension;
use sqlite_vec::sqlite3_vec_init;

pub const EMBEDDING_DIM: usize = 384;

static VEC_INIT: Once = Once::new();

type SqliteExtensionInitFn = unsafe extern "C" fn(
    *mut rusqlite::ffi::sqlite3,
    *mut *mut std::os::raw::c_char,
    *const rusqlite::ffi::sqlite3_api_routines,
) -> std::os::raw::c_int;

pub fn init_sqlite_vec() {
    VEC_INIT.call_once(|| {
        unsafe {
            // SAFETY: `sqlite3_vec_init` is the C extension entry point exported by `sqlite-vec`.
            // Its ABI and parameters conform to the SQLite extension initialization function
            // pointer expected by `sqlite3_auto_extension`.
            let init_fn = std::mem::transmute::<*const (), SqliteExtensionInitFn>(
                sqlite3_vec_init as *const (),
            );
            sqlite3_auto_extension(Some(init_fn));
        }
    });
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct MemoryHit {
    #[serde(rename = "conversationId")]
    pub conversation_id: String,
    #[serde(rename = "chunkId")]
    pub chunk_id: String,
    pub score: f64,
    pub text: String,
}

/// Fallback offline deterministic text embedder producing 384-dimensional unit vector.
pub fn local_embed_text(text: &str) -> Vec<f32> {
    let mut vec = vec![0.0f32; EMBEDDING_DIM];
    let lower = text.to_lowercase();
    let words: Vec<&str> = lower.split_whitespace().collect();
    if words.is_empty() {
        return vec;
    }

    for (pos, word) in words.iter().enumerate() {
        let clean: String = word.chars().filter(|c| c.is_alphanumeric()).collect();
        if clean.is_empty() {
            continue;
        }

        let h1 = hash_str(&clean);
        let idx1 = (h1 as usize) % EMBEDDING_DIM;
        let sign1 = if ((h1 >> 16) & 1) == 0 { 1.0f32 } else { -1.0f32 };
        let weight = 1.0 / ((pos as f32).sqrt() + 1.0);
        vec[idx1] += sign1 * (1.0 + weight);

        let chars: Vec<char> = clean.chars().collect();
        if chars.len() >= 3 {
            for window in chars.windows(3) {
                let s: String = window.iter().collect();
                let h = hash_str(&s);
                let idx = (h as usize) % EMBEDDING_DIM;
                let sign = if ((h >> 16) & 1) == 0 { 1.0f32 } else { -1.0f32 };
                vec[idx] += sign * 0.5;
            }
        }
    }

    let norm: f32 = vec.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm > 1e-6 {
        for v in vec.iter_mut() {
            *v /= norm;
        }
    }
    vec
}

fn hash_str(s: &str) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    s.hash(&mut hasher);
    hasher.finish()
}

pub fn ensure_memory_tables(conn: &rusqlite::Connection) -> Result<(), String> {
    init_sqlite_vec();
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS memory_chunks (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            chunk_index INTEGER NOT NULL,
            text TEXT NOT NULL,
            embedding BLOB,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_memory_chunks_conv ON memory_chunks(conversation_id);
        CREATE VIRTUAL TABLE IF NOT EXISTS vec_memory_chunks USING vec0(
            rowid INTEGER PRIMARY KEY,
            embedding float[384] distance_metric=cosine
        );",
    )
    .map_err(|e| format!("failed to initialize memory tables: {e}"))?;
    Ok(())
}

pub fn index_chunks_conn(
    conn: &mut rusqlite::Connection,
    conversation_id: &str,
    chunks: &[String],
    vectors: Option<&[Vec<f32>]>,
) -> Result<u32, String> {
    ensure_memory_tables(conn)?;
    let tx = conn.transaction().map_err(|e| format!("failed to begin tx: {e}"))?;
    // Clear previous chunks for conversation to prevent stale duplicates
    tx.execute(
        "DELETE FROM vec_memory_chunks WHERE rowid IN (SELECT rowid FROM memory_chunks WHERE conversation_id = ?1)",
        [conversation_id],
    ).map_err(|e| format!("failed to delete old vec_memory_chunks: {e}"))?;
    tx.execute(
        "DELETE FROM memory_chunks WHERE conversation_id = ?1",
        [conversation_id],
    ).map_err(|e| format!("failed to delete old memory_chunks: {e}"))?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;

    let mut count = 0u32;
    for (idx, chunk) in chunks.iter().enumerate() {
        let chunk_id = format!("{}:{}", conversation_id, idx);
        let vector = match vectors.and_then(|v| v.get(idx)) {
            Some(v) => v.clone(),
            None => local_embed_text(chunk),
        };
        let vector_bytes: &[u8] = bytemuck::cast_slice(&vector);

        tx.execute(
            "INSERT INTO memory_chunks (id, conversation_id, chunk_index, text, embedding, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![chunk_id, conversation_id, idx as i64, chunk, vector_bytes, now],
        ).map_err(|e| format!("failed to insert memory chunk: {e}"))?;

        let rowid = tx.last_insert_rowid();

        tx.execute(
            "INSERT INTO vec_memory_chunks (rowid, embedding) VALUES (?1, ?2)",
            rusqlite::params![rowid, vector_bytes],
        ).map_err(|e| format!("failed to insert vec_memory_chunk: {e}"))?;

        count += 1;
    }

    tx.commit().map_err(|e| format!("failed to commit tx: {e}"))?;
    Ok(count)
}

pub fn search_memory_conn(
    conn: &rusqlite::Connection,
    query: &str,
    limit: u32,
    query_vector: Option<&[f32]>,
) -> Result<Vec<MemoryHit>, String> {
    ensure_memory_tables(conn)?;
    let computed_vec;
    let query_vec = match query_vector {
        Some(v) => v,
        None => {
            computed_vec = local_embed_text(query);
            &computed_vec[..]
        }
    };
    let query_bytes: &[u8] = bytemuck::cast_slice(query_vec);

    let mut stmt = conn.prepare(
        "SELECT c.conversation_id, c.id, c.text, v.distance
         FROM vec_memory_chunks v
         JOIN memory_chunks c ON c.rowid = v.rowid
         WHERE v.embedding MATCH ?1 AND k = ?2
         ORDER BY v.distance ASC",
    ).map_err(|e| format!("failed to prepare search statement: {e}"))?;

    let hits = stmt.query_map(
        rusqlite::params![query_bytes, limit as i64],
        |row| {
            let conversation_id: String = row.get(0)?;
            let chunk_id: String = row.get(1)?;
            let text: String = row.get(2)?;
            let distance: f64 = row.get(3)?;
            let score = (1.0 - distance).max(0.0);
            Ok(MemoryHit {
                conversation_id,
                chunk_id,
                score,
                text,
            })
        },
    ).map_err(|e| format!("search query execution failed: {e}"))?
    .filter_map(|r| r.ok())
    .collect();

    Ok(hits)
}

fn open_app_db() -> Result<rusqlite::Connection, String> {
    let db_path = crate::settings::ensure_database_path()?;
    rusqlite::Connection::open(&db_path).map_err(|e| format!("failed to open database at {:?}: {e}", db_path))
}

#[tauri::command]
pub async fn memory_index(
    conversation_id: String,
    chunks: Vec<String>,
    vectors: Option<Vec<Vec<f32>>>,
) -> Result<u32, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = open_app_db()?;
        index_chunks_conn(&mut conn, &conversation_id, &chunks, vectors.as_deref())
    })
    .await
    .map_err(|e| format!("task join error: {e}"))?
}

#[tauri::command]
pub async fn memory_search(
    query: String,
    limit: u32,
    query_vector: Option<Vec<f32>>,
) -> Result<Vec<MemoryHit>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_app_db()?;
        search_memory_conn(&conn, &query, limit, query_vector.as_deref())
    })
    .await
    .map_err(|e| format!("task join error: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sqlite_vec_roundtrip() {
        init_sqlite_vec();
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        ensure_memory_tables(&conn).unwrap();

        let chunks = vec![
            "John mentioned the new API design uses GraphQL and WebSocket".to_string(),
            "We talked about pizza for lunch tomorrow".to_string(),
            "The budget report needs review before Friday".to_string(),
        ];

        let indexed = index_chunks_conn(&mut conn, "meeting-123", &chunks, None).unwrap();
        assert_eq!(indexed, 3);

        // Search for API
        let hits = search_memory_conn(&conn, "what did John say about the API?", 2, None).unwrap();
        assert!(!hits.is_empty());
        assert_eq!(hits[0].conversation_id, "meeting-123");
        assert!(hits[0].text.contains("API design"));
        assert!(hits[0].score > 0.0);

        // Search for pizza
        let hits_pizza = search_memory_conn(&conn, "pizza lunch", 2, None).unwrap();
        assert!(!hits_pizza.is_empty());
        assert!(hits_pizza[0].text.contains("pizza"));
    }

    #[test]
    fn test_custom_vectors_roundtrip() {
        init_sqlite_vec();
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        ensure_memory_tables(&conn).unwrap();

        let mut v1 = vec![0.0f32; 384];
        v1[0] = 1.0;
        let mut v2 = vec![0.0f32; 384];
        v2[1] = 1.0;

        let chunks = vec![
            "Chunk one".to_string(),
            "Chunk two".to_string(),
        ];
        let vectors = vec![v1.clone(), v2.clone()];

        index_chunks_conn(&mut conn, "conv-custom", &chunks, Some(&vectors)).unwrap();

        // Query matching v1
        let hits = search_memory_conn(&conn, "query", 1, Some(&v1)).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].text, "Chunk one");
    }
}
