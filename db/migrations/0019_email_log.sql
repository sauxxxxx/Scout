CREATE TABLE IF NOT EXISTS email_log_tokens (
  token TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(workspace_id,user_id)
);
ALTER TABLE activities ADD COLUMN external_ref TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_activities_external_ref ON activities(workspace_id,external_ref) WHERE external_ref IS NOT NULL;
