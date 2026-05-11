CREATE TABLE IF NOT EXISTS workspace_admins (
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, user_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO workspace_admins (workspace_id, user_id, name, role, created_at)
SELECT workspace_id, user_id, name, COALESCE(role, 'admin'), created_at
FROM admins
WHERE user_id IS NOT NULL AND user_id != '';

CREATE INDEX IF NOT EXISTS idx_workspace_admins_user ON workspace_admins(user_id, workspace_id);
