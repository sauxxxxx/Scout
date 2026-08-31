import { activityDb } from '@/lib/activity-store';
import { ensureFoundationSchema } from '@/lib/foundation-store';

export type StoredLead={id:string;version:number;companyId?:string;primaryContactId?:string;name:string;industry:string;city:string;status:string;score:number;owner:string;last:string;next:string;phone:string;email:string;contact:string;priority:string;opportunity:string;value?:number;probability?:number;closeDate?:string;archived?:boolean};
export type StoredTask={uid:string;id:number;version:number;title:string;lead:string;leadId?:string;companyId?:string;contactId?:string;opportunityId?:string;owner:string;priority:string;due:string;time:string;type:string;notes:string;status:string;reminder?:string;recurrence?:string;outcome?:string};

export function workspaceDb(){return activityDb()}

export async function ensureWorkspaceSchema(db:D1Database){
  await ensureFoundationSchema(db);
}

export function mapLead(row:Record<string,unknown>):StoredLead{return {id:String(row.id),version:Number(row.version||1),companyId:row.company_id?String(row.company_id):undefined,primaryContactId:row.primary_contact_id?String(row.primary_contact_id):undefined,name:String(row.company_name||row.name),industry:String(row.company_industry||row.industry),city:String(row.company_city||row.city),status:String(row.status),score:Number(row.score),owner:String(row.owner),last:String(row.last),next:String(row.next),phone:String(row.primary_contact_phone||row.company_phone||row.phone),email:String(row.primary_contact_email||row.company_email||row.email),contact:String(row.primary_contact_name||row.contact),priority:String(row.priority),opportunity:String(row.opportunity),value:row.value==null?undefined:Number(row.value),probability:row.probability==null?undefined:Number(row.probability),closeDate:row.close_date?String(row.close_date):undefined,archived:Boolean(row.archived)}}
export function mapTask(row:Record<string,unknown>):StoredTask{return {uid:String(row.uid),id:Number(row.id),version:Number(row.version||1),title:String(row.title),lead:String(row.lead),leadId:row.lead_id?String(row.lead_id):undefined,companyId:row.company_id?String(row.company_id):undefined,contactId:row.contact_id?String(row.contact_id):undefined,opportunityId:row.opportunity_id?String(row.opportunity_id):undefined,owner:String(row.owner),priority:String(row.priority),due:String(row.due),time:String(row.time),type:String(row.type),notes:String(row.notes),status:String(row.status),reminder:row.reminder?String(row.reminder):undefined,recurrence:row.recurrence?String(row.recurrence):undefined,outcome:row.outcome?String(row.outcome):undefined}}
