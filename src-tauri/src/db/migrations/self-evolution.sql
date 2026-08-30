-- Migration 4: Self-Evolution persistence (survives WebView storage clears)

CREATE TABLE IF NOT EXISTS se_style (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    tone TEXT NOT NULL,
    preferred_length TEXT NOT NULL DEFAULT 'concise',
    favorite_patterns TEXT NOT NULL DEFAULT '[]',
    avoid_patterns TEXT NOT NULL DEFAULT '[]',
    custom_rules TEXT NOT NULL DEFAULT '[]',
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS se_feedback_log (
    id TEXT PRIMARY KEY,
    question TEXT NOT NULL,
    response TEXT NOT NULL,
    rating TEXT NOT NULL CHECK (rating IN ('like', 'dislike')),
    reason TEXT,
    topic TEXT,
    timestamp INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_se_feedback_ts ON se_feedback_log (timestamp DESC);

INSERT OR IGNORE INTO se_style (id, tone, preferred_length, updated_at)
VALUES (1, 'живой, естественный', 'concise', strftime('%s','now') * 1000);