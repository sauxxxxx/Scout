type Actor = { db: D1Database; session: { user: { id: string; name: string }; workspace: { id: string } } };

export const auditLabels: Record<string, string> = {
  'invite.sent': 'Invited',
  'invite.resent': 'Resent invite to',
  'invite.revoked': 'Revoked invite for',
  'invite.accepted': 'Joined the workspace',
  'member.role_changed': 'Changed role for',
  'member.removed': 'Removed',
  'member.suspended': 'Suspended',
  'member.reactivated': 'Reactivated',
  'settings.updated': 'Updated workspace settings',
  'role.created': 'Created role',
  'role.updated': 'Updated role',
  'role.deleted': 'Deleted role',
  'lead.deleted': 'Deleted lead',
  'lead.exported': 'Exported leads',
  'task.deleted': 'Deleted task',
  'activity.deleted': 'Permanently deleted activity',
  'opportunity.deleted': 'Deleted opportunity',
  'company.deleted': 'Deleted company',
  'contact.deleted': 'Deleted contact',
  'search.deleted': 'Deleted Finder search',
};

/** A failed log line must never fail the action it describes, so problems here are reported, not thrown. */
export async function recordAudit(actor: Actor, action: keyof typeof auditLabels | string, target = '', detail = '') {
  try {
    await actor.db.prepare('INSERT INTO workspace_audit_log (id,workspace_id,actor_id,actor_name,action,target,detail) VALUES (?,?,?,?,?,?,?)')
      .bind(crypto.randomUUID(), actor.session.workspace.id, actor.session.user.id, actor.session.user.name, action, target.slice(0, 200), detail.slice(0, 300)).run();
  } catch (error) {
    console.error(JSON.stringify({ event: 'audit_write_failed', action, message: error instanceof Error ? error.message : 'unknown' }));
  }
}

export async function listAudit(db: D1Database, workspaceId: string, limit = 200) {
  const rows = await db.prepare('SELECT id,actor_name,action,target,detail,created_at FROM workspace_audit_log WHERE workspace_id=? ORDER BY created_at DESC,rowid DESC LIMIT ?').bind(workspaceId, limit).all<{ id: string; actor_name: string; action: string; target: string; detail: string; created_at: string }>();
  return rows.results.map(row => ({ id: row.id, actor: row.actor_name, action: auditLabels[row.action] || row.action, target: row.target, detail: row.detail, createdAt: row.created_at }));
}
