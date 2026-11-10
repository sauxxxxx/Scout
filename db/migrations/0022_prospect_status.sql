-- Leads count as prospects only once someone sets their status to Prospect.
ALTER TABLE leads ADD COLUMN prospect_at TEXT;
CREATE INDEX IF NOT EXISTS idx_leads_prospect ON leads(workspace_id,prospect_at) WHERE prospect_at IS NOT NULL;
CREATE TRIGGER IF NOT EXISTS leads_prospect_on_insert AFTER INSERT ON leads WHEN NEW.status='Prospect' AND NEW.prospect_at IS NULL
BEGIN UPDATE leads SET prospect_at=CURRENT_TIMESTAMP WHERE rowid=NEW.rowid; END;
CREATE TRIGGER IF NOT EXISTS leads_prospect_on_update AFTER UPDATE OF status ON leads WHEN NEW.status='Prospect' AND NEW.prospect_at IS NULL
BEGIN UPDATE leads SET prospect_at=CURRENT_TIMESTAMP WHERE rowid=NEW.rowid; END;
