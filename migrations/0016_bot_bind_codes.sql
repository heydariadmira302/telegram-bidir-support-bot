ALTER TABLE bots ADD COLUMN bind_code TEXT;
ALTER TABLE bots ADD COLUMN bind_code_expires_at TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_bots_bind_code ON bots(bind_code) WHERE bind_code IS NOT NULL;
