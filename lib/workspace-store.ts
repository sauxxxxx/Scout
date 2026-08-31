import { activityDb } from '@/lib/activity-store';
import { createLeadsTable, createTasksLeadStatusIndex, createTasksTable } from '@/db/schema';

export type StoredLead={name:string;industry:string;city:string;status:string;score:number;owner:string;last:string;next:string;phone:string;email:string;contact:string;priority:string;opportunity:string;value?:number;probability?:number;closeDate?:string;archived?:boolean};
export type StoredTask={id:number;title:string;lead:string;owner:string;priority:string;due:string;time:string;type:string;notes:string;status:string;reminder?:string;recurrence?:string;outcome?:string};

export function workspaceDb(){return activityDb()}

export async function ensureWorkspaceSchema(db:D1Database){
  await db.batch([db.prepare(createLeadsTable),db.prepare(createTasksTable),db.prepare(createTasksLeadStatusIndex)]);
}

export function mapLead(row:Record<string,unknown>):StoredLead{return {name:String(row.name),industry:String(row.industry),city:String(row.city),status:String(row.status),score:Number(row.score),owner:String(row.owner),last:String(row.last),next:String(row.next),phone:String(row.phone),email:String(row.email),contact:String(row.contact),priority:String(row.priority),opportunity:String(row.opportunity),value:row.value==null?undefined:Number(row.value),probability:row.probability==null?undefined:Number(row.probability),closeDate:row.close_date?String(row.close_date):undefined,archived:Boolean(row.archived)}}
export function mapTask(row:Record<string,unknown>):StoredTask{return {id:Number(row.id),title:String(row.title),lead:String(row.lead),owner:String(row.owner),priority:String(row.priority),due:String(row.due),time:String(row.time),type:String(row.type),notes:String(row.notes),status:String(row.status),reminder:row.reminder?String(row.reminder):undefined,recurrence:row.recurrence?String(row.recurrence):undefined,outcome:row.outcome?String(row.outcome):undefined}}
