-- Migration 8: Ensure conversation updated_at advances monotonically
--
-- Migration 2 triggers unconditionally set updated_at = NEW.timestamp.
-- When updating conversations containing older messages, batch-inserting
-- messages rewound conversations.updated_at to old timestamps, making an active
-- conversation look expired to concurrent retention cleanup.
--
DROP TRIGGER IF EXISTS update_conversation_timestamp_on_message_insert;
DROP TRIGGER IF EXISTS update_conversation_timestamp_on_message_update;

CREATE TRIGGER IF NOT EXISTS update_conversation_timestamp_on_message_insert
AFTER INSERT ON messages
FOR EACH ROW
WHEN NEW.timestamp > (SELECT updated_at FROM conversations WHERE id = NEW.conversation_id)
BEGIN
    UPDATE conversations 
    SET updated_at = MAX(updated_at, NEW.timestamp) 
    WHERE id = NEW.conversation_id;
END;

CREATE TRIGGER IF NOT EXISTS update_conversation_timestamp_on_message_update
AFTER UPDATE ON messages
FOR EACH ROW
WHEN NEW.timestamp > (SELECT updated_at FROM conversations WHERE id = NEW.conversation_id)
BEGIN
    UPDATE conversations 
    SET updated_at = MAX(updated_at, NEW.timestamp) 
    WHERE id = NEW.conversation_id;
END;
