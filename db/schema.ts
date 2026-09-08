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
  website_summary TEXT NOT NULL DEFAULT '',
  rule_score INTEGER NOT NULL DEFAULT 0,
  rule_score_reason TEXT NOT NULL DEFAULT '',
  ai_status TEXT NOT NULL DEFAULT 'pending',
  ai_model TEXT,
  ai_classification TEXT,
  ai_icp_match TEXT,
  ai_score INTEGER,
  ai_confidence TEXT,
  ai_explanation TEXT,
  ai_opportunity_signals_json TEXT NOT NULL DEFAULT '[]',
  ai_concerns_json TEXT NOT NULL DEFAULT '[]',
  ai_recommended_action TEXT,
  ai_evidence_refs_json TEXT NOT NULL DEFAULT '[]',
  ai_input_hash TEXT,
  ai_prompt_tokens INTEGER NOT NULL DEFAULT 0,
  ai_output_tokens INTEGER NOT NULL DEFAULT 0,
  ai_estimated_cost_microusd INTEGER NOT NULL DEFAULT 0,
  ai_error TEXT,
  ai_analyzed_at TEXT,
  ai_attempts INTEGER NOT NULL DEFAULT 0,
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

export const createFinderAiCacheTable = `
CREATE TABLE IF NOT EXISTS finder_ai_cache (
  workspace_id TEXT NOT NULL, input_hash TEXT NOT NULL, model TEXT NOT NULL,
  assessment_json TEXT NOT NULL, prompt_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0, estimated_cost_microusd INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, input_hash, model)
)`;

export const createFinderAiUsageTable = `
CREATE TABLE IF NOT EXISTS finder_ai_usage (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, month TEXT NOT NULL, search_id TEXT NOT NULL,
  result_id TEXT NOT NULL, input_hash TEXT NOT NULL, model TEXT NOT NULL, request_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL, reserved_microusd INTEGER NOT NULL DEFAULT 0, actual_microusd INTEGER NOT NULL DEFAULT 0,
  prompt_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

export const createOpportunityFinderAssessmentsTable = `
CREATE TABLE IF NOT EXISTS opportunity_finder_assessments (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, opportunity_id TEXT NOT NULL,
  finder_result_id TEXT NOT NULL UNIQUE, assessment_json TEXT NOT NULL, provenance_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE,
  FOREIGN KEY (finder_result_id) REFERENCES finder_results(id) ON DELETE RESTRICT
)`;

export const createFinderAiUsageIndex = `CREATE INDEX IF NOT EXISTS idx_finder_ai_usage_workspace_month ON finder_ai_usage(workspace_id, month, status)`;
export const createOpportunityFinderAssessmentsIndex = `CREATE INDEX IF NOT EXISTS idx_opportunity_finder_assessments_opportunity ON opportunity_finder_assessments(workspace_id, opportunity_id)`;
