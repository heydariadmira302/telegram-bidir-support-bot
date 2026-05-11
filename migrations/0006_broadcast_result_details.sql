CREATE TABLE IF NOT EXISTS broadcast_results (
  broadcast_id TEXT NOT NULL,
  user_chat_id TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (broadcast_id, user_chat_id)
);

CREATE INDEX IF NOT EXISTS idx_broadcast_results_broadcast ON broadcast_results(broadcast_id, status);
