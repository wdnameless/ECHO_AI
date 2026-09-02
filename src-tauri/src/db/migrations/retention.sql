-- Migration 6: Retention settings and conversation retention
-- Adds app_settings table if not exists for key-value retention and general configuration

CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER DEFAULT (unixepoch())
);

-- Insert default retention period: 30 days (0 = keep forever)
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('retention_days', '30');
