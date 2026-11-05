CREATE TABLE IF NOT EXISTS workspace_settings (
  workspace_id TEXT PRIMARY KEY,
  default_role TEXT NOT NULL DEFAULT 'member' CHECK (default_role IN ('admin','member','viewer')),
  sender_name TEXT NOT NULL DEFAULT '',
  email_message TEXT NOT NULL DEFAULT '',
  allowed_domains_json TEXT NOT NULL DEFAULT '[]',
  admins_can_invite INTEGER NOT NULL DEFAULT 1,
  role_permissions_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS workspace_custom_roles (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL COLLATE NOCASE,
  base_role TEXT NOT NULL CHECK (base_role IN ('member','viewer')),
  permissions_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_roles_name ON workspace_custom_roles(workspace_id, name);

ALTER TABLE workspace_memberships ADD COLUMN custom_role_id TEXT;
ALTER TABLE workspace_invitations ADD COLUMN custom_role_id TEXT;
ALTER TABLE workspace_invitations ADD COLUMN note TEXT NOT NULL DEFAULT '';
ALTER TABLE workspace_invitations ADD COLUMN landing_page TEXT NOT NULL DEFAULT '';
ALTER TABLE workspace_invitations ADD COLUMN handoff_owner TEXT NOT NULL DEFAULT '';
ALTER TABLE workspace_invitations ADD COLUMN expires_days INTEGER NOT NULL DEFAULT 7;
ALTER TABLE workspace_invitations ADD COLUMN delivery TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE workspace_invitations ADD COLUMN last_sent_at TEXT;
