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
);

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
);

CREATE INDEX IF NOT EXISTS idx_tasks_lead_status ON tasks(lead, status);
