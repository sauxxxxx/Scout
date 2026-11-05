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
);

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
);

CREATE INDEX IF NOT EXISTS idx_finder_searches_workspace_created
ON finder_searches(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_finder_results_search_score
ON finder_results(workspace_id, search_id, score DESC);

PRAGMA optimize;
