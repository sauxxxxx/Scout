ALTER TABLE tasks ADD COLUMN completed_at TEXT;
ALTER TABLE opportunities ADD COLUMN proposal_at TEXT;
-- The app fills these from existing records on first run. See migrateReportDates in lib/foundation-store.ts.
