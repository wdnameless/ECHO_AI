use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// DTOs & Validation
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SystemPrompt {
    pub id: i64,
    pub name: String,
    pub prompt: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ChatMessageDto {
    pub id: String,
    pub role: String,
    pub content: String,
    pub timestamp: i64,
    #[serde(rename = "attachedFiles", default, skip_serializing_if = "Option::is_none")]
    pub attached_files: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ChatConversationDto {
    pub id: String,
    pub title: String,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
    #[serde(rename = "updatedAt")]
    pub updated_at: i64,
    #[serde(default)]
    pub messages: Vec<ChatMessageDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SeStyleDto {
    pub tone: String,
    #[serde(rename = "preferredLength")]
    pub preferred_length: String,
    #[serde(rename = "favoritePatterns")]
    pub favorite_patterns: Vec<String>,
    #[serde(rename = "avoidPatterns")]
    pub avoid_patterns: Vec<String>,
    #[serde(rename = "customRules")]
    pub custom_rules: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SeFeedbackDto {
    pub id: String,
    pub question: String,
    pub response: String,
    pub rating: String,
    pub reason: Option<String>,
    pub topic: Option<String>,
    pub timestamp: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RagContextDto {
    pub id: String,
    #[serde(rename = "type")]
    pub context_type: String,
    pub content: String,
    #[serde(rename = "sourceName")]
    pub source_name: Option<String>,
    #[serde(rename = "updatedAt")]
    pub updated_at: i64,
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

pub fn validate_system_prompt_input(name: &str, prompt: &str) -> Result<(String, String), String> {
    let name_trimmed = name.trim();
    if name_trimmed.is_empty() {
        return Err("System prompt name cannot be empty".to_string());
    }
    let prompt_trimmed = prompt.trim();
    if prompt_trimmed.is_empty() {
        return Err("System prompt text cannot be empty".to_string());
    }
    Ok((name_trimmed.to_string(), prompt_trimmed.to_string()))
}

pub fn validate_conversation(conv: &ChatConversationDto) -> Result<(), String> {
    if conv.id.trim().is_empty() {
        return Err("Invalid conversation: missing or invalid id".to_string());
    }
    if conv.title.trim().is_empty() {
        return Err("Invalid conversation: missing or invalid title".to_string());
    }
    for msg in &conv.messages {
        validate_message(msg)?;
    }
    Ok(())
}

pub fn validate_message(msg: &ChatMessageDto) -> Result<(), String> {
    if msg.id.trim().is_empty() {
        return Err("Invalid message: missing or invalid id".to_string());
    }
    if msg.role != "user" && msg.role != "assistant" && msg.role != "system" {
        return Err("Invalid message: missing or invalid role".to_string());
    }
    if msg.timestamp < 0 {
        return Err("Invalid message: invalid timestamp".to_string());
    }
    Ok(())
}

fn sanitize_source(source: Option<&str>) -> Option<String> {
    match source {
        Some("me") => Some("me".to_string()),
        Some("them") => Some("them".to_string()),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Database Connection
// ---------------------------------------------------------------------------

pub fn open_db() -> Result<Connection, String> {
    let db_path = crate::settings::ensure_database_path()?;
    let conn = Connection::open(&db_path)
        .map_err(|e| format!("failed to open database at {:?}: {e}", db_path))?;
    conn.busy_timeout(std::time::Duration::from_millis(5000))
        .map_err(|e| format!("failed to set busy timeout: {e}"))?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| format!("failed to enable foreign keys: {e}"))?;
    Ok(conn)
}

// ---------------------------------------------------------------------------
// System Prompt DB Operations
// ---------------------------------------------------------------------------

pub fn create_system_prompt_conn(
    conn: &Connection,
    name: &str,
    prompt: &str,
) -> Result<SystemPrompt, String> {
    let (name, prompt) = validate_system_prompt_input(name, prompt)?;
    conn.execute(
        "INSERT INTO system_prompts (name, prompt) VALUES (?1, ?2)",
        params![name, prompt],
    )
    .map_err(|e| format!("failed to insert system prompt: {e}"))?;

    let last_id = conn.last_insert_rowid();
    get_system_prompt_by_id_conn(conn, last_id)?
        .ok_or_else(|| "Failed to retrieve created system prompt".to_string())
}

pub fn get_all_system_prompts_conn(conn: &Connection) -> Result<Vec<SystemPrompt>, String> {
    let mut stmt = conn
        .prepare("SELECT id, name, prompt, created_at, updated_at FROM system_prompts ORDER BY created_at DESC")
        .map_err(|e| format!("failed to prepare select system prompts: {e}"))?;

    let prompts = stmt
        .query_map([], |row| {
            Ok(SystemPrompt {
                id: row.get(0)?,
                name: row.get(1)?,
                prompt: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })
        .map_err(|e| format!("failed to query system prompts: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("failed to collect system prompts: {e}"))?;

    Ok(prompts)
}

pub fn get_system_prompt_by_id_conn(
    conn: &Connection,
    id: i64,
) -> Result<Option<SystemPrompt>, String> {
    let mut stmt = conn
        .prepare("SELECT id, name, prompt, created_at, updated_at FROM system_prompts WHERE id = ?1")
        .map_err(|e| format!("failed to prepare select system prompt by id: {e}"))?;

    let prompt = stmt
        .query_row(params![id], |row| {
            Ok(SystemPrompt {
                id: row.get(0)?,
                name: row.get(1)?,
                prompt: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })
        .optional()
        .map_err(|e| format!("failed to query system prompt: {e}"))?;

    Ok(prompt)
}

pub fn update_system_prompt_conn(
    conn: &Connection,
    id: i64,
    name: Option<String>,
    prompt: Option<String>,
) -> Result<SystemPrompt, String> {
    let name_trimmed = match &name {
        Some(n) => {
            let t = n.trim();
            if t.is_empty() {
                return Err("System prompt name cannot be empty".to_string());
            }
            Some(t.to_string())
        }
        None => None,
    };

    let prompt_trimmed = match &prompt {
        Some(p) => {
            let t = p.trim();
            if t.is_empty() {
                return Err("System prompt text cannot be empty".to_string());
            }
            Some(t.to_string())
        }
        None => None,
    };

    match (&name_trimmed, &prompt_trimmed) {
        (Some(n), Some(p)) => {
            let rows = conn
                .execute(
                    "UPDATE system_prompts SET name = ?1, prompt = ?2 WHERE id = ?3",
                    params![n, p, id],
                )
                .map_err(|e| format!("failed to update system prompt: {e}"))?;
            if rows == 0 {
                return Err("System prompt not found".to_string());
            }
        }
        (Some(n), None) => {
            let rows = conn
                .execute(
                    "UPDATE system_prompts SET name = ?1 WHERE id = ?2",
                    params![n, id],
                )
                .map_err(|e| format!("failed to update system prompt: {e}"))?;
            if rows == 0 {
                return Err("System prompt not found".to_string());
            }
        }
        (None, Some(p)) => {
            let rows = conn
                .execute(
                    "UPDATE system_prompts SET prompt = ?1 WHERE id = ?2",
                    params![p, id],
                )
                .map_err(|e| format!("failed to update system prompt: {e}"))?;
            if rows == 0 {
                return Err("System prompt not found".to_string());
            }
        }
        (None, None) => {
            return Err("No fields to update".to_string());
        }
    }

    get_system_prompt_by_id_conn(conn, id)?
        .ok_or_else(|| "System prompt not found after update".to_string())
}

pub fn delete_system_prompt_conn(conn: &Connection, id: i64) -> Result<(), String> {
    let rows = conn
        .execute("DELETE FROM system_prompts WHERE id = ?1", params![id])
        .map_err(|e| format!("failed to delete system prompt: {e}"))?;

    if rows == 0 {
        return Err("System prompt not found".to_string());
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Chat History DB Operations
// ---------------------------------------------------------------------------

pub fn create_conversation_conn(
    conn: &mut Connection,
    mut conversation: ChatConversationDto,
) -> Result<ChatConversationDto, String> {
    validate_conversation(&conversation)?;

    // Oldest messages first for monotonic timestamp trigger contract
    conversation.messages.sort_by_key(|m| m.timestamp);

    let created_at = if conversation.created_at <= 0 {
        chrono_now_ms()
    } else {
        conversation.created_at
    };
    let updated_at = if conversation.updated_at <= 0 {
        created_at
    } else {
        conversation.updated_at
    };

    let tx = conn
        .transaction()
        .map_err(|e| format!("failed to start transaction: {e}"))?;

    tx.execute(
        "INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
        params![conversation.id, conversation.title, created_at, updated_at],
    )
    .map_err(|e| format!("failed to insert conversation: {e}"))?;

    for msg in &conversation.messages {
        let attached_files_json = msg
            .attached_files
            .as_ref()
            .map(|v| serde_json::to_string(v).unwrap_or_default());
        let source = sanitize_source(msg.source.as_deref());

        tx.execute(
            "INSERT INTO messages (id, conversation_id, role, content, timestamp, attached_files, source) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                msg.id,
                conversation.id,
                msg.role,
                msg.content,
                msg.timestamp,
                attached_files_json,
                source,
            ],
        )
        .map_err(|e| format!("failed to insert message {}: {e}", msg.id))?;
    }

    tx.commit()
        .map_err(|e| format!("failed to commit create conversation transaction: {e}"))?;

    conversation.created_at = created_at;
    conversation.updated_at = updated_at;
    Ok(conversation)
}

pub fn get_all_conversations_conn(conn: &Connection) -> Result<Vec<ChatConversationDto>, String> {
    let mut stmt = conn
        .prepare("SELECT id, title, created_at, updated_at FROM conversations ORDER BY updated_at DESC")
        .map_err(|e| format!("failed to prepare select conversations: {e}"))?;

    let conversations = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
            ))
        })
        .map_err(|e| format!("failed to query conversations: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("failed to collect conversations: {e}"))?;

    if conversations.is_empty() {
        return Ok(Vec::new());
    }

    let mut msg_stmt = conn
        .prepare("SELECT id, conversation_id, role, content, timestamp, attached_files, source FROM messages ORDER BY conversation_id, timestamp ASC")
        .map_err(|e| format!("failed to prepare select messages: {e}"))?;

    let mut messages_by_conv: std::collections::HashMap<String, Vec<ChatMessageDto>> =
        std::collections::HashMap::new();

    let msg_rows = msg_stmt
        .query_map([], |row| {
            let id: String = row.get(0)?;
            let conversation_id: String = row.get(1)?;
            let role: String = row.get(2)?;
            let content: String = row.get(3)?;
            let timestamp: i64 = row.get(4)?;
            let attached_files_raw: Option<String> = row.get(5)?;
            let source_raw: Option<String> = row.get(6)?;

            let attached_files = attached_files_raw.and_then(|raw| serde_json::from_str(&raw).ok());
            let source = sanitize_source(source_raw.as_deref());

            Ok((
                conversation_id,
                ChatMessageDto {
                    id,
                    role,
                    content,
                    timestamp,
                    attached_files,
                    source,
                },
            ))
        })
        .map_err(|e| format!("failed to query messages: {e}"))?;

    for row in msg_rows {
        let (conv_id, msg) = row.map_err(|e| format!("error reading message row: {e}"))?;
        messages_by_conv.entry(conv_id).or_default().push(msg);
    }

    let result = conversations
        .into_iter()
        .map(|(id, title, created_at, updated_at)| {
            let messages = messages_by_conv.remove(&id).unwrap_or_default();
            ChatConversationDto {
                id,
                title,
                created_at,
                updated_at,
                messages,
            }
        })
        .collect();

    Ok(result)
}

pub fn get_conversation_by_id_conn(
    conn: &Connection,
    id: &str,
) -> Result<Option<ChatConversationDto>, String> {
    if id.trim().is_empty() {
        return Err("Invalid conversation id".to_string());
    }

    let conv = conn
        .query_row(
            "SELECT id, title, created_at, updated_at FROM conversations WHERE id = ?1",
            params![id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            },
        )
        .optional()
        .map_err(|e| format!("failed to query conversation by id: {e}"))?;

    let Some((id, title, created_at, updated_at)) = conv else {
        return Ok(None);
    };

    let mut msg_stmt = conn
        .prepare("SELECT id, role, content, timestamp, attached_files, source FROM messages WHERE conversation_id = ?1 ORDER BY timestamp ASC")
        .map_err(|e| format!("failed to prepare select messages by conv id: {e}"))?;

    let messages = msg_stmt
        .query_map(params![&id], |row| {
            let msg_id: String = row.get(0)?;
            let role: String = row.get(1)?;
            let content: String = row.get(2)?;
            let timestamp: i64 = row.get(3)?;
            let attached_files_raw: Option<String> = row.get(4)?;
            let source_raw: Option<String> = row.get(5)?;

            let attached_files = attached_files_raw.and_then(|raw| serde_json::from_str(&raw).ok());
            let source = sanitize_source(source_raw.as_deref());

            Ok(ChatMessageDto {
                id: msg_id,
                role,
                content,
                timestamp,
                attached_files,
                source,
            })
        })
        .map_err(|e| format!("failed to query messages for conversation: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("failed to collect messages for conversation: {e}"))?;

    Ok(Some(ChatConversationDto {
        id,
        title,
        created_at,
        updated_at,
        messages,
    }))
}

pub fn update_conversation_conn(
    conn: &mut Connection,
    mut conversation: ChatConversationDto,
) -> Result<ChatConversationDto, String> {
    validate_conversation(&conversation)?;

    conversation.messages.sort_by_key(|m| m.timestamp);

    let tx = conn
        .transaction()
        .map_err(|e| format!("failed to begin update transaction: {e}"))?;

    let rows_updated = tx
        .execute(
            "UPDATE conversations SET title = ?1, updated_at = ?2 WHERE id = ?3",
            params![conversation.title, conversation.updated_at, conversation.id],
        )
        .map_err(|e| format!("failed to update conversation: {e}"))?;

    if rows_updated == 0 {
        return Err("Conversation not found".to_string());
    }

    let kept_ids: std::collections::HashSet<String> =
        conversation.messages.iter().map(|m| m.id.clone()).collect();

    for msg in &conversation.messages {
        let attached_files_json = msg
            .attached_files
            .as_ref()
            .map(|v| serde_json::to_string(v).unwrap_or_default());
        let source = sanitize_source(msg.source.as_deref());

        tx.execute(
            "INSERT OR REPLACE INTO messages (id, conversation_id, role, content, timestamp, attached_files, source) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                msg.id,
                conversation.id,
                msg.role,
                msg.content,
                msg.timestamp,
                attached_files_json,
                source,
            ],
        )
        .map_err(|e| format!("failed to upsert message {}: {e}", msg.id))?;
    }

    if kept_ids.is_empty() {
        tx.execute(
            "DELETE FROM messages WHERE conversation_id = ?1",
            params![conversation.id],
        )
        .map_err(|e| format!("failed to delete messages: {e}"))?;
    } else {
        let mut select_existing = tx
            .prepare("SELECT id FROM messages WHERE conversation_id = ?1")
            .map_err(|e| format!("failed to prepare existing messages query: {e}"))?;
        let existing_ids = select_existing
            .query_map(params![conversation.id], |row| row.get::<_, String>(0))
            .map_err(|e| format!("failed to query existing message ids: {e}"))?
            .collect::<Result<Vec<String>, _>>()
            .map_err(|e| format!("failed to collect existing message ids: {e}"))?;
        drop(select_existing);

        for id in existing_ids {
            if !kept_ids.contains(&id) {
                tx.execute(
                    "DELETE FROM messages WHERE conversation_id = ?1 AND id = ?2",
                    params![conversation.id, id],
                )
                .map_err(|e| format!("failed to delete pruned message {id}: {e}"))?;
            }
        }
    }

    tx.commit()
        .map_err(|e| format!("failed to commit update transaction: {e}"))?;

    Ok(conversation)
}

pub fn delete_conversation_conn(conn: &mut Connection, id: &str) -> Result<bool, String> {
    if id.trim().is_empty() {
        return Err("Invalid conversation id".to_string());
    }

    let tx = conn
        .transaction()
        .map_err(|e| format!("failed to begin delete transaction: {e}"))?;

    tx.execute("DELETE FROM messages WHERE conversation_id = ?1", params![id])
        .map_err(|e| format!("failed to delete messages for conversation {id}: {e}"))?;

    let rows = tx
        .execute("DELETE FROM conversations WHERE id = ?1", params![id])
        .map_err(|e| format!("failed to delete conversation {id}: {e}"))?;

    tx.commit()
        .map_err(|e| format!("failed to commit delete transaction: {e}"))?;

    Ok(rows > 0)
}

pub fn delete_all_conversations_conn(conn: &mut Connection) -> Result<(), String> {
    let tx = conn
        .transaction()
        .map_err(|e| format!("failed to begin delete all transaction: {e}"))?;

    tx.execute("DELETE FROM messages", [])
        .map_err(|e| format!("failed to delete all messages: {e}"))?;
    tx.execute("DELETE FROM conversations", [])
        .map_err(|e| format!("failed to delete all conversations: {e}"))?;

    tx.commit()
        .map_err(|e| format!("failed to commit delete all transaction: {e}"))?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Retention DB Operations
// ---------------------------------------------------------------------------

pub fn get_retention_days_conn(conn: &Connection) -> Result<u32, String> {
    let val = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = 'retention_days' LIMIT 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| format!("failed to get retention days: {e}"))?;

    let days = val.and_then(|s| s.parse::<u32>().ok()).unwrap_or(30);
    Ok(days)
}

pub fn set_retention_days_conn(conn: &Connection, days: u32) -> Result<(), String> {
    conn.execute(
        "INSERT INTO app_settings (key, value, updated_at) VALUES ('retention_days', ?1, unixepoch()) ON CONFLICT(key) DO UPDATE SET value = ?1, updated_at = unixepoch()",
        params![days.to_string()],
    )
    .map_err(|e| format!("failed to set retention days: {e}"))?;
    Ok(())
}

pub fn prune_old_conversations_conn(conn: &mut Connection, cutoff_ms: i64) -> Result<usize, String> {
    let tx = conn
        .transaction()
        .map_err(|e| format!("failed to start prune transaction: {e}"))?;

    let rows = tx
        .execute(
            "DELETE FROM conversations WHERE updated_at < ?1",
            params![cutoff_ms],
        )
        .map_err(|e| format!("failed to prune old conversations: {e}"))?;

    tx.commit()
        .map_err(|e| format!("failed to commit prune transaction: {e}"))?;

    Ok(rows)
}

// ---------------------------------------------------------------------------
// Self-Evolution DB Operations
// ---------------------------------------------------------------------------

pub fn save_se_style_conn(conn: &Connection, style: &SeStyleDto) -> Result<(), String> {
    let favs = serde_json::to_string(&style.favorite_patterns).unwrap_or_else(|_| "[]".to_string());
    let avoids = serde_json::to_string(&style.avoid_patterns).unwrap_or_else(|_| "[]".to_string());
    let rules = serde_json::to_string(&style.custom_rules).unwrap_or_else(|_| "[]".to_string());
    let now = chrono_now_ms();

    conn.execute(
        "INSERT INTO se_style (id, tone, preferred_length, favorite_patterns, avoid_patterns, custom_rules, updated_at)
         VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(id) DO UPDATE SET
           tone = excluded.tone,
           preferred_length = excluded.preferred_length,
           favorite_patterns = excluded.favorite_patterns,
           avoid_patterns = excluded.avoid_patterns,
           custom_rules = excluded.custom_rules,
           updated_at = excluded.updated_at",
        params![style.tone, style.preferred_length, favs, avoids, rules, now],
    )
    .map_err(|e| format!("failed to save se_style: {e}"))?;

    Ok(())
}

pub fn get_se_style_conn(conn: &Connection) -> Result<Option<SeStyleDto>, String> {
    let res = conn
        .query_row(
            "SELECT tone, preferred_length, favorite_patterns, avoid_patterns, custom_rules FROM se_style WHERE id = 1",
            [],
            |row| {
                let tone: String = row.get(0)?;
                let preferred_length: String = row.get(1)?;
                let favs_raw: String = row.get(2)?;
                let avoids_raw: String = row.get(3)?;
                let rules_raw: String = row.get(4)?;

                let favorite_patterns = serde_json::from_str(&favs_raw).unwrap_or_default();
                let avoid_patterns = serde_json::from_str(&avoids_raw).unwrap_or_default();
                let custom_rules = serde_json::from_str(&rules_raw).unwrap_or_default();

                Ok(SeStyleDto {
                    tone,
                    preferred_length,
                    favorite_patterns,
                    avoid_patterns,
                    custom_rules,
                })
            },
        )
        .optional()
        .map_err(|e| format!("failed to get se_style: {e}"))?;

    Ok(res)
}

pub fn append_se_feedback_conn(conn: &Connection, entry: &SeFeedbackDto) -> Result<(), String> {
    if entry.rating != "like" && entry.rating != "dislike" {
        return Err("Invalid rating: must be 'like' or 'dislike'".to_string());
    }

    conn.execute(
        "INSERT OR REPLACE INTO se_feedback_log (id, question, response, rating, reason, topic, timestamp) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            entry.id,
            entry.question,
            entry.response,
            entry.rating,
            entry.reason,
            entry.topic,
            entry.timestamp,
        ],
    )
    .map_err(|e| format!("failed to insert se_feedback_log: {e}"))?;

    Ok(())
}

pub fn get_se_feedback_conn(conn: &Connection, limit: u32) -> Result<Vec<SeFeedbackDto>, String> {
    let mut stmt = conn
        .prepare("SELECT id, question, response, rating, reason, topic, timestamp FROM se_feedback_log ORDER BY timestamp DESC LIMIT ?1")
        .map_err(|e| format!("failed to prepare select se_feedback: {e}"))?;

    let rows = stmt
        .query_map(params![limit], |row| {
            Ok(SeFeedbackDto {
                id: row.get(0)?,
                question: row.get(1)?,
                response: row.get(2)?,
                rating: row.get(3)?,
                reason: row.get(4)?,
                topic: row.get(5)?,
                timestamp: row.get(6)?,
            })
        })
        .map_err(|e| format!("failed to query se_feedback: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("failed to collect se_feedback: {e}"))?;

    Ok(rows)
}

pub fn reset_se_data_conn(conn: &mut Connection) -> Result<(), String> {
    let now = chrono_now_ms();
    let tx = conn
        .transaction()
        .map_err(|e| format!("failed to start reset se transaction: {e}"))?;

    tx.execute("DELETE FROM se_feedback_log", [])
        .map_err(|e| format!("failed to delete se_feedback_log: {e}"))?;
    tx.execute("DELETE FROM se_style", [])
        .map_err(|e| format!("failed to delete se_style: {e}"))?;
    tx.execute(
        "INSERT OR REPLACE INTO se_style (id, tone, preferred_length, favorite_patterns, avoid_patterns, custom_rules, updated_at)
         VALUES (1, 'живой, естественный', 'concise', '[]', '[]', '[]', ?1)",
        params![now],
    )
    .map_err(|e| format!("failed to reseed se_style: {e}"))?;

    tx.commit()
        .map_err(|e| format!("failed to commit reset se transaction: {e}"))?;

    Ok(())
}

// ---------------------------------------------------------------------------
// RAG Context DB Operations
// ---------------------------------------------------------------------------

pub fn get_rag_context_conn(
    conn: &Connection,
    context_type: &str,
) -> Result<Option<RagContextDto>, String> {
    let res = conn
        .query_row(
            "SELECT id, type, content, source_name, updated_at FROM rag_contexts WHERE type = ?1 LIMIT 1",
            params![context_type],
            |row| {
                Ok(RagContextDto {
                    id: row.get(0)?,
                    context_type: row.get(1)?,
                    content: row.get(2)?,
                    source_name: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            },
        )
        .optional()
        .map_err(|e| format!("failed to get rag_context: {e}"))?;

    Ok(res)
}

pub fn save_rag_context_conn(
    conn: &Connection,
    context_type: &str,
    content: &str,
    source_name: Option<String>,
) -> Result<(), String> {
    if context_type != "resume" && context_type != "job" {
        return Err("Invalid rag context type: must be 'resume' or 'job'".to_string());
    }
    let now = chrono_now_ms();

    conn.execute(
        "INSERT OR REPLACE INTO rag_contexts (id, type, content, source_name, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![context_type, context_type, content, source_name, now],
    )
    .map_err(|e| format!("failed to save rag_context: {e}"))?;

    Ok(())
}

pub fn delete_rag_context_conn(conn: &Connection, context_type: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM rag_contexts WHERE type = ?1",
        params![context_type],
    )
    .map_err(|e| format!("failed to delete rag_context: {e}"))?;
    Ok(())
}

pub fn get_all_rag_contexts_conn(conn: &Connection) -> Result<Vec<RagContextDto>, String> {
    let mut stmt = conn
        .prepare("SELECT id, type, content, source_name, updated_at FROM rag_contexts ORDER BY updated_at DESC")
        .map_err(|e| format!("failed to prepare select rag_contexts: {e}"))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(RagContextDto {
                id: row.get(0)?,
                context_type: row.get(1)?,
                content: row.get(2)?,
                source_name: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })
        .map_err(|e| format!("failed to query rag_contexts: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("failed to collect rag_contexts: {e}"))?;

    Ok(rows)
}

fn chrono_now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Tauri Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn db_create_system_prompt(name: String, prompt: String) -> Result<SystemPrompt, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db()?;
        create_system_prompt_conn(&conn, &name, &prompt)
    })
    .await
    .map_err(|e| format!("task join error: {e}"))?
}

#[tauri::command]
pub async fn db_get_all_system_prompts() -> Result<Vec<SystemPrompt>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db()?;
        get_all_system_prompts_conn(&conn)
    })
    .await
    .map_err(|e| format!("task join error: {e}"))?
}

#[tauri::command]
pub async fn db_get_system_prompt_by_id(id: i64) -> Result<Option<SystemPrompt>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db()?;
        get_system_prompt_by_id_conn(&conn, id)
    })
    .await
    .map_err(|e| format!("task join error: {e}"))?
}

#[tauri::command]
pub async fn db_update_system_prompt(
    id: i64,
    name: Option<String>,
    prompt: Option<String>,
) -> Result<SystemPrompt, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db()?;
        update_system_prompt_conn(&conn, id, name, prompt)
    })
    .await
    .map_err(|e| format!("task join error: {e}"))?
}

#[tauri::command]
pub async fn db_delete_system_prompt(id: i64) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db()?;
        delete_system_prompt_conn(&conn, id)
    })
    .await
    .map_err(|e| format!("task join error: {e}"))?
}

#[tauri::command]
pub async fn db_create_conversation(
    conversation: ChatConversationDto,
) -> Result<ChatConversationDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = open_db()?;
        create_conversation_conn(&mut conn, conversation)
    })
    .await
    .map_err(|e| format!("task join error: {e}"))?
}

#[tauri::command]
pub async fn db_get_all_conversations() -> Result<Vec<ChatConversationDto>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db()?;
        get_all_conversations_conn(&conn)
    })
    .await
    .map_err(|e| format!("task join error: {e}"))?
}

#[tauri::command]
pub async fn db_get_conversation_by_id(
    id: String,
) -> Result<Option<ChatConversationDto>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db()?;
        get_conversation_by_id_conn(&conn, &id)
    })
    .await
    .map_err(|e| format!("task join error: {e}"))?
}

#[tauri::command]
pub async fn db_update_conversation(
    conversation: ChatConversationDto,
) -> Result<ChatConversationDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = open_db()?;
        update_conversation_conn(&mut conn, conversation)
    })
    .await
    .map_err(|e| format!("task join error: {e}"))?
}

#[tauri::command]
pub async fn db_delete_conversation(id: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = open_db()?;
        delete_conversation_conn(&mut conn, &id)
    })
    .await
    .map_err(|e| format!("task join error: {e}"))?
}

#[tauri::command]
pub async fn db_delete_all_conversations() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = open_db()?;
        delete_all_conversations_conn(&mut conn)
    })
    .await
    .map_err(|e| format!("task join error: {e}"))?
}

#[tauri::command]
pub async fn db_get_retention_days() -> Result<u32, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db()?;
        get_retention_days_conn(&conn)
    })
    .await
    .map_err(|e| format!("task join error: {e}"))?
}

#[tauri::command]
pub async fn db_set_retention_days(days: u32) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db()?;
        set_retention_days_conn(&conn, days)
    })
    .await
    .map_err(|e| format!("task join error: {e}"))?
}

#[tauri::command]
pub async fn db_prune_old_conversations(cutoff_ms: i64) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = open_db()?;
        prune_old_conversations_conn(&mut conn, cutoff_ms)
    })
    .await
    .map_err(|e| format!("task join error: {e}"))?
}

#[tauri::command]
pub async fn db_save_se_style(style: SeStyleDto) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db()?;
        save_se_style_conn(&conn, &style)
    })
    .await
    .map_err(|e| format!("task join error: {e}"))?
}

#[tauri::command]
pub async fn db_get_se_style() -> Result<Option<SeStyleDto>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db()?;
        get_se_style_conn(&conn)
    })
    .await
    .map_err(|e| format!("task join error: {e}"))?
}

#[tauri::command]
pub async fn db_append_se_feedback(entry: SeFeedbackDto) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db()?;
        append_se_feedback_conn(&conn, &entry)
    })
    .await
    .map_err(|e| format!("task join error: {e}"))?
}

#[tauri::command]
pub async fn db_get_se_feedback(limit: u32) -> Result<Vec<SeFeedbackDto>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db()?;
        get_se_feedback_conn(&conn, limit)
    })
    .await
    .map_err(|e| format!("task join error: {e}"))?
}

#[tauri::command]
pub async fn db_reset_se_data() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = open_db()?;
        reset_se_data_conn(&mut conn)
    })
    .await
    .map_err(|e| format!("task join error: {e}"))?
}

#[tauri::command]
pub async fn db_get_rag_context(context_type: String) -> Result<Option<RagContextDto>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db()?;
        get_rag_context_conn(&conn, &context_type)
    })
    .await
    .map_err(|e| format!("task join error: {e}"))?
}

#[tauri::command]
pub async fn db_save_rag_context(
    context_type: String,
    content: String,
    source_name: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db()?;
        save_rag_context_conn(&conn, &context_type, &content, source_name)
    })
    .await
    .map_err(|e| format!("task join error: {e}"))?
}

#[tauri::command]
pub async fn db_delete_rag_context(context_type: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db()?;
        delete_rag_context_conn(&conn, &context_type)
    })
    .await
    .map_err(|e| format!("task join error: {e}"))?
}

#[tauri::command]
pub async fn db_get_all_rag_contexts() -> Result<Vec<RagContextDto>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db()?;
        get_all_rag_contexts_conn(&conn)
    })
    .await
    .map_err(|e| format!("task join error: {e}"))?
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;

    fn test_db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.busy_timeout(std::time::Duration::from_millis(5000)).unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        for m in migrations() {
            conn.execute_batch(m.sql).unwrap();
        }
        conn
    }

    #[test]
    fn test_system_prompt_validation() {
        assert!(validate_system_prompt_input("", "prompt").is_err());
        assert!(validate_system_prompt_input("   ", "prompt").is_err());
        assert!(validate_system_prompt_input("name", "").is_err());
        assert!(validate_system_prompt_input("name", "   ").is_err());
        assert!(validate_system_prompt_input("  name  ", "  prompt  ").is_ok());
    }

    #[test]
    fn test_system_prompt_crud() {
        let conn = test_db();

        let created = create_system_prompt_conn(&conn, "Test Prompt", "Be concise").unwrap();
        assert_eq!(created.name, "Test Prompt");
        assert_eq!(created.prompt, "Be concise");

        let fetched = get_system_prompt_by_id_conn(&conn, created.id).unwrap().unwrap();
        assert_eq!(fetched.id, created.id);
        assert_eq!(fetched.name, "Test Prompt");

        let all = get_all_system_prompts_conn(&conn).unwrap();
        assert_eq!(all.len(), 1);

        let updated = update_system_prompt_conn(&conn, created.id, Some("Updated".into()), None).unwrap();
        assert_eq!(updated.name, "Updated");
        assert_eq!(updated.prompt, "Be concise");

        delete_system_prompt_conn(&conn, created.id).unwrap();
        let after_delete = get_system_prompt_by_id_conn(&conn, created.id).unwrap();
        assert!(after_delete.is_none());
    }

    #[test]
    fn test_conversation_validation() {
        let mut conv = ChatConversationDto {
            id: "".into(),
            title: "Title".into(),
            created_at: 1000,
            updated_at: 1000,
            messages: vec![],
        };
        assert!(validate_conversation(&conv).is_err());

        conv.id = "c1".into();
        conv.title = "   ".into();
        assert!(validate_conversation(&conv).is_err());

        conv.title = "Title".into();
        conv.messages = vec![ChatMessageDto {
            id: "m1".into(),
            role: "invalid_role".into(),
            content: "hello".into(),
            timestamp: 100,
            attached_files: None,
            source: None,
        }];
        assert!(validate_conversation(&conv).is_err());

        conv.messages[0].role = "user".into();
        conv.messages[0].timestamp = -5;
        assert!(validate_conversation(&conv).is_err());

        conv.messages[0].timestamp = 100;
        assert!(validate_conversation(&conv).is_ok());
    }

    #[test]
    fn test_conversation_crud_and_message_source() {
        let mut conn = test_db();

        let conv = ChatConversationDto {
            id: "conv-1".into(),
            title: "Interview".into(),
            created_at: 1000,
            updated_at: 2000,
            messages: vec![
                ChatMessageDto {
                    id: "m-1".into(),
                    role: "user".into(),
                    content: "Question".into(),
                    timestamp: 1100,
                    attached_files: None,
                    source: Some("them".into()),
                },
                ChatMessageDto {
                    id: "m-2".into(),
                    role: "assistant".into(),
                    content: "Answer".into(),
                    timestamp: 1200,
                    attached_files: None,
                    source: None,
                },
                ChatMessageDto {
                    id: "m-3".into(),
                    role: "user".into(),
                    content: "Followup".into(),
                    timestamp: 1300,
                    attached_files: None,
                    source: Some("me".into()),
                },
            ],
        };

        let created = create_conversation_conn(&mut conn, conv.clone()).unwrap();
        assert_eq!(created.id, "conv-1");

        let fetched = get_conversation_by_id_conn(&conn, "conv-1").unwrap().unwrap();
        assert_eq!(fetched.title, "Interview");
        assert_eq!(fetched.messages.len(), 3);
        assert_eq!(fetched.messages[0].source, Some("them".into()));
        assert_eq!(fetched.messages[1].source, None);
        assert_eq!(fetched.messages[2].source, Some("me".into()));

        // Update: prune message m-2, add m-4
        let update_input = ChatConversationDto {
            id: "conv-1".into(),
            title: "Interview Updated".into(),
            created_at: 1000,
            updated_at: 3000,
            messages: vec![
                ChatMessageDto {
                    id: "m-1".into(),
                    role: "user".into(),
                    content: "Question".into(),
                    timestamp: 1100,
                    attached_files: None,
                    source: Some("them".into()),
                },
                ChatMessageDto {
                    id: "m-4".into(),
                    role: "user".into(),
                    content: "New Msg".into(),
                    timestamp: 1400,
                    attached_files: None,
                    source: Some("me".into()),
                },
            ],
        };

        let updated = update_conversation_conn(&mut conn, update_input).unwrap();
        assert_eq!(updated.title, "Interview Updated");

        let fetched_updated = get_conversation_by_id_conn(&conn, "conv-1").unwrap().unwrap();
        assert_eq!(fetched_updated.messages.len(), 2);
        assert_eq!(fetched_updated.messages[0].id, "m-1");
        assert_eq!(fetched_updated.messages[1].id, "m-4");

        let deleted = delete_conversation_conn(&mut conn, "conv-1").unwrap();
        assert!(deleted);
        assert!(get_conversation_by_id_conn(&conn, "conv-1").unwrap().is_none());
    }

    #[test]
    fn test_retention_and_pruning() {
        let mut conn = test_db();

        assert_eq!(get_retention_days_conn(&conn).unwrap(), 30);
        set_retention_days_conn(&conn, 60).unwrap();
        assert_eq!(get_retention_days_conn(&conn).unwrap(), 60);

        // Insert two conversations with different updated_at
        let c1 = ChatConversationDto {
            id: "old".into(),
            title: "Old".into(),
            created_at: 1000,
            updated_at: 1000,
            messages: vec![],
        };
        let c2 = ChatConversationDto {
            id: "new".into(),
            title: "New".into(),
            created_at: 5000,
            updated_at: 5000,
            messages: vec![],
        };
        create_conversation_conn(&mut conn, c1).unwrap();
        create_conversation_conn(&mut conn, c2).unwrap();

        let pruned = prune_old_conversations_conn(&mut conn, 3000).unwrap();
        assert_eq!(pruned, 1);
        assert!(get_conversation_by_id_conn(&conn, "old").unwrap().is_none());
        assert!(get_conversation_by_id_conn(&conn, "new").unwrap().is_some());
    }

    #[test]
    fn test_rag_context() {
        let conn = test_db();

        save_rag_context_conn(&conn, "resume", "Candidate Resume", Some("resume.pdf".into())).unwrap();
        let fetched = get_rag_context_conn(&conn, "resume").unwrap().unwrap();
        assert_eq!(fetched.content, "Candidate Resume");
        assert_eq!(fetched.source_name, Some("resume.pdf".into()));

        let all = get_all_rag_contexts_conn(&conn).unwrap();
        assert_eq!(all.len(), 1);

        delete_rag_context_conn(&conn, "resume").unwrap();
        assert!(get_rag_context_conn(&conn, "resume").unwrap().is_none());
    }

    #[test]
    fn test_self_evolution() {
        let mut conn = test_db();

        let style = SeStyleDto {
            tone: "professional".into(),
            preferred_length: "concise".into(),
            favorite_patterns: vec!["bullet points".into()],
            avoid_patterns: vec!["slang".into()],
            custom_rules: vec!["be direct".into()],
        };
        save_se_style_conn(&conn, &style).unwrap();
        let fetched_style = get_se_style_conn(&conn).unwrap().unwrap();
        assert_eq!(fetched_style.tone, "professional");
        assert_eq!(fetched_style.favorite_patterns, vec!["bullet points"]);

        let feedback = SeFeedbackDto {
            id: "fb-1".into(),
            question: "Q".into(),
            response: "A".into(),
            rating: "like".into(),
            reason: Some("good".into()),
            topic: None,
            timestamp: 1000,
        };
        append_se_feedback_conn(&conn, &feedback).unwrap();
        let log = get_se_feedback_conn(&conn, 10).unwrap();
        assert_eq!(log.len(), 1);
        assert_eq!(log[0].id, "fb-1");

        reset_se_data_conn(&mut conn).unwrap();
        let reset_log = get_se_feedback_conn(&conn, 10).unwrap();
        assert_eq!(reset_log.len(), 0);
    }
}
