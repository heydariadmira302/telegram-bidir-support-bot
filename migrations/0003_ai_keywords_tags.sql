ALTER TABLE users ADD COLUMN tags TEXT;

CREATE TABLE IF NOT EXISTS keyword_replies (
  keyword TEXT PRIMARY KEY,
  reply TEXT NOT NULL,
  match_mode TEXT NOT NULL DEFAULT 'contains',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO keyword_replies (keyword, reply) VALUES
  ('价格', '你好，关于价格请直接说明你需要的服务/套餐，我看到后会给你具体报价。'),
  ('付款', '付款前请先确认订单内容，避免转错或备注错误。'),
  ('教程', '你可以先说明你需要哪一类教程，我会把对应步骤发给你。');

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('ai_enabled', 'false'),
  ('ai_base_url', 'https://api.openai.com/v1'),
  ('ai_model', 'gpt-4o-mini'),
  ('ai_system_prompt', '你是一个 Telegram 客服助手。请用简洁、礼貌、自然的中文帮助管理员起草回复。不要承诺无法确认的事情；遇到付款、账号、安全、删机等敏感操作时提醒人工确认。'),
  ('ai_auto_reply', 'false');
