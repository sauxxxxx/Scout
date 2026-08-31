import { NextResponse } from 'next/server';
import { activityDb, ensureActivitySchema, mapActivity, type StoredActivity } from '@/lib/activity-store';

export const dynamic = 'force-dynamic';

export async function GET(){
  const db=activityDb(); await ensureActivitySchema(db);
  const result=await db.prepare('SELECT * FROM activities ORDER BY COALESCE(occurred_at, created_at) DESC, id DESC').all();
  return NextResponse.json({activities:(result.results as unknown as Parameters<typeof mapActivity>[0][]).map(mapActivity)});
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
