-- Migration 5: User vocabulary ASR corrections

CREATE TABLE IF NOT EXISTS asr_corrections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wrong TEXT NOT NULL UNIQUE,
    right TEXT NOT NULL,
    created_at INTEGER DEFAULT (unixepoch())
);
