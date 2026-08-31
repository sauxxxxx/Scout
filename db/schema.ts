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
