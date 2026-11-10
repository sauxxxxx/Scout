import { authenticateRequest } from '@/lib/auth';
import { recordAudit } from '@/lib/audit';
import { normalizeFacebookPageUrl } from '@/lib/finder-sales';
import { leadColumns, leadJoins } from '@/lib/lead-query';
import { leadImportSchema, nameKey } from '@/lib/lead-import';
import { notifyMember } from '@/lib/notifications';
import { phoneKey } from '@/lib/phone';
import { validationError } from '@/lib/validation';
import { mapLead } from '@/lib/workspace-store';

export const dynamic = 'force-dynamic';

/** Saves one batch of spreadsheet rows. Businesses already in Leads are skipped by name, so a retried batch never doubles up. */
export async function POST(request: Request) {
  const auth = await authenticateRequest(request, 'records:write');
  if (!auth.ok) return auth.response;
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: 'Invalid JSON body.' }, { status: 400 }); }
  const parsed = leadImportSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);
  const { db, session } = auth;
  const workspaceId = session.workspace.id;
  const input = parsed.data;

  if (!['owner', 'admin'].includes(session.role) && input.ownerId !== session.user.id) return Response.json({ error: 'You can only import leads for yourself.' }, { status: 403 });
  const owner = await db.prepare("SELECT u.name FROM workspace_memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? AND u.id=? AND u.status='active' AND m.role IN ('owner','admin','member')").bind(workspaceId, input.ownerId).first<{ name: string }>();
  if (!owner) return Response.json({ error: 'Choose an active workspace member as the owner.' }, { status: 422 });

  const names = input.rows.map(row => nameKey(row.name));
  const marks = names.map(() => '?').join(',');
  const [takenLeads, takenCompanies, phoned] = await db.batch([
    db.prepare(`SELECT lower(name) name FROM leads WHERE workspace_id=? AND lower(name) IN (${marks})`).bind(workspaceId, ...names),
    db.prepare(`SELECT id,lower(name) name FROM companies WHERE workspace_id=? AND lower(name) IN (${marks})`).bind(workspaceId, ...names),
    db.prepare("SELECT name,phone,country FROM leads WHERE workspace_id=? AND phone<>''").bind(workspaceId),
  ]);
  const phoneOwner = new Map((phoned.results as { name: string; phone: string; country: string }[]).map(row => [phoneKey(row.phone, row.country), row.name] as const).filter(([key]) => key));
  const leadTaken = new Set((takenLeads.results as { name: string }[]).map(row => nameKey(row.name)));
  const companyByName = new Map((takenCompanies.results as { id: string; name: string }[]).map(row => [nameKey(row.name), row.id]));

  let activityId = Number((await db.prepare('SELECT COALESCE(MAX(id),0)+1 next_id FROM activities').first<{ next_id: number }>())?.next_id || 1);
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  const created: string[] = [];
  const skipped: string[] = [];
  const phoneMatches: { name: string; existing: string }[] = [];
  for (const row of input.rows) {
    const key = nameKey(row.name);
    if (leadTaken.has(key)) { skipped.push(row.name); continue; }
    const phone = phoneKey(row.phone, row.country);
    if (phone && phoneOwner.has(phone) && !input.allowPhoneMatches) { phoneMatches.push({ name: row.name, existing: phoneOwner.get(phone)! }); continue; }
    leadTaken.add(key);
    if (phone) phoneOwner.set(phone, row.name);
    const leadId = crypto.randomUUID();
    const contactId = crypto.randomUUID();
    const existingCompany = companyByName.get(key);
    const companyId = existingCompany || crypto.randomUUID();
    const facebook = row.facebookUrl ? normalizeFacebookPageUrl(row.facebookUrl) || row.facebookUrl : '';
    const contact = row.contact || 'Primary contact';
    if (!existingCompany) statements.push(db.prepare("INSERT INTO companies (id,workspace_id,name,industry,city,phone,email,facebook_url,facebook_status,owner) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(companyId, workspaceId, row.name, row.industry, row.city, row.phone, row.email, facebook || null, facebook ? 'confirmed' : 'not_found', owner.name));
    else if (facebook) statements.push(db.prepare("UPDATE companies SET facebook_url=COALESCE(NULLIF(facebook_url,''),?),facebook_status=CASE WHEN COALESCE(facebook_url,'')='' THEN 'confirmed' ELSE facebook_status END,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?").bind(facebook, companyId, workspaceId));
    statements.push(db.prepare('INSERT INTO contacts (id,workspace_id,company_id,name,email,phone,is_primary) VALUES (?,?,?,?,?,?,?)').bind(contactId, workspaceId, companyId, contact, row.email, row.phone, existingCompany ? 0 : 1));
    statements.push(db.prepare(`INSERT INTO leads (country,id,workspace_id,company_id,primary_contact_id,version,name,industry,city,status,score,owner,last,next,phone,email,contact,priority,opportunity,archived,created_at,updated_at,changed_at)
      VALUES (?,?,?,?,?,1,?,?,?,?,0,?,'Imported from spreadsheet','',?,?,?,?,'',0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`)
      .bind(row.country, leadId, workspaceId, companyId, contactId, row.name, row.industry, row.city, input.status, owner.name, row.phone, row.email, contact, input.priority));
    statements.push(db.prepare("INSERT INTO activities (uid,workspace_id,id,lead,lead_id,company_id,contact_id,type,detail,time,owner,status,occurred_at,outcome,version) VALUES (?,?,?,?,?,?,?,'Lead import',?,'Just now',?,'Completed',?,'Imported',1)")
      .bind(crypto.randomUUID(), workspaceId, activityId++, row.name, leadId, companyId, contactId, `Imported from spreadsheet row ${row.line} by ${session.user.name}`, owner.name, now));
    created.push(leadId);
  }

  if (statements.length) {
    try { await db.batch(statements); }
    catch (error) {
      console.error('Lead import failed', error);
      return Response.json({ error: 'This batch could not be saved. Try again; rows already added will be skipped.' }, { status: 409 });
    }
  }
  const saved = created.length
    ? await db.prepare(`SELECT ${leadColumns} ${leadJoins} WHERE leads.workspace_id=? AND leads.id IN (${created.map(() => '?').join(',')})`).bind(workspaceId, ...created).all<Record<string, unknown>>()
    : { results: [] };
  if (created.length) {
    await recordAudit(auth, 'leads.imported', owner.name, `${created.length} from spreadsheet`);
    await notifyMember(auth, owner.name, 'leadAssignments', `${created.length} lead${created.length === 1 ? '' : 's'} assigned to you`, 'Imported from a spreadsheet', '?page=leads');
  }
  return Response.json({ imported: saved.results.map(mapLead), skipped, phoneMatches });
}
