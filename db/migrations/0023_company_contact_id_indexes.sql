-- Joins name these indexes so stale table statistics cannot make the database scan every company or contact for each lead.
CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_id ON companies(id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_id ON contacts(id);
