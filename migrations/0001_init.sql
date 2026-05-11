CREATE TABLE IF NOT EXISTS users (
  user_chat_id TEXT PRIMARY KEY,
  topic_id INTEGER,
  first_name TEXT,
  last_name TEXT,
  username TEXT,
  language_code TEXT,
  is_blocked INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_message_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_topic_id ON users(topic_id);

CREATE TABLE IF NOT EXISTS message_links (
  support_chat_id TEXT NOT NULL,
  support_message_id INTEGER NOT NULL,
  user_chat_id TEXT NOT NULL,
  user_message_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (support_chat_id, support_message_id)
);

CREATE INDEX IF NOT EXISTS idx_message_links_user ON message_links(user_chat_id);

CREATE TABLE IF NOT EXISTS blocked_users (
  user_chat_id TEXT PRIMARY KEY,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
