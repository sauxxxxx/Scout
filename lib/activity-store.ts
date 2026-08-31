import { env } from 'cloudflare:workers';
import { createActivitiesLeadIndex, createActivitiesStatusIndex, createActivitiesTable } from '@/db/schema';

export type StoredActivity = {
  id:number; lead:string; type:string; detail:string; time:string; owner:string;
  status?:'Completed'|'Scheduled'; occurredAt?:string; outcome?:string; duration?:string;
  subject?:string; value?:string; documentLink?:string; attachmentKey?:string;
  attachmentName?:string; relatedTaskId?:number; opportunity?:string; deletedAt?:string;
};

type ActivityRow = {
  id:number; lead:string; type:string; detail:string; time:string; owner:string; status:string;
  occurred_at:string|null; outcome:string|null; duration:string|null; subject:string|null;
  value:string|null; document_link:string|null; attachment_key:string|null;
  attachment_name:string|null; related_task_id:number|null; opportunity:string|null; deleted_at:string|null;
};

export function activityDb(){ return (env as unknown as {DB:D1Database}).DB; }
export function activityFiles(){ return (env as unknown as {FILES:R2Bucket}).FILES; }

export async function ensureActivitySchema(db:D1Database){
  await db.batch([
    db.prepare(createActivitiesTable),
    db.prepare(createActivitiesStatusIndex),
    db.prepare(createActivitiesLeadIndex),
  ]);
}

export function mapActivity(row:ActivityRow):StoredActivity{
  return {id:row.id,lead:row.lead,type:row.type,detail:row.detail,time:row.time,owner:row.owner,status:(row.status||'Completed') as StoredActivity['status'],occurredAt:row.occurred_at||undefined,outcome:row.outcome||undefined,duration:row.duration||undefined,subject:row.subject||undefined,value:row.value||undefined,documentLink:row.document_link||undefined,attachmentKey:row.attachment_key||undefined,attachmentName:row.attachment_name||undefined,relatedTaskId:row.related_task_id??undefined,opportunity:row.opportunity||undefined,deletedAt:row.deleted_at||undefined};
}
