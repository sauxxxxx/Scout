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
  due_at TEXT,
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

export const createFinderSearchesTable = `
CREATE TABLE IF NOT EXISTS finder_searches (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  name TEXT NOT NULL,
  industry TEXT NOT NULL,
  location TEXT NOT NULL,
  target_count INTEGER NOT NULL,
  requirements_json TEXT NOT NULL DEFAULT '[]',
  provider TEXT NOT NULL DEFAULT 'Google Places',
  status TEXT NOT NULL DEFAULT 'Saved',
  progress INTEGER NOT NULL DEFAULT 0,
  stage TEXT NOT NULL DEFAULT 'Ready',
  found_count INTEGER NOT NULL DEFAULT 0,
  imported_count INTEGER NOT NULL DEFAULT 0,
  saved INTEGER NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

export const createFinderResultsTable = `
CREATE TABLE IF NOT EXISTS finder_results (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  search_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_record_id TEXT NOT NULL,
  name TEXT NOT NULL,
  industry TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  social_url TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL,
  business_status TEXT,
  rating REAL,
  review_count INTEGER,
  score INTEGER NOT NULL,
  score_reason TEXT NOT NULL,
  opportunity TEXT NOT NULL,
  provenance_json TEXT NOT NULL DEFAULT '[]',
  fetched_at TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  imported_lead_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(search_id, provider, provider_record_id),
  FOREIGN KEY (search_id) REFERENCES finder_searches(id) ON DELETE CASCADE
)`;

export const createFinderSearchesIndex = `
CREATE INDEX IF NOT EXISTS idx_finder_searches_workspace_created
ON finder_searches(workspace_id, created_at DESC)
`;

export const createFinderResultsIndex = `
CREATE INDEX IF NOT EXISTS idx_finder_results_search_score
ON finder_results(workspace_id, search_id, score DESC)
`;
