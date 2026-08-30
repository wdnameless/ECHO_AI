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
