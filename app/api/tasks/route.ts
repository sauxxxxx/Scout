import { authenticateRequest } from '@/lib/auth';
import { detailsChanged, markLeadChanged, taskDetails } from '@/lib/lead-touch-store';
import { pageParams } from '@/lib/lead-query';
import { mapTask } from '@/lib/workspace-store';
import { taskInputSchema, validationError } from '@/lib/validation';
import { anchorForZone, taskDueIso } from '@/lib/task-dates';
import { recordAudit } from '@/lib/audit';
import { notifyMember } from '@/lib/notifications';
import { ownScope } from '@/lib/lead-query';
import { guardRecord, seesOnlyOwnRecords } from '@/lib/record-scope';

export const dynamic = 'force-dynamic';

type TaskInput = ReturnType<typeof taskInputSchema.parse>;
const taskColumns = 'title=?,lead=?,lead_id=?,company_id=?,contact_id=?,opportunity_id=?,owner=?,priority=?,due=?,due_at=?,time=?,type=?,notes=?,status=?,reminder=?,recurrence=?,outcome=?';
// "Overdue" is a label worked out from the date, so saving a task must not reset that date to today.
const dueDate = (task: TaskInput, timezone: string) => (task.due === 'Overdue' && task.dueAt ? task.dueAt.slice(0, 10) : taskDueIso(task.due, anchorForZone(timezone)));
const values = (task: TaskInput, linked:{leadId:string;companyId:string;contactId?:string;opportunityId?:string}, timezone: string) => [task.title, task.lead, linked.leadId,linked.companyId,task.contactId||linked.contactId||null,task.opportunityId||linked.opportunityId||null, task.owner, task.priority, task.due,dueDate(task,timezone), task.time, task.type, task.notes, task.status, task.reminder ?? null, task.recurrence ?? null, task.outcome ?? null];
async function linkedLead(db:D1Database,workspaceId:string,task:TaskInput){const row=await db.prepare('SELECT id,company_id,primary_contact_id FROM leads WHERE workspace_id=? AND (id=? OR name=?) LIMIT 1').bind(workspaceId,task.leadId||'',task.lead).first<{id:string;company_id:string;primary_contact_id?:string}>();if(!row)return;const contactId=task.contactId?(await db.prepare('SELECT id FROM contacts WHERE workspace_id=? AND id=? AND company_id=? AND archived=0').bind(workspaceId,task.contactId,row.company_id).first<{id:string}>())?.id:row.primary_contact_id;if(task.contactId&&!contactId)return;const opportunityId=task.opportunityId?(await db.prepare('SELECT id FROM opportunities WHERE workspace_id=? AND id=? AND company_id=? AND archived=0').bind(workspaceId,task.opportunityId,row.company_id).first<{id:string}>())?.id:(await db.prepare('SELECT id FROM opportunities WHERE workspace_id=? AND lead_id=? AND archived=0 ORDER BY updated_at DESC LIMIT 1').bind(workspaceId,row.id).first<{id:string}>())?.id;if(task.opportunityId&&!opportunityId)return;return {leadId:row.id,companyId:row.company_id,contactId,opportunityId}}

export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;
  const { db, session } = auth;
  const params = new URL(request.url).searchParams;
  const id = params.get('id');
  if (id) {
    const blocked = await guardRecord(auth, 'task', id);
    if (blocked) return blocked;
    const row = await db.prepare('SELECT * FROM tasks WHERE uid=? AND workspace_id=?').bind(id, session.workspace.id).first<Record<string, unknown>>();
    return row ? Response.json({ task: mapTask(row) }) : Response.json({ error: 'Task not found.' }, { status: 404 });
  }
  const { page, pageSize, offset } = pageParams(params);
  const own = seesOnlyOwnRecords(session) ? ownScope(session.workspace.id, session.user.name) : null;
  const where = `workspace_id=? AND status='Completed'${own ? ` AND (lead_id IN (SELECT leads.id FROM leads WHERE leads.workspace_id=? AND ${own.sql}) OR (lead_id IS NULL AND owner=?))` : ''}`;
  const values = own ? [session.workspace.id, session.workspace.id, ...own.values, session.user.name] : [session.workspace.id];
  const rows = await db.prepare(`SELECT * FROM tasks WHERE ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`).bind(...values, pageSize, offset).all<Record<string, unknown>>();
  const count = await db.prepare(`SELECT COUNT(*) total FROM tasks WHERE ${where}`).bind(...values).first<{ total: number }>();
  const tasks = rows.results.map(mapTask);
  return Response.json({ tasks, total: Number(count?.total || 0), page, pageSize });
}

export async function POST(request: Request) {
  const auth = await authenticateRequest(request, 'records:write');
  if (!auth.ok) return auth.response;
  const parsed = taskInputSchema.safeParse(await request.json());
  if (!parsed.success) return validationError(parsed.error);
  const task = parsed.data;
  const uid = task.uid || crypto.randomUUID();
  const linked=await linkedLead(auth.db,auth.session.workspace.id,task);if(!linked)return Response.json({error:'The selected lead does not exist in this workspace.'},{status:422});
  const blocked=await guardRecord(auth,'lead',linked.leadId);if(blocked)return blocked;
  await auth.db.prepare(`INSERT INTO tasks (uid,workspace_id,id,version,title,lead,lead_id,company_id,contact_id,opportunity_id,owner,priority,due,due_at,time,type,notes,status,reminder,recurrence,outcome,created_at,updated_at) VALUES (?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`)
    .bind(uid, auth.session.workspace.id, task.id, ...values(task,linked,auth.session.timezone)).run();
  await auth.db.prepare("UPDATE tasks SET completed_at=CASE WHEN status='Completed' THEN COALESCE(completed_at,CURRENT_TIMESTAMP) ELSE NULL END WHERE uid=? AND workspace_id=?").bind(uid, auth.session.workspace.id).run();
  await notifyMember(auth, task.owner, 'leadAssignments', 'Task assigned to you', task.title, '?page=tasks');
  await markLeadChanged(auth.db, auth.session.workspace.id, linked.leadId);
  const row = await auth.db.prepare('SELECT * FROM tasks WHERE uid=? AND workspace_id=?').bind(uid, auth.session.workspace.id).first<Record<string, unknown>>();
  return Response.json({ task: mapTask(row!) }, { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await authenticateRequest(request, 'records:write');
  if (!auth.ok) return auth.response;
  const parsed = taskInputSchema.safeParse(await request.json());
  if (!parsed.success) return validationError(parsed.error);
  const task = parsed.data;
  if (!task.uid || !task.version) return Response.json({ error: 'Stable ID and version are required.' }, { status: 400 });
  const blocked = await guardRecord(auth, 'task', task.uid);
  if (blocked) return blocked;
  const linked=await linkedLead(auth.db,auth.session.workspace.id,task);if(!linked)return Response.json({error:'The selected lead does not exist in this workspace.'},{status:422});
  const before = await auth.db.prepare('SELECT * FROM tasks WHERE uid=? AND workspace_id=?').bind(task.uid, auth.session.workspace.id).first<Record<string, unknown>>();
  const result = await auth.db.prepare(`UPDATE tasks SET ${taskColumns},version=version+1,updated_at=CURRENT_TIMESTAMP WHERE uid=? AND workspace_id=? AND version=?`)
    .bind(...values(task,linked,auth.session.timezone), task.uid, auth.session.workspace.id, task.version).run();
  if (!result.meta.changes) return Response.json({ error: 'This task changed elsewhere. Refresh and try again.', conflict: true }, { status: 409 });
  // Reports need the day a task was finished, and editing it later must not move that day.
  await auth.db.prepare("UPDATE tasks SET completed_at=CASE WHEN status='Completed' THEN COALESCE(completed_at,CURRENT_TIMESTAMP) ELSE NULL END WHERE uid=? AND workspace_id=?").bind(task.uid, auth.session.workspace.id).run();
  if (before && before.owner !== task.owner) await notifyMember(auth, task.owner, 'leadAssignments', 'Task assigned to you', task.title, '?page=tasks');
  const row = await auth.db.prepare('SELECT * FROM tasks WHERE uid=? AND workspace_id=?').bind(task.uid, auth.session.workspace.id).first<Record<string, unknown>>();
  if (detailsChanged(before, row, taskDetails)) await markLeadChanged(auth.db, auth.session.workspace.id, linked.leadId);
  return Response.json({ task: mapTask(row!) });
}

export async function DELETE(request: Request) {
  const auth = await authenticateRequest(request, 'records:delete');
  if (!auth.ok) return auth.response;
  const uid = new URL(request.url).searchParams.get('id');
  if (!uid) return Response.json({ error: 'Stable task ID is required.' }, { status: 400 });
  const blocked = await guardRecord(auth, 'task', uid);
  if (blocked) return blocked;
  const task = await auth.db.prepare('SELECT lead_id FROM tasks WHERE uid=? AND workspace_id=?').bind(uid, auth.session.workspace.id).first<{ lead_id: string | null }>();
  const result = await auth.db.prepare('DELETE FROM tasks WHERE uid=? AND workspace_id=?').bind(uid, auth.session.workspace.id).run();
  if (!result.meta.changes) return Response.json({ error: 'Task not found.' }, { status: 404 });
  if (task?.lead_id) await markLeadChanged(auth.db, auth.session.workspace.id, task.lead_id);
  await recordAudit(auth, 'task.deleted', uid);
  return Response.json({ deleted: uid });
}
