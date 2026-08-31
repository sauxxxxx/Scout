import { authenticateRequest } from '@/lib/auth';
import { mapLead } from '@/lib/workspace-store';
import { leadInputSchema, validationError } from '@/lib/validation';
import { syncLeadCoreCrm } from '@/lib/foundation-store';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const auth = await authenticateRequest(request, 'records:write');
  if (!auth.ok) return auth.response;
  const parsed = leadInputSchema.safeParse(await request.json());
  if (!parsed.success) return validationError(parsed.error);
  const lead = parsed.data;
  const id = lead.id || crypto.randomUUID();
  try {
    await auth.db.prepare(`INSERT INTO leads (id,workspace_id,company_id,primary_contact_id,version,name,industry,city,status,score,owner,last,next,phone,email,contact,priority,opportunity,value,probability,close_date,archived,created_at,updated_at)
      VALUES (?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`)
      .bind(id, auth.session.workspace.id, lead.companyId??null,lead.primaryContactId??null,lead.name, lead.industry, lead.city, lead.status, lead.score, lead.owner, lead.last, lead.next, lead.phone, lead.email, lead.contact, lead.priority, lead.opportunity, lead.value ?? null, lead.probability ?? null, lead.closeDate ?? null, lead.archived ? 1 : 0).run();
  } catch {
    return Response.json({ error: 'A lead with this name or ID already exists.' }, { status: 409 });
  }
  await syncLeadCoreCrm(auth.db,auth.session.workspace.id,id);const row = await auth.db.prepare('SELECT * FROM leads WHERE id=? AND workspace_id=?').bind(id, auth.session.workspace.id).first<Record<string, unknown>>();
  return Response.json({ lead: mapLead(row!) }, { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await authenticateRequest(request, 'records:write');
  if (!auth.ok) return auth.response;
  const parsed = leadInputSchema.safeParse(await request.json());
  if (!parsed.success) return validationError(parsed.error);
  const lead = parsed.data;
  if (!lead.id || !lead.version) return Response.json({ error: 'Stable ID and version are required.' }, { status: 400 });
  const result = await auth.db.prepare(`UPDATE leads SET company_id=COALESCE(?,company_id),primary_contact_id=COALESCE(?,primary_contact_id),name=?,industry=?,city=?,status=?,score=?,owner=?,last=?,next=?,phone=?,email=?,contact=?,priority=?,opportunity=?,value=?,probability=?,close_date=?,archived=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=? AND version=?`)
    .bind(lead.companyId??null,lead.primaryContactId??null,lead.name, lead.industry, lead.city, lead.status, lead.score, lead.owner, lead.last, lead.next, lead.phone, lead.email, lead.contact, lead.priority, lead.opportunity, lead.value ?? null, lead.probability ?? null, lead.closeDate ?? null, lead.archived ? 1 : 0, lead.id, auth.session.workspace.id, lead.version).run();
  if (!result.meta.changes) return Response.json({ error: 'This lead changed elsewhere. Refresh and try again.' }, { status: 409 });
  const row = await auth.db.prepare('SELECT * FROM leads WHERE id=? AND workspace_id=?').bind(lead.id, auth.session.workspace.id).first<Record<string, unknown>>();
  return Response.json({ lead: mapLead(row!) });
}

export async function DELETE(request: Request) {
  const auth = await authenticateRequest(request, 'records:write');
  if (!auth.ok) return auth.response;
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return Response.json({ error: 'Stable lead ID is required.' }, { status: 400 });
  const dependencies = await auth.db.prepare('SELECT (SELECT COUNT(*) FROM tasks WHERE workspace_id=? AND lead_id=?) + (SELECT COUNT(*) FROM activities WHERE workspace_id=? AND lead_id=?) + (SELECT COUNT(*) FROM opportunities WHERE workspace_id=? AND lead_id=?) total').bind(auth.session.workspace.id, id, auth.session.workspace.id, id, auth.session.workspace.id, id).first<{ total: number }>();
  if (Number(dependencies?.total || 0) > 0) return Response.json({ error: 'Archive this lead instead; it has linked history.' }, { status: 409 });
  const result = await auth.db.prepare('DELETE FROM leads WHERE id=? AND workspace_id=?').bind(id, auth.session.workspace.id).run();
  if (!result.meta.changes) return Response.json({ error: 'Lead not found.' }, { status: 404 });
  return Response.json({ deleted: id });
}
