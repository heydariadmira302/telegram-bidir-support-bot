ALTER TABLE message_logs ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE message_logs ADD COLUMN bot_id TEXT NOT NULL DEFAULT 'default';

CREATE INDEX IF NOT EXISTS idx_message_logs_workspace_bot_user ON message_logs(workspace_id, bot_id, user_chat_id, created_at);
