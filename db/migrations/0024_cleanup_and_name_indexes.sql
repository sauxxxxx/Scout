-- The activity list purges old deleted entries on every load; imports match names ignoring capitals.
CREATE INDEX IF NOT EXISTS idx_activities_deleted ON activities(workspace_id,deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_lower_name ON leads(workspace_id,lower(name));
CREATE INDEX IF NOT EXISTS idx_companies_lower_name ON companies(workspace_id,lower(name));
-- Adding from Finder checks whether each business already has a company from the same listing.
CREATE INDEX IF NOT EXISTS idx_companies_finder_identity ON companies(workspace_id,finder_provider,finder_record_id) WHERE finder_provider IS NOT NULL;
-- Home and Reports count activities by the day they happened.
CREATE INDEX IF NOT EXISTS idx_activities_occurred ON activities(workspace_id,occurred_at);
