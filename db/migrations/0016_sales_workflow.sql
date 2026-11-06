ALTER TABLE leads ADD COLUMN last_touch_at TEXT;
ALTER TABLE leads ADD COLUMN changed_at TEXT;
ALTER TABLE opportunities ADD COLUMN closed_at TEXT;
ALTER TABLE finder_searches ADD COLUMN hidden_found_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE finder_searches ADD COLUMN include_found INTEGER NOT NULL DEFAULT 0;
ALTER TABLE finder_searches ADD COLUMN search_state_json TEXT;
ALTER TABLE finder_searches ADD COLUMN coverage TEXT;
CREATE TABLE IF NOT EXISTS finder_seen_places (workspace_id TEXT NOT NULL, provider TEXT NOT NULL, provider_record_id TEXT NOT NULL, first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (workspace_id, provider, provider_record_id));
-- The app fills these from existing records on first run. See migrateSalesWorkflow in lib/foundation-store.ts.
