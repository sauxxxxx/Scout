import type { ScoutSession } from '@/lib/auth';

type Scoped = { session: ScoutSession; db: D1Database };
type LeadLike = { id?: string; owner: string };
type LinkedLike = { owner: string; leadId?: string };
type CompanyLike = { id: string; owner: string };
type ContactLike = { companyId: string };
type OpportunityLike = { owner: string; leadId?: string; companyId: string };

export const seesOnlyOwnRecords = (session: ScoutSession) => !session.capabilities['records:view_all'];

/**
 * A lead counts as visible when the person owns it or owns work attached to it. Tasks and activities
 * only sync while their lead is loaded, so hiding a linked lead would silently stop their changes saving.
 */
export async function visibleLeadIds(db: D1Database, workspaceId: string, owner: string) {
  const rows = await db.prepare(`SELECT id FROM leads WHERE workspace_id=?1 AND (owner=?2
    OR id IN (SELECT lead_id FROM tasks WHERE workspace_id=?1 AND owner=?2 AND lead_id IS NOT NULL)
    OR id IN (SELECT lead_id FROM opportunities WHERE workspace_id=?1 AND owner=?2 AND lead_id IS NOT NULL)
    OR id IN (SELECT lead_id FROM activities WHERE workspace_id=?1 AND owner=?2 AND lead_id IS NOT NULL))`).bind(workspaceId, owner).all<{ id: string }>();
  return new Set(rows.results.map(row => row.id));
}

export function scopeWorkspace<L extends LeadLike & { companyId?: string }, T extends LinkedLike, C extends CompanyLike, P extends ContactLike, O extends OpportunityLike>(
  data: { leads: L[]; tasks: T[]; companies: C[]; contacts: P[]; opportunities: O[] }, owner: string, leadIds: Set<string>,
) {
  const leads = data.leads.filter(lead => lead.id && leadIds.has(lead.id));
  const tasks = data.tasks.filter(task => task.owner === owner || (task.leadId && leadIds.has(task.leadId)));
  const opportunities = data.opportunities.filter(item => item.owner === owner || (item.leadId && leadIds.has(item.leadId)));
  const companyIds = new Set([...leads.map(lead => lead.companyId), ...opportunities.map(item => item.companyId)].filter(Boolean));
  const companies = data.companies.filter(company => company.owner === owner || companyIds.has(company.id));
  const visibleCompanies = new Set(companies.map(company => company.id));
  return { leads, tasks, opportunities, companies, contacts: data.contacts.filter(contact => visibleCompanies.has(contact.companyId)) };
}

export function scopeActivities<A extends LinkedLike>(activities: A[], owner: string, leadIds: Set<string>) {
  return activities.filter(activity => activity.owner === owner || (activity.leadId && leadIds.has(activity.leadId)));
}

const denied = () => Response.json({ error: 'You can only work with your own records.' }, { status: 403 });

async function companyVisible({ db, session }: Scoped, companyId: string) {
  const owner = session.user.name;
  const company = await db.prepare('SELECT owner FROM companies WHERE id=? AND workspace_id=?').bind(companyId, session.workspace.id).first<{ owner: string }>();
  if (!company || company.owner === owner) return true;
  const leadIds = await visibleLeadIds(db, session.workspace.id, owner);
  const linked = await db.prepare('SELECT id FROM leads WHERE company_id=? AND workspace_id=?').bind(companyId, session.workspace.id).all<{ id: string }>();
  return linked.results.some(row => leadIds.has(row.id));
}

async function linkedVisible({ db, session }: Scoped, table: 'tasks' | 'activities' | 'opportunities', idColumn: 'uid' | 'id', id: string) {
  const row = await db.prepare(`SELECT owner,lead_id FROM ${table} WHERE ${idColumn}=? AND workspace_id=?`).bind(id, session.workspace.id).first<{ owner: string; lead_id: string | null }>();
  if (!row || row.owner === session.user.name) return true;
  return row.lead_id ? (await visibleLeadIds(db, session.workspace.id, session.user.name)).has(row.lead_id) : false;
}

/** Returns a 403 response when someone limited to their own records reaches for another person's. */
export async function guardRecord(auth: Scoped, kind: 'lead' | 'task' | 'activity' | 'opportunity' | 'company' | 'contact', id: string | null | undefined) {
  if (!id || !seesOnlyOwnRecords(auth.session)) return null;
  const { db, session } = auth;
  let allowed = true;
  if (kind === 'lead') {
    const exists = await db.prepare('SELECT id FROM leads WHERE id=? AND workspace_id=?').bind(id, session.workspace.id).first();
    allowed = !exists || (await visibleLeadIds(db, session.workspace.id, session.user.name)).has(id);
  } else if (kind === 'task') allowed = await linkedVisible(auth, 'tasks', 'uid', id);
  else if (kind === 'activity') allowed = await linkedVisible(auth, 'activities', 'uid', id);
  else if (kind === 'opportunity') allowed = await linkedVisible(auth, 'opportunities', 'id', id);
  else if (kind === 'company') allowed = await companyVisible(auth, id);
  else {
    const contact = await db.prepare('SELECT company_id FROM contacts WHERE id=? AND workspace_id=?').bind(id, session.workspace.id).first<{ company_id: string }>();
    allowed = !contact || await companyVisible(auth, contact.company_id);
  }
  return allowed ? null : denied();
}

export async function guardFinderSearch(auth: Scoped, id: string | null | undefined) {
  if (!id || !seesOnlyOwnRecords(auth.session)) return null;
  const search = await auth.db.prepare('SELECT created_by FROM finder_searches WHERE id=? AND workspace_id=?').bind(id, auth.session.workspace.id).first<{ created_by: string | null }>();
  return !search || search.created_by === auth.session.user.id ? null : denied();
}
