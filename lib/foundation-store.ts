import { createActivitiesLeadIndex, createActivitiesStatusIndex, createActivitiesTable, createCompaniesTable, createContactsTable, createFinderAiCacheTable, createFinderAiUsageIndex, createFinderAiUsageTable, createFinderResultsIndex, createFinderResultsTable, createFinderSearchesIndex, createFinderSearchesTable, createLeadsTable, createOpportunitiesTable, createOpportunityFinderAssessmentsIndex, createOpportunityFinderAssessmentsTable, createTasksLeadStatusIndex, createTasksTable } from '@/db/schema';
import { taskDueIso } from '@/lib/task-dates';

export const DEFAULT_WORKSPACE_ID = 'scout-default';

/** Bump when anything in migrateFoundationSchema changes. Requests then skip the whole setup unless this moved. */
export const SCHEMA_VERSION = 16;

const createUsersTable = `CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  avatar_url TEXT,
  job_title TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  timezone TEXT NOT NULL DEFAULT 'Asia/Manila',
  language TEXT NOT NULL DEFAULT 'English (Philippines)',
  date_format TEXT NOT NULL DEFAULT 'MMM d, yyyy',
  time_format TEXT NOT NULL DEFAULT '12-hour',
  preferences_json TEXT NOT NULL DEFAULT '{}',
  notifications_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active',
  last_seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

const createWorkspacesTable = `CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

const createMembershipsTable = `CREATE TABLE IF NOT EXISTS workspace_memberships (
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','member','viewer')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, user_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
)`;

const createInvitationsTable = `CREATE TABLE IF NOT EXISTS workspace_invitations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','member','viewer')),
  invited_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked','expired')),
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

const createWorkspaceSettingsTable = `CREATE TABLE IF NOT EXISTS workspace_settings (
  workspace_id TEXT PRIMARY KEY,
  default_role TEXT NOT NULL DEFAULT 'member' CHECK (default_role IN ('admin','member','viewer')),
  sender_name TEXT NOT NULL DEFAULT '',
  email_message TEXT NOT NULL DEFAULT '',
  allowed_domains_json TEXT NOT NULL DEFAULT '[]',
  admins_can_invite INTEGER NOT NULL DEFAULT 1,
  role_permissions_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

const createCustomRolesTable = `CREATE TABLE IF NOT EXISTS workspace_custom_roles (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL COLLATE NOCASE,
  base_role TEXT NOT NULL CHECK (base_role IN ('member','viewer')),
  permissions_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

const createSchemaMetaTable = `CREATE TABLE IF NOT EXISTS schema_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

const createRateLimitsTable = `CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT NOT NULL,
  bucket INTEGER NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, bucket)
)`;

const createAuditLogTable = `CREATE TABLE IF NOT EXISTS workspace_audit_log (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

const createNotificationsTable = `CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  link TEXT NOT NULL DEFAULT '',
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

const createAuthSessionsTable = `CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

async function columns(db: D1Database, table: string) {
  const result = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  return new Set(result.results.map(column => column.name));
}

async function addColumns(db: D1Database, table: string, definitions: Record<string, string>) {
  const existing = await columns(db, table);
  for (const [name, definition] of Object.entries(definitions)) {
    if (!existing.has(name)) await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`).run();
  }
}

async function backfillIds(db: D1Database, table: 'leads' | 'tasks' | 'activities', idColumn: 'id' | 'uid') {
  const rows = await db.prepare(`SELECT rowid AS record_rowid FROM ${table} WHERE ${idColumn} IS NULL OR ${idColumn} = ''`).all<{ record_rowid: number }>();
  if (rows.results.length) {
    await db.batch(rows.results.map(row => db.prepare(`UPDATE ${table} SET ${idColumn} = ?, workspace_id = COALESCE(workspace_id, ?) WHERE rowid = ?`).bind(crypto.randomUUID(), DEFAULT_WORKSPACE_ID, row.record_rowid)));
  }
  await db.prepare(`UPDATE ${table} SET workspace_id = ? WHERE workspace_id IS NULL OR workspace_id = ''`).bind(DEFAULT_WORKSPACE_ID).run();
}

const ensured = new WeakMap<D1Database, Promise<void>>();

async function ensureOnce(db: D1Database) {
  await db.prepare(createSchemaMetaTable).run();
  const meta = await db.prepare('SELECT version FROM schema_meta WHERE id=1').first<{ version: number }>();
  if (Number(meta?.version || 0) >= SCHEMA_VERSION) return;
  await migrateFoundationSchema(db);
  await db.prepare('INSERT INTO schema_meta (id,version) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,updated_at=CURRENT_TIMESTAMP').bind(SCHEMA_VERSION).run();
}

/** Runs the full setup once per version. Every API call used to run about 65 statements here, including writes. */
export function ensureFoundationSchema(db: D1Database) {
  let pending = ensured.get(db);
  if (!pending) {
    pending = ensureOnce(db).catch(error => { ensured.delete(db); throw error; });
    ensured.set(db, pending);
  }
  return pending;
}

/** Older databases used the business name as the key, which stopped two workspaces or branches sharing a name. */
async function rebuildLeadsKey(db: D1Database) {
  const info = await db.prepare('PRAGMA table_info(leads)').all<{ name: string; type: string; notnull: number; dflt_value: string | null; pk: number }>();
  if (info.results.find(column => column.pk)?.name === 'id') return;
  const definitions = info.results.map(column => (column.name === 'id'
    ? 'id TEXT PRIMARY KEY'
    : `${column.name} ${column.type}${column.notnull || column.pk ? ' NOT NULL' : ''}${column.dflt_value === null ? '' : ` DEFAULT ${column.dflt_value}`}`));
  const names = info.results.map(column => column.name).join(',');
  await db.batch([
    db.prepare('DROP TABLE IF EXISTS leads_rebuilt'),
    db.prepare(`CREATE TABLE leads_rebuilt (${definitions.join(',')})`),
    db.prepare(`INSERT INTO leads_rebuilt (${names}) SELECT ${names} FROM leads`),
    db.prepare('DROP TABLE leads'),
    db.prepare('ALTER TABLE leads_rebuilt RENAME TO leads'),
  ]);
}

async function migrateFoundationSchema(db: D1Database) {
  await db.batch([
    db.prepare(createRateLimitsTable),
    db.prepare(createAuditLogTable),
    db.prepare(createNotificationsTable),
    db.prepare(createUsersTable),
    db.prepare(createWorkspacesTable),
    db.prepare(createMembershipsTable),
    db.prepare(createInvitationsTable),
    db.prepare(createWorkspaceSettingsTable),
    db.prepare(createCustomRolesTable),
    db.prepare(createAuthSessionsTable),
    db.prepare(createActivitiesTable),
    db.prepare(createLeadsTable),
    db.prepare(createTasksTable),
    db.prepare(createCompaniesTable),
    db.prepare(createContactsTable),
    db.prepare(createOpportunitiesTable),
    db.prepare(createFinderSearchesTable),
    db.prepare(createFinderResultsTable),
    db.prepare(createFinderAiCacheTable),
    db.prepare(createFinderAiUsageTable),
    db.prepare(createOpportunityFinderAssessmentsTable),
    db.prepare(createActivitiesStatusIndex),
    db.prepare(createActivitiesLeadIndex),
    db.prepare(createTasksLeadStatusIndex),
    db.prepare(createFinderSearchesIndex),
    db.prepare(createFinderResultsIndex),
    db.prepare(createFinderAiUsageIndex),
    db.prepare(createOpportunityFinderAssessmentsIndex),
  ]);

  await addColumns(db, 'users', {
    status: "TEXT NOT NULL DEFAULT 'active'", last_seen_at: 'TEXT', job_title: "TEXT NOT NULL DEFAULT ''", phone: "TEXT NOT NULL DEFAULT ''",
    timezone: "TEXT NOT NULL DEFAULT 'Asia/Manila'", language: "TEXT NOT NULL DEFAULT 'English (Philippines)'", date_format: "TEXT NOT NULL DEFAULT 'MMM d, yyyy'",
    time_format: "TEXT NOT NULL DEFAULT '12-hour'", preferences_json: "TEXT NOT NULL DEFAULT '{}'", notifications_json: "TEXT NOT NULL DEFAULT '{}'",
  });

  await addColumns(db, 'workspace_memberships', { custom_role_id: 'TEXT', suspended: 'INTEGER NOT NULL DEFAULT 0' });
  await addColumns(db, 'workspace_invitations', {
    custom_role_id: 'TEXT', note: "TEXT NOT NULL DEFAULT ''", landing_page: "TEXT NOT NULL DEFAULT ''", handoff_owner: "TEXT NOT NULL DEFAULT ''",
    expires_days: 'INTEGER NOT NULL DEFAULT 7', delivery: "TEXT NOT NULL DEFAULT 'manual'", last_sent_at: 'TEXT',
  });

  await addColumns(db, 'leads', {
    id: 'TEXT', workspace_id: 'TEXT', company_id: 'TEXT', primary_contact_id: 'TEXT', version: 'INTEGER NOT NULL DEFAULT 1', created_at: 'TEXT',
    finder_provider: 'TEXT', finder_record_id: 'TEXT', business_address: "TEXT NOT NULL DEFAULT ''",
  });
  await addColumns(db, 'tasks', {
    uid: 'TEXT', workspace_id: 'TEXT', lead_id: 'TEXT', company_id: 'TEXT', contact_id: 'TEXT', opportunity_id: 'TEXT', due_at: 'TEXT', version: 'INTEGER NOT NULL DEFAULT 1', created_at: 'TEXT',
  });
  await addColumns(db, 'activities', {
    uid: 'TEXT', workspace_id: 'TEXT', lead_id: 'TEXT', company_id: 'TEXT', contact_id: 'TEXT', opportunity_id: 'TEXT', related_task_uid: 'TEXT', version: 'INTEGER NOT NULL DEFAULT 1',
  });
  await addColumns(db, 'companies', {
    facebook_url: 'TEXT', facebook_status: "TEXT NOT NULL DEFAULT 'not_found'", facebook_reviewed_at: 'TEXT', facebook_research_json: "TEXT NOT NULL DEFAULT '{}'",
    finder_provider: 'TEXT', finder_record_id: 'TEXT', business_address: "TEXT NOT NULL DEFAULT ''",
  });
  await addColumns(db, 'finder_searches', {
    map_bounds_json: 'TEXT', map_area_json: 'TEXT', location_code: 'TEXT', location_type: 'TEXT', location_province: 'TEXT', location_region: 'TEXT', industry_type: 'TEXT', industry_psic_code: 'TEXT',
    sales_focus: "TEXT NOT NULL DEFAULT 'Website & booking'", requirement_mode: "TEXT NOT NULL DEFAULT 'all'",
  });
  await addColumns(db, 'finder_results', {
    latitude: 'REAL', longitude: 'REAL', distance_km: 'REAL', facebook_status: "TEXT NOT NULL DEFAULT 'not_found'", facebook_verified_at: 'TEXT',
    facebook_research_json: "TEXT NOT NULL DEFAULT '{}'", review_version: 'INTEGER NOT NULL DEFAULT 0',
  });

  await db.prepare('INSERT OR IGNORE INTO workspaces (id, name) VALUES (?, ?)').bind(DEFAULT_WORKSPACE_ID, 'Sales workspace').run();
  await backfillIds(db, 'leads', 'id');
  await rebuildLeadsKey(db);
  await backfillIds(db, 'tasks', 'uid');
  await backfillIds(db, 'activities', 'uid');
  await db.batch([
    db.prepare(`UPDATE tasks SET lead_id=(SELECT leads.id FROM leads WHERE leads.workspace_id=tasks.workspace_id AND leads.name=tasks.lead LIMIT 1) WHERE lead_id IS NULL`),
    db.prepare(`UPDATE activities SET lead_id=(SELECT leads.id FROM leads WHERE leads.workspace_id=activities.workspace_id AND leads.name=activities.lead LIMIT 1) WHERE lead_id IS NULL`),
    db.prepare(`UPDATE activities SET related_task_uid=(SELECT tasks.uid FROM tasks WHERE tasks.workspace_id=activities.workspace_id AND tasks.id=activities.related_task_id LIMIT 1) WHERE related_task_uid IS NULL AND related_task_id IS NOT NULL`),
  ]);
  await db.batch([
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_stable_id ON leads(id)'),
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_workspace_name ON leads(workspace_id,name)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_leads_workspace_updated ON leads(workspace_id,archived,updated_at)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_leads_company ON leads(company_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_tasks_lead ON tasks(lead_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_tasks_updated ON tasks(workspace_id,updated_at)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_activities_lead ON activities(lead_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_activities_company ON activities(company_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_opportunities_lead ON opportunities(lead_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_contacts_updated ON contacts(workspace_id,updated_at)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_companies_updated ON companies(workspace_id,updated_at)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_opportunities_updated ON opportunities(workspace_id,updated_at)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_audit_workspace ON workspace_audit_log(workspace_id,created_at)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(workspace_id,user_id,created_at)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_leads_workspace ON leads(workspace_id, updated_at)'),
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_finder_identity ON leads(workspace_id,finder_provider,finder_record_id) WHERE finder_provider IS NOT NULL AND finder_record_id IS NOT NULL'),
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_stable_id ON tasks(uid)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_tasks_workspace ON tasks(workspace_id, updated_at)'),
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_activities_stable_id ON activities(uid)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_activities_workspace ON activities(workspace_id, updated_at)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_memberships_workspace ON workspace_memberships(workspace_id, role)'),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_invites_pending_email ON workspace_invitations(workspace_id,email) WHERE status='pending'"),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_workspace_invites_workspace_status ON workspace_invitations(workspace_id,status,created_at)'),
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_roles_name ON workspace_custom_roles(workspace_id, name)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id,expires_at)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry ON auth_sessions(expires_at)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_companies_workspace_name ON companies(workspace_id, name)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts(workspace_id, company_id, archived)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_opportunities_stage ON opportunities(workspace_id, stage, archived)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_opportunities_company ON opportunities(workspace_id, company_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_tasks_workspace_due_at ON tasks(workspace_id, due_at, status)'),
  ]);
  await backfillCoreCrm(db);
  await db.prepare("UPDATE tasks SET due_at=CASE WHEN due='Today' THEN date('now') WHEN due='Tomorrow' THEN date('now','+1 day') WHEN due='Overdue' THEN date('now','-1 day') ELSE due_at END WHERE due_at IS NULL").run();
  const undatedTasks=await db.prepare('SELECT uid,due FROM tasks WHERE due_at IS NULL').all<{uid:string;due:string}>();for(const task of undatedTasks.results)await db.prepare('UPDATE tasks SET due_at=? WHERE uid=?').bind(taskDueIso(task.due),task.uid).run();
  await db.prepare('PRAGMA optimize').run();
}

export async function backfillCoreCrm(db:D1Database){
  const leads=await db.prepare("SELECT * FROM leads WHERE company_id IS NULL OR primary_contact_id IS NULL OR (trim(COALESCE(opportunity,''))!='' AND NOT EXISTS (SELECT 1 FROM opportunities WHERE opportunities.workspace_id=leads.workspace_id AND opportunities.lead_id=leads.id))").all<Record<string,unknown>>();
  for(const lead of leads.results){
    const workspaceId=String(lead.workspace_id||DEFAULT_WORKSPACE_ID);const leadId=String(lead.id);let company=lead.company_id?await db.prepare('SELECT id FROM companies WHERE workspace_id=? AND id=?').bind(workspaceId,String(lead.company_id)).first<{id:string}>():null;if(!company)company=await db.prepare('SELECT id FROM companies WHERE workspace_id=? AND lower(name)=lower(?)').bind(workspaceId,String(lead.name)).first<{id:string}>();
    if(!company){company={id:crypto.randomUUID()};await db.prepare('INSERT INTO companies (id,workspace_id,name,industry,city,phone,email,owner,archived) VALUES (?,?,?,?,?,?,?,?,?)').bind(company.id,workspaceId,String(lead.name),String(lead.industry||''),String(lead.city||''),String(lead.phone||''),String(lead.email||''),String(lead.owner||''),Number(lead.archived||0)).run()}
    let contact=lead.primary_contact_id?await db.prepare('SELECT id FROM contacts WHERE workspace_id=? AND id=? AND company_id=?').bind(workspaceId,String(lead.primary_contact_id),company.id).first<{id:string}>():null;if(!contact)contact=await db.prepare('SELECT id FROM contacts WHERE workspace_id=? AND company_id=? AND is_primary=1').bind(workspaceId,company.id).first<{id:string}>();
    if(!contact){contact={id:crypto.randomUUID()};await db.prepare('INSERT INTO contacts (id,workspace_id,company_id,name,email,phone,is_primary) VALUES (?,?,?,?,?,?,1)').bind(contact.id,workspaceId,company.id,String(lead.contact||'Primary contact'),String(lead.email||''),String(lead.phone||'')).run()}
    await db.prepare('UPDATE leads SET company_id=?,primary_contact_id=? WHERE id=? AND workspace_id=?').bind(company.id,contact.id,leadId,workspaceId).run();
    const opportunityName=String(lead.opportunity||'').trim();if(opportunityName){const existing=await db.prepare('SELECT id FROM opportunities WHERE workspace_id=? AND lead_id=? LIMIT 1').bind(workspaceId,leadId).first<{id:string}>();if(!existing)await db.prepare('INSERT INTO opportunities (id,workspace_id,company_id,lead_id,primary_contact_id,name,stage,value,probability,close_date,owner,priority,archived) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),workspaceId,company.id,leadId,contact.id,opportunityName,String(lead.status||'New'),Number(lead.value||0),Number(lead.probability??lead.score??0),lead.close_date||null,String(lead.owner||''),String(lead.priority||'Medium'),Number(lead.archived||0)).run()}
  }
  await db.batch([
    db.prepare('UPDATE tasks SET company_id=(SELECT company_id FROM leads WHERE leads.id=tasks.lead_id),contact_id=(SELECT primary_contact_id FROM leads WHERE leads.id=tasks.lead_id),opportunity_id=(SELECT id FROM opportunities WHERE opportunities.lead_id=tasks.lead_id LIMIT 1) WHERE company_id IS NULL'),
    db.prepare('UPDATE activities SET company_id=(SELECT company_id FROM leads WHERE leads.id=activities.lead_id),contact_id=(SELECT primary_contact_id FROM leads WHERE leads.id=activities.lead_id),opportunity_id=(SELECT id FROM opportunities WHERE opportunities.lead_id=activities.lead_id LIMIT 1) WHERE company_id IS NULL'),
  ]);
}

export async function syncLeadCoreCrm(db:D1Database,workspaceId:string,leadId:string){
  void workspaceId;void leadId;await backfillCoreCrm(db);
}
