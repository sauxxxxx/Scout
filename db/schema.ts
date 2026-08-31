export const createActivitiesTable = `
CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY,
  lead TEXT NOT NULL,
  type TEXT NOT NULL,
  detail TEXT NOT NULL,
  time TEXT NOT NULL,
  owner TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Completed',
  occurred_at TEXT,
  outcome TEXT,
  duration TEXT,
  subject TEXT,
  value TEXT,
  document_link TEXT,
  attachment_key TEXT,
  attachment_name TEXT,
  related_task_id INTEGER,
  opportunity TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

export const createActivitiesStatusIndex = `
CREATE INDEX IF NOT EXISTS idx_activities_status_time
ON activities(status, occurred_at)
`;

export const createActivitiesLeadIndex = `
CREATE INDEX IF NOT EXISTS idx_activities_lead
ON activities(lead)
`;

export const createLeadsTable = `
CREATE TABLE IF NOT EXISTS leads (
  name TEXT PRIMARY KEY,
  industry TEXT NOT NULL,
  city TEXT NOT NULL,
  status TEXT NOT NULL,
  score INTEGER NOT NULL,
  owner TEXT NOT NULL,
  last TEXT NOT NULL,
  next TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  contact TEXT NOT NULL,
  priority TEXT NOT NULL,
  opportunity TEXT NOT NULL,
  value INTEGER,
  probability INTEGER,
  close_date TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

export const createTasksTable = `
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  lead TEXT NOT NULL,
  owner TEXT NOT NULL,
  priority TEXT NOT NULL,
  due TEXT NOT NULL,
  time TEXT NOT NULL,
  type TEXT NOT NULL,
  notes TEXT NOT NULL,
  status TEXT NOT NULL,
  reminder TEXT,
  recurrence TEXT,
  outcome TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

export const createTasksLeadStatusIndex = `
CREATE INDEX IF NOT EXISTS idx_tasks_lead_status
ON tasks(lead, status)
`;

export const createCompaniesTable = `
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
)`;

export const createContactsTable = `
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
)`;

export const createOpportunitiesTable = `
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
)`;
