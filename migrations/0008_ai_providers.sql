CREATE TABLE IF NOT EXISTS ai_providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key_encrypted TEXT,
  api_key_hint TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE ai_models ADD COLUMN provider_id TEXT;

INSERT OR IGNORE INTO ai_providers (id, name, base_url, api_key_encrypted, api_key_hint, enabled)
VALUES ('env-default', 'Environment AI provider', 'https://api.openai.com/v1', NULL, 'AI_API_KEY', 1);

UPDATE ai_models SET provider_id = COALESCE(provider_id, 'env-default');
