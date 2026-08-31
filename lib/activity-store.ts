import { env } from 'cloudflare:workers';
import { ensureFoundationSchema } from '@/lib/foundation-store';

export type StoredActivity = {
  uid:string; id:number; version:number; lead:string; leadId?:string; companyId?:string; contactId?:string; opportunityId?:string; type:string; detail:string; time:string; owner:string;
  status?:'Completed'|'Scheduled'; occurredAt?:string; outcome?:string; duration?:string;
  subject?:string; value?:string; documentLink?:string; attachmentKey?:string;
  attachmentName?:string; relatedTaskId?:number; relatedTaskUid?:string; opportunity?:string; deletedAt?:string;
};

type ActivityRow = {
  uid:string; id:number; version:number; lead:string; lead_id:string|null; company_id:string|null;contact_id:string|null;opportunity_id:string|null; type:string; detail:string; time:string; owner:string; status:string;
  occurred_at:string|null; outcome:string|null; duration:string|null; subject:string|null;
  value:string|null; document_link:string|null; attachment_key:string|null;
  attachment_name:string|null; related_task_id:number|null; related_task_uid:string|null; opportunity:string|null; deleted_at:string|null;
};

export function activityDb(){ return (env as unknown as {DB:D1Database}).DB; }
export function activityFiles(){ return (env as unknown as {FILES:R2Bucket}).FILES; }

export async function ensureActivitySchema(db:D1Database){
  await ensureFoundationSchema(db);
}

export function mapActivity(row:ActivityRow):StoredActivity{
  return {uid:row.uid,id:row.id,version:Number(row.version||1),lead:row.lead,leadId:row.lead_id||undefined,companyId:row.company_id||undefined,contactId:row.contact_id||undefined,opportunityId:row.opportunity_id||undefined,type:row.type,detail:row.detail,time:row.time,owner:row.owner,status:(row.status||'Completed') as StoredActivity['status'],occurredAt:row.occurred_at||undefined,outcome:row.outcome||undefined,duration:row.duration||undefined,subject:row.subject||undefined,value:row.value||undefined,documentLink:row.document_link||undefined,attachmentKey:row.attachment_key||undefined,attachmentName:row.attachment_name||undefined,relatedTaskId:row.related_task_id??undefined,relatedTaskUid:row.related_task_uid||undefined,opportunity:row.opportunity||undefined,deletedAt:row.deleted_at||undefined};
}
