import { ensureWorkspaceSchema, mapLead, mapTask, type StoredLead, type StoredTask, workspaceDb } from '@/lib/workspace-store';

export const dynamic='force-dynamic';

export async function GET(){
  const db=workspaceDb();await ensureWorkspaceSchema(db);
  const [leadRows,taskRows]=await db.batch([db.prepare('SELECT * FROM leads ORDER BY name'),db.prepare('SELECT * FROM tasks ORDER BY id DESC')]);
  return Response.json({leads:(leadRows.results as Record<string,unknown>[]).map(mapLead),tasks:(taskRows.results as Record<string,unknown>[]).map(mapTask)});
}

export async function PUT(request:Request){
  const payload=await request.json() as {leads?:StoredLead[];tasks?:StoredTask[]};const leads=Array.isArray(payload.leads)?payload.leads:[];const tasks=Array.isArray(payload.tasks)?payload.tasks:[];
  const db=workspaceDb();await ensureWorkspaceSchema(db);
  const statements:ReturnType<D1Database['prepare']>[]=[db.prepare('DELETE FROM leads'),db.prepare('DELETE FROM tasks')];
  const leadSql=`INSERT INTO leads (name,industry,city,status,score,owner,last,next,phone,email,contact,priority,opportunity,value,probability,close_date,archived,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(name) DO UPDATE SET industry=excluded.industry,city=excluded.city,status=excluded.status,score=excluded.score,owner=excluded.owner,last=excluded.last,next=excluded.next,phone=excluded.phone,email=excluded.email,contact=excluded.contact,priority=excluded.priority,opportunity=excluded.opportunity,value=excluded.value,probability=excluded.probability,close_date=excluded.close_date,archived=excluded.archived,updated_at=CURRENT_TIMESTAMP`;
  const taskSql=`INSERT INTO tasks (id,title,lead,owner,priority,due,time,type,notes,status,reminder,recurrence,outcome,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET title=excluded.title,lead=excluded.lead,owner=excluded.owner,priority=excluded.priority,due=excluded.due,time=excluded.time,type=excluded.type,notes=excluded.notes,status=excluded.status,reminder=excluded.reminder,recurrence=excluded.recurrence,outcome=excluded.outcome,updated_at=CURRENT_TIMESTAMP`;
  leads.forEach(lead=>statements.push(db.prepare(leadSql).bind(lead.name,lead.industry,lead.city,lead.status,lead.score,lead.owner,lead.last,lead.next,lead.phone,lead.email,lead.contact,lead.priority,lead.opportunity,lead.value??null,lead.probability??null,lead.closeDate??null,lead.archived?1:0)));
  tasks.forEach(task=>statements.push(db.prepare(taskSql).bind(task.id,task.title,task.lead,task.owner,task.priority,task.due,task.time,task.type,task.notes,task.status,task.reminder??null,task.recurrence??null,task.outcome??null)));
  if(statements.length)await db.batch(statements);
  return Response.json({saved:{leads:leads.length,tasks:tasks.length}});
}
