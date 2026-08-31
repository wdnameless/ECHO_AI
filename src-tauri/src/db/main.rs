use tauri_plugin_sql::{Migration, MigrationKind};

/// Returns all database migrations
pub fn migrations() -> Vec<Migration> {
    vec![
        // Migration 1: Create system_prompts table with indexes and triggers
        Migration {
            version: 1,
            description: "create_system_prompts_table",
            sql: include_str!("migrations/system-prompts.sql"),
            kind: MigrationKind::Up,
        },
        // Migration 2: Create chat history tables (conversations and messages)
        Migration {
            version: 2,
            description: "create_chat_history_tables",
            sql: include_str!("migrations/chat-history.sql"),
            kind: MigrationKind::Up,
        },
        // Migration 3: Create RAG context tables (resume and job description)
        Migration {
            version: 3,
            description: "create_rag_contexts_table",
            sql: include_str!("migrations/rag-contexts.sql"),
            kind: MigrationKind::Up,
        },
        // Migration 4: Self-Evolution persistence (style profile + feedback log)
        Migration {
            version: 4,
            description: "create_self_evolution_tables",
            sql: include_str!("migrations/self-evolution.sql"),
            kind: MigrationKind::Up,
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

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
    }
}
