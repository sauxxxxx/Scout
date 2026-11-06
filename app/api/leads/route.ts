import { authenticateRequest } from '@/lib/auth';
import { DEFAULT_COUNTRY } from '@/lib/countries';
import { buildLeadFilter, leadColumns, leadJoins, leadOrder, pageParams } from '@/lib/lead-query';
import { seesOnlyOwnRecords } from '@/lib/record-scope';
import { mapLead } from '@/lib/workspace-store';
import { leadInputSchema, validationError } from '@/lib/validation';
import { syncLeadCoreCrm } from '@/lib/foundation-store';
import { recordAudit } from '@/lib/audit';
import { notifyMember } from '@/lib/notifications';
import { guardRecord } from '@/lib/record-scope';
import { detailsChanged, handOverLead, leadDetails } from '@/lib/lead-touch-store';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;
  const { db, session } = auth;
  const workspaceId = session.workspace.id;
  const params = new URL(request.url).searchParams;
  const id = params.get('id');
  if (id) {
    const blocked = await guardRecord(auth, 'lead', id);
    if (blocked) return blocked;
    const row = await db.prepare(`SELECT ${leadColumns} ${leadJoins} WHERE leads.id=? AND leads.workspace_id=?`).bind(id, workspaceId).first<Record<string, unknown>>();
    return row ? Response.json({ lead: mapLead(row) }) : Response.json({ error: 'Lead not found.' }, { status: 404 });
  }
  const { page, pageSize, offset } = pageParams(params);
  const ownOnly = seesOnlyOwnRecords(session);
  const { where, values } = buildLeadFilter(params, workspaceId, session.user.name, ownOnly);
  const scope = buildLeadFilter(new URLSearchParams(), workspaceId, session.user.name, ownOnly);
  const [rows, count, stats, industries, countries] = await db.batch([
    db.prepare(`SELECT ${leadColumns} ${leadJoins} WHERE ${where} ORDER BY ${leadOrder(params)} LIMIT ? OFFSET ?`).bind(...values, pageSize, offset),
    db.prepare(`SELECT COUNT(*) total ${leadJoins} WHERE ${where}`).bind(...values),
    db.prepare(`SELECT SUM(CASE WHEN leads.status NOT IN ('Won','Lost') THEN 1 ELSE 0 END) active,SUM(CASE WHEN leads.priority='High' THEN 1 ELSE 0 END) attention,SUM(CASE WHEN leads.status='Proposal' THEN 1 ELSE 0 END) proposals ${leadJoins} WHERE ${scope.where}`).bind(...scope.values),
    db.prepare(`SELECT DISTINCT leads.industry industry ${leadJoins} WHERE ${scope.where} ORDER BY 1 LIMIT 300`).bind(...scope.values),
    db.prepare(`SELECT DISTINCT leads.country country ${leadJoins} WHERE ${scope.where}`).bind(...scope.values),
  ]);
  const summary = stats.results[0] as { active: number | null; attention: number | null; proposals: number | null } | undefined;
  return Response.json({
    leads: (rows.results as Record<string, unknown>[]).map(mapLead),
    total: Number((count.results[0] as { total: number } | undefined)?.total || 0), page, pageSize,
    stats: { active: Number(summary?.active || 0), attention: Number(summary?.attention || 0), proposals: Number(summary?.proposals || 0) },
    industries: (industries.results as { industry: string }[]).map(row => row.industry).filter(Boolean),
    countries: (countries.results as { country: string }[]).map(row => row.country).filter(Boolean),
  });
}

export async function POST(request: Request) {
  const auth = await authenticateRequest(request, 'records:write');
  if (!auth.ok) return auth.response;
  const parsed = leadInputSchema.safeParse(await request.json());
  if (!parsed.success) return validationError(parsed.error);
  const lead = parsed.data;
  const id = lead.id || crypto.randomUUID();
  try {
    await auth.db.prepare(`INSERT INTO leads (country,id,workspace_id,company_id,primary_contact_id,version,name,industry,city,status,score,owner,last,next,phone,email,contact,priority,opportunity,value,probability,close_date,archived,created_at,updated_at,changed_at)
      VALUES (?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`)
      .bind(lead.country || DEFAULT_COUNTRY, id, auth.session.workspace.id, lead.companyId??null,lead.primaryContactId??null,lead.name, lead.industry, lead.city, lead.status, lead.score, lead.owner, lead.last, lead.next, lead.phone, lead.email, lead.contact, lead.priority, lead.opportunity, lead.value ?? null, lead.probability ?? null, lead.closeDate ?? null, lead.archived ? 1 : 0).run();
  } catch {
    return Response.json({ error: 'A lead with this name or ID already exists.' }, { status: 409 });
  }
  await notifyMember(auth, lead.owner, 'leadAssignments', 'Lead assigned to you', lead.name, `?page=leads`);
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
  const blocked = await guardRecord(auth, 'lead', lead.id);
  if (blocked) return blocked;
  // Compared with what the screen shows, because the name, city and contact can come from the linked company.
  const stored = await auth.db.prepare(`SELECT ${leadColumns} ${leadJoins} WHERE leads.id=? AND leads.workspace_id=?`).bind(lead.id, auth.session.workspace.id).first<Record<string, unknown>>();
  const before = stored ? mapLead(stored) : null;
  const changed = detailsChanged(before ? { ...before, archived: !!before.archived } : null, { ...lead, country: lead.country || DEFAULT_COUNTRY, archived: !!lead.archived }, leadDetails);
  const result = await auth.db.prepare(`UPDATE leads SET company_id=COALESCE(?,company_id),primary_contact_id=COALESCE(?,primary_contact_id),name=?,industry=?,city=?,status=?,score=?,owner=?,last=?,next=?,phone=?,email=?,contact=?,priority=?,opportunity=?,value=?,probability=?,close_date=?,archived=?,country=?,changed_at=CASE WHEN ?=1 THEN CURRENT_TIMESTAMP ELSE COALESCE(changed_at,updated_at) END,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=? AND version=?`)
    .bind(lead.companyId??null,lead.primaryContactId??null,lead.name, lead.industry, lead.city, lead.status, lead.score, lead.owner, lead.last, lead.next, lead.phone, lead.email, lead.contact, lead.priority, lead.opportunity, lead.value ?? null, lead.probability ?? null, lead.closeDate ?? null, lead.archived ? 1 : 0, lead.country || DEFAULT_COUNTRY, changed ? 1 : 0, lead.id, auth.session.workspace.id, lead.version).run();
  if (!result.meta.changes) return Response.json({ error: 'This lead changed elsewhere. Refresh and try again.', conflict: true }, { status: 409 });
  if (before && before.owner !== lead.owner) {
    await handOverLead(auth.db, auth.session.workspace.id, lead.id, before.owner, lead.owner);
    await notifyMember(auth, lead.owner, 'leadAssignments', 'Lead assigned to you', lead.name, `?page=leads`);
  }
  const row = await auth.db.prepare('SELECT * FROM leads WHERE id=? AND workspace_id=?').bind(lead.id, auth.session.workspace.id).first<Record<string, unknown>>();
  return Response.json({ lead: mapLead(row!) });
}

export async function DELETE(request: Request) {
  const auth = await authenticateRequest(request, 'records:delete');
  if (!auth.ok) return auth.response;
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return Response.json({ error: 'Stable lead ID is required.' }, { status: 400 });
  const blocked = await guardRecord(auth, 'lead', id);
  if (blocked) return blocked;
  const dependencies = await auth.db.prepare('SELECT (SELECT COUNT(*) FROM tasks WHERE workspace_id=? AND lead_id=?) + (SELECT COUNT(*) FROM activities WHERE workspace_id=? AND lead_id=?) + (SELECT COUNT(*) FROM opportunities WHERE workspace_id=? AND lead_id=?) total').bind(auth.session.workspace.id, id, auth.session.workspace.id, id, auth.session.workspace.id, id).first<{ total: number }>();
  if (Number(dependencies?.total || 0) > 0) return Response.json({ error: 'Archive this lead instead; it has linked history.' }, { status: 409 });
  const result = await auth.db.prepare('DELETE FROM leads WHERE id=? AND workspace_id=?').bind(id, auth.session.workspace.id).run();
  if (!result.meta.changes) return Response.json({ error: 'Lead not found.' }, { status: 404 });
  await recordAudit(auth, 'lead.deleted', id);
  return Response.json({ deleted: id });
}
