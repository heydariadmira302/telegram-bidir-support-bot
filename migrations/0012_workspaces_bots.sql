CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bots (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  token_encrypted TEXT,
  token_hint TEXT,
  webhook_secret TEXT,
  public_url TEXT,
  support_chat_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO workspaces (id, name) VALUES ('default', '默认工作区');
INSERT OR IGNORE INTO bots (id, workspace_id, name, enabled, is_default)
  VALUES ('default', 'default', '默认 Bot', 1, 1);

ALTER TABLE users ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE users ADD COLUMN bot_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE message_links ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE message_links ADD COLUMN bot_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE blocked_users ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE blocked_users ADD COLUMN bot_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE quick_replies ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE quick_replies ADD COLUMN bot_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE keyword_replies ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE keyword_replies ADD COLUMN bot_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE admins ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE admins ADD COLUMN bot_id TEXT;
ALTER TABLE broadcasts ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE broadcasts ADD COLUMN bot_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE broadcast_results ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE broadcast_results ADD COLUMN bot_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE sensitive_words ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE sensitive_words ADD COLUMN bot_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE audit_logs ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE audit_logs ADD COLUMN bot_id TEXT;
ALTER TABLE ai_providers ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE ai_models ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE kb_import_batches ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE kb_raw_messages ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE kb_entries ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default';

CREATE INDEX IF NOT EXISTS idx_bots_workspace ON bots(workspace_id, enabled);
CREATE INDEX IF NOT EXISTS idx_users_workspace_bot ON users(workspace_id, bot_id, last_message_at);
CREATE INDEX IF NOT EXISTS idx_message_links_workspace_bot ON message_links(workspace_id, bot_id, support_chat_id, support_message_id);
CREATE INDEX IF NOT EXISTS idx_blocked_users_workspace_bot ON blocked_users(workspace_id, bot_id, user_chat_id);
CREATE INDEX IF NOT EXISTS idx_quick_replies_workspace_bot ON quick_replies(workspace_id, bot_id, key);
CREATE INDEX IF NOT EXISTS idx_keyword_replies_workspace_bot ON keyword_replies(workspace_id, bot_id, keyword);
CREATE INDEX IF NOT EXISTS idx_admins_workspace_bot ON admins(workspace_id, bot_id, user_id);
CREATE INDEX IF NOT EXISTS idx_broadcasts_workspace_bot ON broadcasts(workspace_id, bot_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_workspace_bot ON audit_logs(workspace_id, bot_id, created_at);
