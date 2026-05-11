CREATE TABLE IF NOT EXISTS settings_v2 (
  workspace_id TEXT NOT NULL DEFAULT 'default',
  bot_id TEXT,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, bot_id, key)
);

INSERT OR IGNORE INTO settings_v2 (workspace_id, bot_id, key, value, updated_at)
  SELECT 'default', NULL, key, value, updated_at FROM settings;

DROP TABLE settings;
ALTER TABLE settings_v2 RENAME TO settings;

CREATE TABLE users_v2 (
  workspace_id TEXT NOT NULL DEFAULT 'default',
  bot_id TEXT NOT NULL DEFAULT 'default',
  user_chat_id TEXT NOT NULL,
  topic_id INTEGER,
  first_name TEXT,
  last_name TEXT,
  username TEXT,
  language_code TEXT,
  is_blocked INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  muted INTEGER NOT NULL DEFAULT 0,
  important INTEGER NOT NULL DEFAULT 0,
  closed_at TEXT,
  tags TEXT,
  ai_mode TEXT NOT NULL DEFAULT 'manual',
  pending INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_message_at TEXT,
  PRIMARY KEY (workspace_id, bot_id, user_chat_id),
  UNIQUE (workspace_id, bot_id, topic_id)
);
INSERT OR IGNORE INTO users_v2 (
  workspace_id, bot_id, user_chat_id, topic_id, first_name, last_name, username, language_code,
  is_blocked, note, status, muted, important, closed_at, tags, ai_mode, pending, created_at, updated_at, last_message_at
)
SELECT
  COALESCE(NULLIF(workspace_id, ''), 'default'), COALESCE(NULLIF(bot_id, ''), 'default'), user_chat_id, topic_id, first_name, last_name, username, language_code,
  is_blocked, note, status, muted, important, closed_at, tags, ai_mode, pending, created_at, updated_at, last_message_at
FROM users;
DROP TABLE users;
ALTER TABLE users_v2 RENAME TO users;

CREATE TABLE message_links_v2 (
  workspace_id TEXT NOT NULL DEFAULT 'default',
  bot_id TEXT NOT NULL DEFAULT 'default',
  support_chat_id TEXT NOT NULL,
  support_message_id INTEGER NOT NULL,
  user_chat_id TEXT NOT NULL,
  user_message_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, bot_id, support_chat_id, support_message_id)
);
INSERT OR IGNORE INTO message_links_v2 (workspace_id, bot_id, support_chat_id, support_message_id, user_chat_id, user_message_id, created_at)
SELECT COALESCE(NULLIF(workspace_id, ''), 'default'), COALESCE(NULLIF(bot_id, ''), 'default'), support_chat_id, support_message_id, user_chat_id, user_message_id, created_at
FROM message_links;
DROP TABLE message_links;
ALTER TABLE message_links_v2 RENAME TO message_links;

CREATE TABLE blocked_users_v2 (
  workspace_id TEXT NOT NULL DEFAULT 'default',
  bot_id TEXT NOT NULL DEFAULT 'default',
  user_chat_id TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, bot_id, user_chat_id)
);
INSERT OR IGNORE INTO blocked_users_v2 (workspace_id, bot_id, user_chat_id, reason, created_at)
SELECT COALESCE(NULLIF(workspace_id, ''), 'default'), COALESCE(NULLIF(bot_id, ''), 'default'), user_chat_id, reason, created_at
FROM blocked_users;
DROP TABLE blocked_users;
ALTER TABLE blocked_users_v2 RENAME TO blocked_users;

CREATE TABLE quick_replies_v2 (
  workspace_id TEXT NOT NULL DEFAULT 'default',
  bot_id TEXT NOT NULL DEFAULT 'default',
  key TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, bot_id, key)
);
INSERT OR IGNORE INTO quick_replies_v2 (workspace_id, bot_id, key, text, created_at, updated_at)
SELECT COALESCE(NULLIF(workspace_id, ''), 'default'), COALESCE(NULLIF(bot_id, ''), 'default'), key, text, created_at, updated_at
FROM quick_replies;
DROP TABLE quick_replies;
ALTER TABLE quick_replies_v2 RENAME TO quick_replies;

CREATE TABLE keyword_replies_v2 (
  workspace_id TEXT NOT NULL DEFAULT 'default',
  bot_id TEXT NOT NULL DEFAULT 'default',
  keyword TEXT NOT NULL,
  reply TEXT NOT NULL,
  match_mode TEXT NOT NULL DEFAULT 'contains',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, bot_id, keyword)
);
INSERT OR IGNORE INTO keyword_replies_v2 (workspace_id, bot_id, keyword, reply, match_mode, enabled, created_at, updated_at)
SELECT COALESCE(NULLIF(workspace_id, ''), 'default'), COALESCE(NULLIF(bot_id, ''), 'default'), keyword, reply, match_mode, enabled, created_at, updated_at
FROM keyword_replies;
DROP TABLE keyword_replies;
ALTER TABLE keyword_replies_v2 RENAME TO keyword_replies;

CREATE TABLE admins_v2 (
  workspace_id TEXT NOT NULL DEFAULT 'default',
  bot_id TEXT,
  user_id TEXT NOT NULL,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, user_id)
);
INSERT OR IGNORE INTO admins_v2 (workspace_id, bot_id, user_id, name, role, created_at)
SELECT COALESCE(NULLIF(workspace_id, ''), 'default'), NULLIF(bot_id, ''), user_id, name, role, created_at
FROM admins;
DROP TABLE admins;
ALTER TABLE admins_v2 RENAME TO admins;

CREATE TABLE broadcasts_v2 (
  workspace_id TEXT NOT NULL DEFAULT 'default',
  bot_id TEXT NOT NULL DEFAULT 'default',
  id TEXT NOT NULL,
  text TEXT NOT NULL,
  created_by TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TEXT,
  target_filter TEXT,
  target_count INTEGER,
  ok_count INTEGER,
  failed_count INTEGER,
  PRIMARY KEY (workspace_id, bot_id, id)
);
INSERT OR IGNORE INTO broadcasts_v2 (workspace_id, bot_id, id, text, created_by, status, created_at, sent_at, target_filter, target_count, ok_count, failed_count)
SELECT COALESCE(NULLIF(workspace_id, ''), 'default'), COALESCE(NULLIF(bot_id, ''), 'default'), id, text, created_by, status, created_at, sent_at, target_filter, target_count, ok_count, failed_count
FROM broadcasts;
DROP TABLE broadcasts;
ALTER TABLE broadcasts_v2 RENAME TO broadcasts;

CREATE TABLE broadcast_results_v2 (
  workspace_id TEXT NOT NULL DEFAULT 'default',
  bot_id TEXT NOT NULL DEFAULT 'default',
  broadcast_id TEXT NOT NULL,
  user_chat_id TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, bot_id, broadcast_id, user_chat_id)
);
INSERT OR IGNORE INTO broadcast_results_v2 (workspace_id, bot_id, broadcast_id, user_chat_id, status, error, sent_at)
SELECT COALESCE(NULLIF(workspace_id, ''), 'default'), COALESCE(NULLIF(bot_id, ''), 'default'), broadcast_id, user_chat_id, status, error, sent_at
FROM broadcast_results;
DROP TABLE broadcast_results;
ALTER TABLE broadcast_results_v2 RENAME TO broadcast_results;

CREATE TABLE sensitive_words_v2 (
  workspace_id TEXT NOT NULL DEFAULT 'default',
  bot_id TEXT NOT NULL DEFAULT 'default',
  word TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, bot_id, word)
);
INSERT OR IGNORE INTO sensitive_words_v2 (workspace_id, bot_id, word, created_at)
SELECT COALESCE(NULLIF(workspace_id, ''), 'default'), COALESCE(NULLIF(bot_id, ''), 'default'), word, created_at
FROM sensitive_words;
DROP TABLE sensitive_words;
ALTER TABLE sensitive_words_v2 RENAME TO sensitive_words;

CREATE INDEX IF NOT EXISTS idx_settings_workspace_bot ON settings(workspace_id, bot_id, key);
CREATE INDEX IF NOT EXISTS idx_users_workspace_bot ON users(workspace_id, bot_id, last_message_at);
CREATE INDEX IF NOT EXISTS idx_message_links_workspace_bot ON message_links(workspace_id, bot_id, support_chat_id, support_message_id);
CREATE INDEX IF NOT EXISTS idx_message_links_user ON message_links(workspace_id, bot_id, user_chat_id);
CREATE INDEX IF NOT EXISTS idx_blocked_users_workspace_bot ON blocked_users(workspace_id, bot_id, user_chat_id);
CREATE INDEX IF NOT EXISTS idx_quick_replies_workspace_bot ON quick_replies(workspace_id, bot_id, key);
CREATE INDEX IF NOT EXISTS idx_keyword_replies_workspace_bot ON keyword_replies(workspace_id, bot_id, keyword);
CREATE INDEX IF NOT EXISTS idx_admins_workspace_bot ON admins(workspace_id, bot_id, user_id);
CREATE INDEX IF NOT EXISTS idx_broadcasts_workspace_bot ON broadcasts(workspace_id, bot_id, created_at);
CREATE INDEX IF NOT EXISTS idx_broadcast_results_broadcast ON broadcast_results(workspace_id, bot_id, broadcast_id, status);
CREATE INDEX IF NOT EXISTS idx_sensitive_words_workspace_bot ON sensitive_words(workspace_id, bot_id, word);
