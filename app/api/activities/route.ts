import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { activityFiles, mapActivity } from '@/lib/activity-store';
import { recordAudit } from '@/lib/audit';
import { guardRecord, seesOnlyOwnRecords } from '@/lib/record-scope';
import { ownScope } from '@/lib/lead-query';
import { refreshLeadTouch } from '@/lib/lead-touch-store';
import { isoInZone } from '@/lib/task-dates';
import { activityInputSchema, validationError } from '@/lib/validation';

export const dynamic = 'force-dynamic';

type ActivityInput = ReturnType<typeof activityInputSchema.parse>;
const columns = 'lead=?,lead_id=?,company_id=?,contact_id=?,opportunity_id=?,type=?,detail=?,time=?,owner=?,status=?,occurred_at=?,outcome=?,duration=?,subject=?,value=?,document_link=?,attachment_key=?,attachment_name=?,related_task_id=?,related_task_uid=?,opportunity=?,deleted_at=?';
const values = (activity: ActivityInput, linked:{leadId:string;companyId:string;contactId?:string;opportunityId?:string;taskUid?:string}) => [activity.lead, linked.leadId,linked.companyId,activity.contactId||linked.contactId||null,activity.opportunityId||linked.opportunityId||null, activity.type, activity.detail, activity.time, activity.owner, activity.status || 'Completed', activity.occurredAt ?? null, activity.outcome ?? null, activity.duration ?? null, activity.subject ?? null, activity.value ?? null, activity.documentLink ?? null, activity.attachmentKey ?? null, activity.attachmentName ?? null, activity.relatedTaskId ?? null, linked.taskUid ?? null, activity.opportunity ?? null, activity.deletedAt ?? null];
async function relationships(db:D1Database,workspaceId:string,activity:ActivityInput){const lead=await db.prepare('SELECT id,company_id,primary_contact_id FROM leads WHERE workspace_id=? AND (id=? OR name=?) LIMIT 1').bind(workspaceId,activity.leadId||'',activity.lead).first<{id:string;company_id:string;primary_contact_id?:string}>();let taskUid=activity.relatedTaskUid;if(!taskUid&&activity.relatedTaskId!=null)taskUid=(await db.prepare('SELECT uid FROM tasks WHERE workspace_id=? AND id=? LIMIT 1').bind(workspaceId,activity.relatedTaskId).first<{uid:string}>())?.uid;if(!lead)return {taskUid};const contactId=activity.contactId?(await db.prepare('SELECT id FROM contacts WHERE workspace_id=? AND id=? AND company_id=? AND archived=0').bind(workspaceId,activity.contactId,lead.company_id).first<{id:string}>())?.id:lead.primary_contact_id;if(activity.contactId&&!contactId)return {taskUid};const opportunityId=activity.opportunityId?(await db.prepare('SELECT id FROM opportunities WHERE workspace_id=? AND id=? AND company_id=? AND archived=0').bind(workspaceId,activity.opportunityId,lead.company_id).first<{id:string}>())?.id:(await db.prepare('SELECT id FROM opportunities WHERE workspace_id=? AND lead_id=? AND archived=0 ORDER BY updated_at DESC LIMIT 1').bind(workspaceId,lead.id).first<{id:string}>())?.id;if(activity.opportunityId&&!opportunityId)return {taskUid};return {leadId:lead.id,companyId:lead.company_id,contactId,opportunityId,taskUid}}

export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;
  const { db, session } = auth;
  const expired = await db.prepare("SELECT attachment_key FROM activities WHERE workspace_id=? AND deleted_at IS NOT NULL AND deleted_at < datetime('now','-30 days') AND attachment_key IS NOT NULL").bind(session.workspace.id).all<{ attachment_key: string }>();
  await Promise.all(expired.results.map(row => activityFiles().delete(row.attachment_key)));
  await db.prepare("DELETE FROM activities WHERE workspace_id=? AND deleted_at IS NOT NULL AND deleted_at < datetime('now','-30 days')").bind(session.workspace.id).run();

  const params = new URL(request.url).searchParams;
  const all = params.get('all') === '1';
  const uid = params.get('uid');
  if (uid) {
    const blocked = await guardRecord(auth, 'activity', uid);
    if (blocked) return blocked;
    const row = await db.prepare('SELECT * FROM activities WHERE uid=? AND workspace_id=?').bind(uid, session.workspace.id).first<Parameters<typeof mapActivity>[0]>();
    return row ? NextResponse.json({ activity: mapActivity(row) }) : NextResponse.json({ error: 'Activity not found.' }, { status: 404 });
  }
  const page = Math.max(1, Number(params.get('page')) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(params.get('pageSize')) || 6));
  const clauses: string[] = ['workspace_id = ?'];
  const queryValues: (string | number)[] = [session.workspace.id];
  const scope = params.get('scope') || 'Completed';
  if (!all) {
    if (scope === 'Deleted') clauses.push('deleted_at IS NOT NULL');
    else if (scope === 'Scheduled') clauses.push("deleted_at IS NULL AND status = 'Scheduled'");
    else clauses.push("deleted_at IS NULL AND status != 'Scheduled'");
  }
  const exact = (key: string, column: string, empty: string) => {
    const value = params.get(key);
    if (value && value !== empty) { clauses.push(`${column} = ?`); queryValues.push(value); }
  };
  exact('type', 'type', 'All activity');
  exact('owner', 'owner', 'Entire team');
  exact('lead', 'lead', 'All leads');
  exact('leadId', 'lead_id', '');
  exact('companyId', 'company_id', '');
  const since = params.get('since');
  if (since) { clauses.push('updated_at>=?'); queryValues.push(since); }
  const query = params.get('query')?.trim();
  if (query) { clauses.push("LOWER(lead || ' ' || detail || ' ' || COALESCE(subject,'') || ' ' || COALESCE(outcome,'')) LIKE ?"); queryValues.push(`%${query.toLowerCase()}%`); }
  const period = params.get('period');
  const from = params.get('from');
  const to = params.get('to');
  const today = isoInZone(session.timezone);
  if (period === 'Today') { clauses.push('date(occurred_at)=date(?)'); queryValues.push(today); }
  if (period === 'This week') {
    const start = new Date(`${today}T12:00:00Z`);
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 6);
    clauses.push('date(occurred_at) BETWEEN date(?) AND date(?)');
    queryValues.push(start.toISOString().slice(0, 10), end.toISOString().slice(0, 10));
  }
  if (period === 'This month') { clauses.push("strftime('%Y-%m',occurred_at)=?"); queryValues.push(today.slice(0, 7)); }
  if (period === 'Custom range' && from) { clauses.push('date(occurred_at)>=date(?)'); queryValues.push(from); }
  if (period === 'Custom range' && to) { clauses.push('date(occurred_at)<=date(?)'); queryValues.push(to); }
  if (seesOnlyOwnRecords(session)) {
    const scope = ownScope(session.workspace.id, session.user.name);
    clauses.push(`(lead_id IN (SELECT leads.id FROM leads WHERE leads.workspace_id=? AND ${scope.sql}) OR (lead_id IS NULL AND owner=?))`);
    queryValues.push(session.workspace.id, ...scope.values, session.user.name);
  }
  const where = `WHERE ${clauses.join(' AND ')}`;
  const count = await db.prepare(`SELECT COUNT(*) total FROM activities ${where}`).bind(...queryValues).first<{ total: number }>();
  const sql = `SELECT * FROM activities ${where} ORDER BY COALESCE(occurred_at, created_at) ${scope === 'Scheduled' ? 'ASC' : 'DESC'}, id DESC${all ? ` LIMIT ${Math.min(300, Math.max(1, Number(params.get('limit')) || 300))}` : ' LIMIT ? OFFSET ?'}`;
  const boundValues = all ? queryValues : [...queryValues, pageSize, (page - 1) * pageSize];
  const result = await db.prepare(sql).bind(...boundValues).all();
  return NextResponse.json({ activities: (result.results as unknown as Parameters<typeof mapActivity>[0][]).map(mapActivity), total: Number(count?.total || 0), page, pageSize });
}

export async function POST(request: Request) {
  const auth = await authenticateRequest(request, 'records:write');
  if (!auth.ok) return auth.response;
  const parsed = activityInputSchema.safeParse(await request.json());
  if (!parsed.success) return validationError(parsed.error);
  const activity = parsed.data;
  const uid = activity.uid || crypto.randomUUID();
  const linked=await relationships(auth.db,auth.session.workspace.id,activity);if(!linked.leadId)return NextResponse.json({error:'The selected lead does not exist in this workspace.'},{status:422});
  const blocked=activity.type==='Assignment'?null:await guardRecord(auth,'lead',linked.leadId);if(blocked)return blocked;
  await auth.db.prepare(`INSERT INTO activities (uid,workspace_id,id,version,lead,lead_id,company_id,contact_id,opportunity_id,type,detail,time,owner,status,occurred_at,outcome,duration,subject,value,document_link,attachment_key,attachment_name,related_task_id,related_task_uid,opportunity,deleted_at,updated_at) VALUES (?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`)
    .bind(uid, auth.session.workspace.id, activity.id, ...values(activity,linked as {leadId:string;companyId:string;contactId?:string;opportunityId?:string;taskUid?:string})).run();
  await refreshLeadTouch(auth.db, auth.session.workspace.id, linked.leadId, activity.type);
  const row = await auth.db.prepare('SELECT * FROM activities WHERE uid=? AND workspace_id=?').bind(uid, auth.session.workspace.id).first<Parameters<typeof mapActivity>[0]>();
  return NextResponse.json({ activity: mapActivity(row!) }, { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await authenticateRequest(request, 'records:write');
  if (!auth.ok) return auth.response;
  const parsed = activityInputSchema.safeParse(await request.json());
  if (!parsed.success) return validationError(parsed.error);
  const activity = parsed.data;
  if (!activity.uid || !activity.version) return NextResponse.json({ error: 'Stable ID and version are required.' }, { status: 400 });
  const blocked = await guardRecord(auth, 'activity', activity.uid);
  if (blocked) return blocked;
  if (activity.deletedAt && !auth.session.capabilities['records:delete']) {
    const current = await auth.db.prepare('SELECT deleted_at FROM activities WHERE uid=? AND workspace_id=?').bind(activity.uid, auth.session.workspace.id).first<{ deleted_at: string | null }>();
    if (!current?.deleted_at) return NextResponse.json({ error: 'Your role does not allow deleting records.' }, { status: 403 });
  }
  const linked=await relationships(auth.db,auth.session.workspace.id,activity);if(!linked.leadId)return NextResponse.json({error:'The selected lead does not exist in this workspace.'},{status:422});
  const result = await auth.db.prepare(`UPDATE activities SET ${columns},version=version+1,updated_at=CURRENT_TIMESTAMP WHERE uid=? AND workspace_id=? AND version=?`)
    .bind(...values(activity,linked as {leadId:string;companyId:string;contactId?:string;opportunityId?:string;taskUid?:string}), activity.uid, auth.session.workspace.id, activity.version).run();
  if (!result.meta.changes) return NextResponse.json({ error: 'This activity changed elsewhere. Refresh and try again.', conflict: true }, { status: 409 });
  await refreshLeadTouch(auth.db, auth.session.workspace.id, linked.leadId, activity.type);
  const row = await auth.db.prepare('SELECT * FROM activities WHERE uid=? AND workspace_id=?').bind(activity.uid, auth.session.workspace.id).first<Parameters<typeof mapActivity>[0]>();
  return NextResponse.json({ activity: mapActivity(row!) });
}

export async function DELETE(request: Request) {
  const auth = await authenticateRequest(request, 'records:delete');
  if (!auth.ok) return auth.response;
  const uid = new URL(request.url).searchParams.get('id');
  if (!uid) return NextResponse.json({ error: 'Stable activity ID is required.' }, { status: 400 });
  const blocked = await guardRecord(auth, 'activity', uid);
  if (blocked) return blocked;
  const row = await auth.db.prepare('SELECT attachment_key,lead_id,type FROM activities WHERE uid=? AND workspace_id=?').bind(uid, auth.session.workspace.id).first<{ attachment_key: string | null; lead_id: string | null; type: string }>();
  if (!row) return NextResponse.json({ error: 'Activity not found.' }, { status: 404 });
  if (row.attachment_key) await activityFiles().delete(row.attachment_key);
  await auth.db.prepare('DELETE FROM activities WHERE uid=? AND workspace_id=?').bind(uid, auth.session.workspace.id).run();
  if (row.lead_id) await refreshLeadTouch(auth.db, auth.session.workspace.id, row.lead_id, row.type);
  await recordAudit(auth, 'activity.deleted', uid);
  return NextResponse.json({ deleted: uid });
}
