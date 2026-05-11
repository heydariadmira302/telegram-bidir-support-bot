ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'open';
ALTER TABLE users ADD COLUMN muted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN important INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN closed_at TEXT;

CREATE TABLE IF NOT EXISTS quick_replies (
  key TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO quick_replies (key, text) VALUES
  ('hello', '你好，消息已收到，请直接说明你的问题。'),
  ('busy', '消息已收到，我现在不一定能马上回复，稍后看到会处理。'),
  ('done', '这边已经处理好了，你再确认一下。');

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('welcome_message', '你好，消息已收到。请直接说明你的问题，我看到后会尽快回复。'),
  ('closed_message', '这个会话已重新打开，请继续发送你的问题。'),
  ('rate_limit_count', '8'),
  ('rate_limit_window_seconds', '60');

CREATE TABLE IF NOT EXISTS message_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_chat_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  message_id INTEGER,
  text TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_message_logs_user ON message_logs(user_chat_id, created_at);
