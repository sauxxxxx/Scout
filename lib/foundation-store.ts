import { createActivitiesLeadIndex, createActivitiesStatusIndex, createActivitiesTable, createCompaniesTable, createContactsTable, createFinderResultsIndex, createFinderResultsTable, createFinderSearchesIndex, createFinderSearchesTable, createLeadsTable, createOpportunitiesTable, createTasksLeadStatusIndex, createTasksTable } from '@/db/schema';
import { taskDueIso } from '@/lib/task-dates';

export const DEFAULT_WORKSPACE_ID = 'scout-default';

const createUsersTable = `CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  avatar_url TEXT,
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

export async function ensureFoundationSchema(db: D1Database) {
  await db.batch([
    db.prepare(createUsersTable),
    db.prepare(createWorkspacesTable),
    db.prepare(createMembershipsTable),
    db.prepare(createActivitiesTable),
    db.prepare(createLeadsTable),
    db.prepare(createTasksTable),
    db.prepare(createCompaniesTable),
    db.prepare(createContactsTable),
    db.prepare(createOpportunitiesTable),
    db.prepare(createFinderSearchesTable),
    db.prepare(createFinderResultsTable),
    db.prepare(createActivitiesStatusIndex),
    db.prepare(createActivitiesLeadIndex),
    db.prepare(createTasksLeadStatusIndex),
    db.prepare(createFinderSearchesIndex),
    db.prepare(createFinderResultsIndex),
  ]);

  await addColumns(db, 'leads', {
    id: 'TEXT', workspace_id: 'TEXT', company_id: 'TEXT', primary_contact_id: 'TEXT', version: 'INTEGER NOT NULL DEFAULT 1', created_at: 'TEXT',
  });
  await addColumns(db, 'tasks', {
    uid: 'TEXT', workspace_id: 'TEXT', lead_id: 'TEXT', company_id: 'TEXT', contact_id: 'TEXT', opportunity_id: 'TEXT', due_at: 'TEXT', version: 'INTEGER NOT NULL DEFAULT 1', created_at: 'TEXT',
  });
  await addColumns(db, 'activities', {
    uid: 'TEXT', workspace_id: 'TEXT', lead_id: 'TEXT', company_id: 'TEXT', contact_id: 'TEXT', opportunity_id: 'TEXT', related_task_uid: 'TEXT', version: 'INTEGER NOT NULL DEFAULT 1',
  });

  await db.prepare('INSERT OR IGNORE INTO workspaces (id, name) VALUES (?, ?)').bind(DEFAULT_WORKSPACE_ID, 'Sales workspace').run();
  await backfillIds(db, 'leads', 'id');
  await backfillIds(db, 'tasks', 'uid');
  await backfillIds(db, 'activities', 'uid');
  await db.batch([
    db.prepare(`UPDATE tasks SET lead_id=(SELECT leads.id FROM leads WHERE leads.workspace_id=tasks.workspace_id AND leads.name=tasks.lead LIMIT 1) WHERE lead_id IS NULL`),
    db.prepare(`UPDATE activities SET lead_id=(SELECT leads.id FROM leads WHERE leads.workspace_id=activities.workspace_id AND leads.name=activities.lead LIMIT 1) WHERE lead_id IS NULL`),
    db.prepare(`UPDATE activities SET related_task_uid=(SELECT tasks.uid FROM tasks WHERE tasks.workspace_id=activities.workspace_id AND tasks.id=activities.related_task_id LIMIT 1) WHERE related_task_uid IS NULL AND related_task_id IS NOT NULL`),
  ]);
  await db.batch([
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_stable_id ON leads(id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_leads_workspace ON leads(workspace_id, updated_at)'),
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_stable_id ON tasks(uid)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_tasks_workspace ON tasks(workspace_id, updated_at)'),
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_activities_stable_id ON activities(uid)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_activities_workspace ON activities(workspace_id, updated_at)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_memberships_workspace ON workspace_memberships(workspace_id, role)'),
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
