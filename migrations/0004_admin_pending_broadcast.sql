ALTER TABLE users ADD COLUMN ai_mode TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE users ADD COLUMN pending INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS admins (
  user_id TEXT PRIMARY KEY,
  name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS broadcasts (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  created_by TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TEXT
);

CREATE TABLE IF NOT EXISTS sensitive_words (
  word TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO sensitive_words (word) VALUES
  ('退款'), ('投诉'), ('骗子'), ('封号'), ('删除'), ('删机'), ('付款失败'), ('chargeback'), ('争议'), ('报警');

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('broadcast_confirm_ttl_seconds', '600');
