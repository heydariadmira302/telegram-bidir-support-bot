CREATE TABLE IF NOT EXISTS ai_models (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  model TEXT NOT NULL,
  api_key_env TEXT NOT NULL DEFAULT 'AI_API_KEY',
  system_prompt TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_models_one_default ON ai_models(is_default) WHERE is_default = 1;

INSERT OR IGNORE INTO ai_models (id, name, base_url, model, api_key_env, system_prompt, enabled, is_default)
VALUES (
  'default',
  'Default model',
  'https://api.openai.com/v1',
  'gpt-4o-mini',
  'AI_API_KEY',
  '你是一个 Telegram 客服助手。请用简洁、礼貌、自然的中文帮助管理员起草回复。不要承诺无法确认的事情；遇到付款、账号、安全、删机等敏感操作时提醒人工确认。',
  1,
  1
);
