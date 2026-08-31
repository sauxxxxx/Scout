import { NextResponse } from 'next/server';
import { activityDb, activityFiles, ensureActivitySchema, mapActivity, type StoredActivity } from '@/lib/activity-store';

export const dynamic = 'force-dynamic';

export async function GET(request:Request){
  const db=activityDb(); await ensureActivitySchema(db);
  const expired=await db.prepare("SELECT attachment_key FROM activities WHERE deleted_at IS NOT NULL AND deleted_at < datetime('now','-30 days') AND attachment_key IS NOT NULL").all<{attachment_key:string}>();
  await Promise.all(expired.results.map(row=>activityFiles().delete(row.attachment_key)));
  await db.prepare("DELETE FROM activities WHERE deleted_at IS NOT NULL AND deleted_at < datetime('now','-30 days')").run();
  const params=new URL(request.url).searchParams;const all=params.get('all')==='1';const page=Math.max(1,Number(params.get('page'))||1);const pageSize=Math.min(50,Math.max(1,Number(params.get('pageSize'))||6));
  const clauses:string[]=[];const values:(string|number)[]=[];const scope=params.get('scope')||'Completed';
  if(!all){if(scope==='Deleted')clauses.push('deleted_at IS NOT NULL');else if(scope==='Scheduled')clauses.push("deleted_at IS NULL AND status = 'Scheduled'");else clauses.push("deleted_at IS NULL AND status != 'Scheduled'")}
  const exact=(key:string,column:string,empty:string)=>{const value=params.get(key);if(value&&value!==empty){clauses.push(`${column} = ?`);values.push(value)}};
  exact('type','type','All activity');exact('owner','owner','Entire team');exact('lead','lead','All leads');
  const query=params.get('query')?.trim();if(query){clauses.push("LOWER(lead || ' ' || detail || ' ' || COALESCE(subject,'') || ' ' || COALESCE(outcome,'')) LIKE ?");values.push(`%${query.toLowerCase()}%`)}
  const period=params.get('period');const from=params.get('from');const to=params.get('to');
  if(period==='Today')clauses.push("date(occurred_at)=date('now','localtime')");
  if(period==='This week')clauses.push("date(occurred_at) BETWEEN date('now','localtime',printf('-%d days',(CAST(strftime('%w','now','localtime') AS INTEGER)+6)%7)) AND date('now','localtime',printf('+%d days',6-((CAST(strftime('%w','now','localtime') AS INTEGER)+6)%7)))");
  if(period==='This month')clauses.push("strftime('%Y-%m',occurred_at)=strftime('%Y-%m','now','localtime')");
  if(period==='Custom range'&&from){clauses.push('date(occurred_at)>=date(?)');values.push(from)}if(period==='Custom range'&&to){clauses.push('date(occurred_at)<=date(?)');values.push(to)}
  const where=clauses.length?`WHERE ${clauses.join(' AND ')}`:'';const count=await db.prepare(`SELECT COUNT(*) total FROM activities ${where}`).bind(...values).first<{total:number}>();
  const sql=`SELECT * FROM activities ${where} ORDER BY COALESCE(occurred_at, created_at) ${scope==='Scheduled'?'ASC':'DESC'}, id DESC${all?'':' LIMIT ? OFFSET ?'}`;const queryValues=all?values:[...values,pageSize,(page-1)*pageSize];const result=await db.prepare(sql).bind(...queryValues).all();
  return NextResponse.json({activities:(result.results as unknown as Parameters<typeof mapActivity>[0][]).map(mapActivity),total:Number(count?.total||0),page,pageSize});
}

export async function PUT(request:Request){
  const payload=await request.json() as {activities?:StoredActivity[]}; const activities=Array.isArray(payload.activities)?payload.activities:[];
  const db=activityDb(); await ensureActivitySchema(db);
  if(activities.length){
    const statement=`INSERT INTO activities (id,lead,type,detail,time,owner,status,occurred_at,outcome,duration,subject,value,document_link,attachment_key,attachment_name,related_task_id,opportunity,deleted_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET lead=excluded.lead,type=excluded.type,detail=excluded.detail,time=excluded.time,owner=excluded.owner,status=excluded.status,occurred_at=excluded.occurred_at,outcome=excluded.outcome,duration=excluded.duration,subject=excluded.subject,value=excluded.value,document_link=excluded.document_link,attachment_key=excluded.attachment_key,attachment_name=excluded.attachment_name,related_task_id=excluded.related_task_id,opportunity=excluded.opportunity,deleted_at=excluded.deleted_at,updated_at=CURRENT_TIMESTAMP`;
    await db.batch(activities.map(activity=>db.prepare(statement).bind(activity.id,activity.lead,activity.type,activity.detail,activity.time,activity.owner,activity.status||'Completed',activity.occurredAt||null,activity.outcome||null,activity.duration||null,activity.subject||null,activity.value||null,activity.documentLink||null,activity.attachmentKey||null,activity.attachmentName||null,activity.relatedTaskId||null,activity.opportunity||null,activity.deletedAt||null)));
  }
  return NextResponse.json({saved:activities.length});
}

export async function DELETE(request:Request){
  const params=new URL(request.url).searchParams;const id=Number(params.get('id'));if(!Number.isFinite(id))return NextResponse.json({error:'A valid activity id is required.'},{status:400});
  const db=activityDb();await ensureActivitySchema(db);const row=await db.prepare('SELECT attachment_key FROM activities WHERE id=?').bind(id).first<{attachment_key:string|null}>();
  if(row?.attachment_key)await activityFiles().delete(row.attachment_key);
  await db.prepare('DELETE FROM activities WHERE id=?').bind(id).run();return NextResponse.json({deleted:id});
}
