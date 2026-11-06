ALTER TABLE workspace_settings ADD COLUMN customization_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN view_json TEXT NOT NULL DEFAULT '{}';
