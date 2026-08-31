CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL,
  industry TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  website TEXT,
  owner TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(workspace_id, name)
);

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL,
  title TEXT,
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  is_primary INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS opportunities (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  lead_id TEXT,
  primary_contact_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL,
  stage TEXT NOT NULL,
  value REAL NOT NULL DEFAULT 0,
  probability INTEGER NOT NULL DEFAULT 0,
  close_date TEXT,
  owner TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'Medium',
  outcome TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  FOREIGN KEY (primary_contact_id) REFERENCES contacts(id) ON DELETE SET NULL
);

ALTER TABLE leads ADD COLUMN company_id TEXT;
ALTER TABLE leads ADD COLUMN primary_contact_id TEXT;
ALTER TABLE tasks ADD COLUMN company_id TEXT;
ALTER TABLE tasks ADD COLUMN contact_id TEXT;
ALTER TABLE tasks ADD COLUMN opportunity_id TEXT;
ALTER TABLE activities ADD COLUMN company_id TEXT;
ALTER TABLE activities ADD COLUMN contact_id TEXT;
ALTER TABLE activities ADD COLUMN opportunity_id TEXT;

CREATE INDEX IF NOT EXISTS idx_companies_workspace_name ON companies(workspace_id, name);
CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts(workspace_id, company_id, archived);
CREATE INDEX IF NOT EXISTS idx_opportunities_stage ON opportunities(workspace_id, stage, archived);
CREATE INDEX IF NOT EXISTS idx_opportunities_company ON opportunities(workspace_id, company_id);
