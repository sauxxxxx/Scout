CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  avatar_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS workspace_memberships (
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','member','viewer')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, user_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

ALTER TABLE leads ADD COLUMN id TEXT;
ALTER TABLE leads ADD COLUMN workspace_id TEXT;
ALTER TABLE leads ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE leads ADD COLUMN created_at TEXT;

ALTER TABLE tasks ADD COLUMN uid TEXT;
ALTER TABLE tasks ADD COLUMN workspace_id TEXT;
ALTER TABLE tasks ADD COLUMN lead_id TEXT;
ALTER TABLE tasks ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE tasks ADD COLUMN created_at TEXT;

ALTER TABLE activities ADD COLUMN uid TEXT;
ALTER TABLE activities ADD COLUMN workspace_id TEXT;
ALTER TABLE activities ADD COLUMN lead_id TEXT;
ALTER TABLE activities ADD COLUMN related_task_uid TEXT;
ALTER TABLE activities ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

INSERT OR IGNORE INTO workspaces (id, name) VALUES ('scout-default', 'Sales workspace');

CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_stable_id ON leads(id);
CREATE INDEX IF NOT EXISTS idx_leads_workspace ON leads(workspace_id, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_stable_id ON tasks(uid);
CREATE INDEX IF NOT EXISTS idx_tasks_workspace ON tasks(workspace_id, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_activities_stable_id ON activities(uid);
CREATE INDEX IF NOT EXISTS idx_activities_workspace ON activities(workspace_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_memberships_workspace ON workspace_memberships(workspace_id, role);
