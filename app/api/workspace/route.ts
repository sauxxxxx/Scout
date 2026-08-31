import { authenticateRequest } from '@/lib/auth';
import { mapLead, mapTask } from '@/lib/workspace-store';
import { mapCompany,mapContact,mapOpportunity } from '@/lib/crm-store';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;
  const { db, session } = auth;
  const [leadRows, taskRows,companyRows,contactRows,opportunityRows] = await db.batch([
    db.prepare('SELECT leads.*,companies.name company_name,companies.industry company_industry,companies.city company_city,companies.phone company_phone,companies.email company_email,contacts.name primary_contact_name,contacts.phone primary_contact_phone,contacts.email primary_contact_email FROM leads LEFT JOIN companies ON companies.id=leads.company_id LEFT JOIN contacts ON contacts.id=leads.primary_contact_id WHERE leads.workspace_id=? ORDER BY companies.name,leads.name').bind(session.workspace.id),
    db.prepare('SELECT * FROM tasks WHERE workspace_id=? ORDER BY id DESC').bind(session.workspace.id),
    db.prepare('SELECT * FROM companies WHERE workspace_id=? ORDER BY name').bind(session.workspace.id),
    db.prepare('SELECT * FROM contacts WHERE workspace_id=? ORDER BY is_primary DESC,name').bind(session.workspace.id),
    db.prepare('SELECT * FROM opportunities WHERE workspace_id=? ORDER BY updated_at DESC').bind(session.workspace.id),
  ]);
  return Response.json({ leads: (leadRows.results as Record<string, unknown>[]).map(mapLead), tasks: (taskRows.results as Record<string, unknown>[]).map(mapTask),companies:(companyRows.results as Record<string,unknown>[]).map(mapCompany),contacts:(contactRows.results as Record<string,unknown>[]).map(mapContact),opportunities:(opportunityRows.results as Record<string,unknown>[]).map(mapOpportunity) });
}

export async function PUT() {
  return Response.json({ error: 'Collection replacement is disabled. Use the record APIs.' }, { status: 405 });
}
