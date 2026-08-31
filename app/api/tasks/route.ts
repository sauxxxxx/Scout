import { authenticateRequest } from '@/lib/auth';
import { mapTask } from '@/lib/workspace-store';
import { taskInputSchema, validationError } from '@/lib/validation';
import { taskDueIso } from '@/lib/task-dates';

export const dynamic = 'force-dynamic';

type TaskInput = ReturnType<typeof taskInputSchema.parse>;
const taskColumns = 'title=?,lead=?,lead_id=?,company_id=?,contact_id=?,opportunity_id=?,owner=?,priority=?,due=?,due_at=?,time=?,type=?,notes=?,status=?,reminder=?,recurrence=?,outcome=?';
const values = (task: TaskInput, linked:{leadId:string;companyId:string;contactId?:string;opportunityId?:string}) => [task.title, task.lead, linked.leadId,linked.companyId,task.contactId||linked.contactId||null,task.opportunityId||linked.opportunityId||null, task.owner, task.priority, task.due,taskDueIso(task.due), task.time, task.type, task.notes, task.status, task.reminder ?? null, task.recurrence ?? null, task.outcome ?? null];
async function linkedLead(db:D1Database,workspaceId:string,task:TaskInput){const row=await db.prepare('SELECT id,company_id,primary_contact_id FROM leads WHERE workspace_id=? AND (id=? OR name=?) LIMIT 1').bind(workspaceId,task.leadId||'',task.lead).first<{id:string;company_id:string;primary_contact_id?:string}>();if(!row)return;const contactId=task.contactId?(await db.prepare('SELECT id FROM contacts WHERE workspace_id=? AND id=? AND company_id=? AND archived=0').bind(workspaceId,task.contactId,row.company_id).first<{id:string}>())?.id:row.primary_contact_id;if(task.contactId&&!contactId)return;const opportunityId=task.opportunityId?(await db.prepare('SELECT id FROM opportunities WHERE workspace_id=? AND id=? AND company_id=? AND archived=0').bind(workspaceId,task.opportunityId,row.company_id).first<{id:string}>())?.id:(await db.prepare('SELECT id FROM opportunities WHERE workspace_id=? AND lead_id=? AND archived=0 ORDER BY updated_at DESC LIMIT 1').bind(workspaceId,row.id).first<{id:string}>())?.id;if(task.opportunityId&&!opportunityId)return;return {leadId:row.id,companyId:row.company_id,contactId,opportunityId}}

export async function POST(request: Request) {
  const auth = await authenticateRequest(request, 'records:write');
  if (!auth.ok) return auth.response;
  const parsed = taskInputSchema.safeParse(await request.json());
  if (!parsed.success) return validationError(parsed.error);
  const task = parsed.data;
  const uid = task.uid || crypto.randomUUID();
  const linked=await linkedLead(auth.db,auth.session.workspace.id,task);if(!linked)return Response.json({error:'The selected lead does not exist in this workspace.'},{status:422});
  await auth.db.prepare(`INSERT INTO tasks (uid,workspace_id,id,version,title,lead,lead_id,company_id,contact_id,opportunity_id,owner,priority,due,due_at,time,type,notes,status,reminder,recurrence,outcome,created_at,updated_at) VALUES (?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`)
    .bind(uid, auth.session.workspace.id, task.id, ...values(task,linked)).run();
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
  const linked=await linkedLead(auth.db,auth.session.workspace.id,task);if(!linked)return Response.json({error:'The selected lead does not exist in this workspace.'},{status:422});
  const result = await auth.db.prepare(`UPDATE tasks SET ${taskColumns},version=version+1,updated_at=CURRENT_TIMESTAMP WHERE uid=? AND workspace_id=? AND version=?`)
    .bind(...values(task,linked), task.uid, auth.session.workspace.id, task.version).run();
  if (!result.meta.changes) return Response.json({ error: 'This task changed elsewhere. Refresh and try again.' }, { status: 409 });
  const row = await auth.db.prepare('SELECT * FROM tasks WHERE uid=? AND workspace_id=?').bind(task.uid, auth.session.workspace.id).first<Record<string, unknown>>();
  return Response.json({ task: mapTask(row!) });
}

export async function DELETE(request: Request) {
  const auth = await authenticateRequest(request, 'records:write');
  if (!auth.ok) return auth.response;
  const uid = new URL(request.url).searchParams.get('id');
  if (!uid) return Response.json({ error: 'Stable task ID is required.' }, { status: 400 });
  const result = await auth.db.prepare('DELETE FROM tasks WHERE uid=? AND workspace_id=?').bind(uid, auth.session.workspace.id).run();
  if (!result.meta.changes) return Response.json({ error: 'Task not found.' }, { status: 404 });
  return Response.json({ deleted: uid });
}
