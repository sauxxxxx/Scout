import { touchActivityTypes, touchTypesSql } from '@/lib/last-touch';

/** The details a person can see. Links Scout fills in behind the scenes are left out, so tidying a record never counts as updating it. */
export const leadDetails = ['name', 'industry', 'city', 'status', 'score', 'owner', 'next', 'phone', 'email', 'contact', 'priority', 'opportunity', 'value', 'probability', 'closeDate', 'archived'];
export const activityDetails = ['type', 'detail', 'status', 'occurred_at', 'outcome', 'duration', 'subject', 'value', 'document_link', 'attachment_key', 'owner', 'deleted_at'];
export const taskDetails = ['title', 'owner', 'priority', 'due_at', 'type', 'notes', 'status', 'reminder', 'recurrence', 'outcome'];
// Stage and probability are left out: a real deal move also changes the lead, and on load Scout lines them up with the lead by itself.
export const opportunityDetails = ['name', 'value', 'close_date', 'owner', 'priority', 'outcome', 'archived'];
export const contactDetails = ['name', 'title', 'email', 'phone', 'is_primary', 'archived'];
export const companyDetails = ['name', 'industry', 'city', 'phone', 'email', 'website', 'facebook_url', 'facebook_status', 'owner', 'archived'];

type Row = Record<string, unknown> | null | undefined;
export const detailsChanged = (before: Row, after: Row, details: string[]) => details.some(name => String(before?.[name] ?? '') !== String(after?.[name] ?? ''));

/**
 * Moves a lead to the top of the Leads table. Only real changes call this, and the version stays the same, otherwise a
 * rep with the lead open would get a false "changed by someone else" conflict from their own note.
 */
export async function markLeadChanged(db: D1Database, workspaceId: string, leadId: string) {
  await db.prepare('UPDATE leads SET changed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?').bind(leadId, workspaceId).run();
}

export async function markCompanyLeadsChanged(db: D1Database, workspaceId: string, companyId: string) {
  await db.prepare('UPDATE leads SET changed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE company_id=? AND workspace_id=?').bind(companyId, workspaceId).run();
}

/** Recalculated rather than set, so editing or deleting an activity corrects the date. */
export async function refreshLeadTouch(db: D1Database, workspaceId: string, leadId: string, type: string) {
  if (!touchActivityTypes.includes(type.toLowerCase())) return;
  const latest = `(SELECT MAX(a.occurred_at) FROM activities a WHERE a.workspace_id=?1 AND a.lead_id=?2 AND a.deleted_at IS NULL
    AND COALESCE(a.status,'Completed')='Completed' AND LOWER(a.type) IN (${touchTypesSql}))`;
  await db.prepare(`UPDATE leads SET last_touch_at=${latest},updated_at=CURRENT_TIMESTAMP WHERE id=?2 AND workspace_id=?1 AND COALESCE(last_touch_at,'')<>COALESCE(${latest},'')`).bind(workspaceId, leadId).run();
}

/** The old owner loses sight of the lead, so its open deal, their open tasks and the company go with it. */
export async function handOverLead(db: D1Database, workspaceId: string, leadId: string, from: string, to: string) {
  await db.batch([
    db.prepare("UPDATE opportunities SET owner=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE workspace_id=? AND lead_id=? AND owner=? AND archived=0 AND stage NOT IN ('Won','Lost')").bind(to, workspaceId, leadId, from),
    db.prepare("UPDATE tasks SET owner=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE workspace_id=? AND lead_id=? AND owner=? AND status!='Completed'").bind(to, workspaceId, leadId, from),
    db.prepare('UPDATE companies SET owner=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE workspace_id=? AND owner=? AND id=(SELECT company_id FROM leads WHERE id=? AND workspace_id=?)').bind(to, workspaceId, from, leadId, workspaceId),
  ]);
}
