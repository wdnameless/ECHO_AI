-- Create rag_contexts table for resume/job context storage
CREATE TABLE IF NOT EXISTS rag_contexts (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK(type IN ('resume', 'job')),
    content TEXT NOT NULL,
    source_name TEXT,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rag_contexts_type ON rag_contexts(type);
