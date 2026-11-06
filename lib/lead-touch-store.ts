import { touchActivityTypes, touchTypesSql } from '@/lib/last-touch';

/**
 * Recalculated rather than set, so editing or deleting an activity corrects the date. The lead's version stays the same,
 * otherwise a rep with the lead open would get a false "changed by someone else" conflict from their own note.
 */
export async function refreshLeadTouch(db: D1Database, workspaceId: string, leadId: string, type: string) {
  if (!touchActivityTypes.includes(type.toLowerCase())) return;
  await db.prepare(`UPDATE leads SET last_touch_at=(SELECT MAX(a.occurred_at) FROM activities a WHERE a.workspace_id=?1 AND a.lead_id=?2 AND a.deleted_at IS NULL
    AND COALESCE(a.status,'Completed')='Completed' AND LOWER(a.type) IN (${touchTypesSql})),changed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?2 AND workspace_id=?1`).bind(workspaceId, leadId).run();
}

/** The old owner loses sight of the lead, so its open deal, their open tasks and the company go with it. */
export async function handOverLead(db: D1Database, workspaceId: string, leadId: string, from: string, to: string) {
  await db.batch([
    db.prepare("UPDATE opportunities SET owner=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE workspace_id=? AND lead_id=? AND owner=? AND archived=0 AND stage NOT IN ('Won','Lost')").bind(to, workspaceId, leadId, from),
    db.prepare("UPDATE tasks SET owner=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE workspace_id=? AND lead_id=? AND owner=? AND status!='Completed'").bind(to, workspaceId, leadId, from),
    db.prepare('UPDATE companies SET owner=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE workspace_id=? AND owner=? AND id=(SELECT company_id FROM leads WHERE id=? AND workspace_id=?)').bind(to, workspaceId, from, leadId, workspaceId),
  ]);
}
