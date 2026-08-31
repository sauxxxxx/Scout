import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { activityFiles, mapActivity } from '@/lib/activity-store';
import { activityInputSchema, validationError } from '@/lib/validation';

export const dynamic = 'force-dynamic';

type ActivityInput = ReturnType<typeof activityInputSchema.parse>;
const columns = 'lead=?,lead_id=?,type=?,detail=?,time=?,owner=?,status=?,occurred_at=?,outcome=?,duration=?,subject=?,value=?,document_link=?,attachment_key=?,attachment_name=?,related_task_id=?,related_task_uid=?,opportunity=?,deleted_at=?';
const values = (activity: ActivityInput, leadId: string, taskUid?:string) => [activity.lead, leadId, activity.type, activity.detail, activity.time, activity.owner, activity.status || 'Completed', activity.occurredAt ?? null, activity.outcome ?? null, activity.duration ?? null, activity.subject ?? null, activity.value ?? null, activity.documentLink ?? null, activity.attachmentKey ?? null, activity.attachmentName ?? null, activity.relatedTaskId ?? null, taskUid ?? null, activity.opportunity ?? null, activity.deletedAt ?? null];
async function relationships(db:D1Database,workspaceId:string,activity:ActivityInput){const lead=await db.prepare('SELECT id FROM leads WHERE workspace_id=? AND (id=? OR name=?) LIMIT 1').bind(workspaceId,activity.leadId||'',activity.lead).first<{id:string}>();let taskUid=activity.relatedTaskUid;if(!taskUid&&activity.relatedTaskId!=null)taskUid=(await db.prepare('SELECT uid FROM tasks WHERE workspace_id=? AND id=? LIMIT 1').bind(workspaceId,activity.relatedTaskId).first<{uid:string}>())?.uid;return {leadId:lead?.id,taskUid}}

export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;
  const { db, session } = auth;
  const expired = await db.prepare("SELECT attachment_key FROM activities WHERE workspace_id=? AND deleted_at IS NOT NULL AND deleted_at < datetime('now','-30 days') AND attachment_key IS NOT NULL").bind(session.workspace.id).all<{ attachment_key: string }>();
  await Promise.all(expired.results.map(row => activityFiles().delete(row.attachment_key)));
  await db.prepare("DELETE FROM activities WHERE workspace_id=? AND deleted_at IS NOT NULL AND deleted_at < datetime('now','-30 days')").bind(session.workspace.id).run();

  const params = new URL(request.url).searchParams;
  const all = params.get('all') === '1';
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
  const query = params.get('query')?.trim();
  if (query) { clauses.push("LOWER(lead || ' ' || detail || ' ' || COALESCE(subject,'') || ' ' || COALESCE(outcome,'')) LIKE ?"); queryValues.push(`%${query.toLowerCase()}%`); }
  const period = params.get('period');
  const from = params.get('from');
  const to = params.get('to');
  if (period === 'Today') clauses.push("date(occurred_at)=date('now','localtime')");
  if (period === 'This week') clauses.push("date(occurred_at) BETWEEN date('now','localtime',printf('-%d days',(CAST(strftime('%w','now','localtime') AS INTEGER)+6)%7)) AND date('now','localtime',printf('+%d days',6-((CAST(strftime('%w','now','localtime') AS INTEGER)+6)%7)))");
  if (period === 'This month') clauses.push("strftime('%Y-%m',occurred_at)=strftime('%Y-%m','now','localtime')");
  if (period === 'Custom range' && from) { clauses.push('date(occurred_at)>=date(?)'); queryValues.push(from); }
  if (period === 'Custom range' && to) { clauses.push('date(occurred_at)<=date(?)'); queryValues.push(to); }
  const where = `WHERE ${clauses.join(' AND ')}`;
  const count = await db.prepare(`SELECT COUNT(*) total FROM activities ${where}`).bind(...queryValues).first<{ total: number }>();
  const sql = `SELECT * FROM activities ${where} ORDER BY COALESCE(occurred_at, created_at) ${scope === 'Scheduled' ? 'ASC' : 'DESC'}, id DESC${all ? '' : ' LIMIT ? OFFSET ?'}`;
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
  await auth.db.prepare(`INSERT INTO activities (uid,workspace_id,id,version,lead,lead_id,type,detail,time,owner,status,occurred_at,outcome,duration,subject,value,document_link,attachment_key,attachment_name,related_task_id,related_task_uid,opportunity,deleted_at,updated_at) VALUES (?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`)
    .bind(uid, auth.session.workspace.id, activity.id, ...values(activity,linked.leadId,linked.taskUid)).run();
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
  const linked=await relationships(auth.db,auth.session.workspace.id,activity);if(!linked.leadId)return NextResponse.json({error:'The selected lead does not exist in this workspace.'},{status:422});
  const result = await auth.db.prepare(`UPDATE activities SET ${columns},version=version+1,updated_at=CURRENT_TIMESTAMP WHERE uid=? AND workspace_id=? AND version=?`)
    .bind(...values(activity,linked.leadId,linked.taskUid), activity.uid, auth.session.workspace.id, activity.version).run();
  if (!result.meta.changes) return NextResponse.json({ error: 'This activity changed elsewhere. Refresh and try again.' }, { status: 409 });
  const row = await auth.db.prepare('SELECT * FROM activities WHERE uid=? AND workspace_id=?').bind(activity.uid, auth.session.workspace.id).first<Parameters<typeof mapActivity>[0]>();
  return NextResponse.json({ activity: mapActivity(row!) });
}

export async function DELETE(request: Request) {
  const auth = await authenticateRequest(request, 'records:write');
  if (!auth.ok) return auth.response;
  const uid = new URL(request.url).searchParams.get('id');
  if (!uid) return NextResponse.json({ error: 'Stable activity ID is required.' }, { status: 400 });
  const row = await auth.db.prepare('SELECT attachment_key FROM activities WHERE uid=? AND workspace_id=?').bind(uid, auth.session.workspace.id).first<{ attachment_key: string | null }>();
  if (!row) return NextResponse.json({ error: 'Activity not found.' }, { status: 404 });
  if (row.attachment_key) await activityFiles().delete(row.attachment_key);
  await auth.db.prepare('DELETE FROM activities WHERE uid=? AND workspace_id=?').bind(uid, auth.session.workspace.id).run();
  return NextResponse.json({ deleted: uid });
}
