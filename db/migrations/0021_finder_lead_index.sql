-- Finder looks up which result each lead came from on every progress check.
CREATE INDEX IF NOT EXISTS idx_finder_results_imported_lead
ON finder_results(workspace_id, imported_lead_id) WHERE imported_lead_id IS NOT NULL;
