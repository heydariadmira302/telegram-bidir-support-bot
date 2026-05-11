CREATE TABLE IF NOT EXISTS kb_import_batches (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  title TEXT,
  imported_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS kb_raw_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT NOT NULL,
  source TEXT NOT NULL,
  chat_title TEXT,
  message_id TEXT,
  sender_name TEXT,
  message_date TEXT,
  text TEXT NOT NULL,
  tags TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_kb_raw_messages_batch ON kb_raw_messages(batch_id);
CREATE INDEX IF NOT EXISTS idx_kb_raw_messages_text ON kb_raw_messages(text);

CREATE TABLE IF NOT EXISTS kb_entries (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT,
  source TEXT,
  confidence TEXT NOT NULL DEFAULT 'manual',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_kb_entries_enabled ON kb_entries(enabled);
