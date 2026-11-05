import { authenticateRequest } from '@/lib/auth';
import { leadColumns, leadJoins } from '@/lib/lead-query';
import { mapLead, mapTask } from '@/lib/workspace-store';
import { mapCompany,mapContact,mapOpportunity } from '@/lib/crm-store';
import { scopeWorkspace, seesOnlyOwnRecords, visibleLeadIds } from '@/lib/record-scope';

export const dynamic = 'force-dynamic';

const RECENT_LEADS = 200;
const openWork = `(leads.id IN (SELECT lead_id FROM tasks WHERE workspace_id=?1 AND status!='Completed')
  OR leads.id IN (SELECT lead_id FROM opportunities WHERE workspace_id=?1 AND archived=0 AND stage NOT IN ('Won','Lost'))
  OR leads.id IN (SELECT id FROM leads WHERE workspace_id=?1 AND archived=0 ORDER BY updated_at DESC LIMIT ${RECENT_LEADS}))`;
const workingCompanies = `(company_id IN (SELECT company_id FROM leads WHERE ${openWork}) OR company_id IN (SELECT company_id FROM opportunities WHERE workspace_id=?1))`;

/**
 * Loads what people work with day to day: open work and recent records. Everything else is fetched as it's searched or
 * paged. With `since`, only records changed after that moment are returned, which keeps background refresh cheap.
 */
export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;
  const { db, session } = auth;
  const workspaceId = session.workspace.id;
  const since = new URL(request.url).searchParams.get('since');
  const opportunitySelect = 'SELECT o.*,CASE WHEN c.finder_provider IS NOT NULL THEN 1 ELSE 0 END from_finder FROM opportunities o LEFT JOIN companies c ON c.id=o.company_id WHERE o.workspace_id=?1';
  const statements = since ? [
    db.prepare(`SELECT ${leadColumns} ${leadJoins} WHERE leads.workspace_id=?1 AND leads.updated_at>=?2`).bind(workspaceId, since),
    db.prepare('SELECT * FROM tasks WHERE workspace_id=?1 AND updated_at>=?2').bind(workspaceId, since),
    db.prepare('SELECT * FROM companies WHERE workspace_id=?1 AND updated_at>=?2').bind(workspaceId, since),
    db.prepare('SELECT * FROM contacts WHERE workspace_id=?1 AND updated_at>=?2').bind(workspaceId, since),
    db.prepare(`${opportunitySelect} AND o.updated_at>=?2`).bind(workspaceId, since),
  ] : [
    db.prepare(`SELECT ${leadColumns} ${leadJoins} WHERE leads.workspace_id=?1 AND ${openWork} ORDER BY companies.name,leads.name`).bind(workspaceId),
    db.prepare("SELECT * FROM tasks WHERE workspace_id=?1 AND (status!='Completed' OR updated_at>=datetime('now','-90 days')) ORDER BY id DESC").bind(workspaceId),
    db.prepare(`SELECT * FROM companies WHERE workspace_id=?1 AND (id IN (SELECT company_id FROM leads WHERE ${openWork}) OR id IN (SELECT company_id FROM opportunities WHERE workspace_id=?1)) ORDER BY name`).bind(workspaceId),
    db.prepare(`SELECT * FROM contacts WHERE workspace_id=?1 AND ${workingCompanies} ORDER BY is_primary DESC,name`).bind(workspaceId),
    db.prepare(`${opportunitySelect} ORDER BY o.updated_at DESC`).bind(workspaceId),
  ];
  const [leadRows, taskRows, companyRows, contactRows, opportunityRows] = await db.batch(statements);
  const clock = await db.prepare("SELECT datetime('now','-5 seconds') now").first<{ now: string }>();
  const data = { leads: (leadRows.results as Record<string, unknown>[]).map(mapLead), tasks: (taskRows.results as Record<string, unknown>[]).map(mapTask), companies: (companyRows.results as Record<string, unknown>[]).map(mapCompany), contacts: (contactRows.results as Record<string, unknown>[]).map(mapContact), opportunities: (opportunityRows.results as Record<string, unknown>[]).map(mapOpportunity) };
  const serverTime = clock?.now;
  if (!seesOnlyOwnRecords(session)) return Response.json({ ...data, serverTime });
  return Response.json({ ...scopeWorkspace(data as never, session.user.name, await visibleLeadIds(db, workspaceId, session.user.name)), serverTime });
}

export async function PUT() {
  return Response.json({ error: 'Collection replacement is disabled. Use the record APIs.' }, { status: 405 });
}
