import { inviteLink, parseCustomRole, parseWorkspaceSettings, type CustomRole, type WorkspaceSettings } from '@/lib/team';
import type { WorkspaceRole } from '@/lib/permissions';

export async function loadWorkspaceSettings(db: D1Database, workspaceId: string): Promise<WorkspaceSettings> {
  return parseWorkspaceSettings(await db.prepare('SELECT * FROM workspace_settings WHERE workspace_id=?').bind(workspaceId).first<Record<string, unknown>>());
}

export async function saveWorkspaceSettings(db: D1Database, workspaceId: string, settings: WorkspaceSettings) {
  await db.prepare(`INSERT INTO workspace_settings (workspace_id,default_role,sender_name,email_message,allowed_domains_json,admins_can_invite,role_permissions_json,customization_json,updated_at) VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(workspace_id) DO UPDATE SET default_role=excluded.default_role,sender_name=excluded.sender_name,email_message=excluded.email_message,allowed_domains_json=excluded.allowed_domains_json,admins_can_invite=excluded.admins_can_invite,role_permissions_json=excluded.role_permissions_json,customization_json=excluded.customization_json,updated_at=CURRENT_TIMESTAMP`)
    .bind(workspaceId, settings.defaultRole, settings.senderName, settings.emailMessage, JSON.stringify(settings.allowedDomains), settings.adminsCanInvite ? 1 : 0, JSON.stringify(settings.rolePermissions), JSON.stringify(settings.customization)).run();
}

export async function loadCustomRoles(db: D1Database, workspaceId: string): Promise<CustomRole[]> {
  const rows = await db.prepare('SELECT * FROM workspace_custom_roles WHERE workspace_id=? ORDER BY name').bind(workspaceId).all<Record<string, unknown>>();
  return rows.results.map(parseCustomRole);
}

export async function loadAccess(db: D1Database, workspaceId: string, userId: string) {
  const [settingsRows, roleRows] = await db.batch<Record<string, unknown>>([
    db.prepare('SELECT * FROM workspace_settings WHERE workspace_id=?').bind(workspaceId),
    db.prepare('SELECT r.* FROM workspace_custom_roles r JOIN workspace_memberships m ON m.custom_role_id=r.id WHERE m.workspace_id=? AND m.user_id=?').bind(workspaceId, userId),
  ]);
  const role = roleRows.results[0];
  return { settings: parseWorkspaceSettings(settingsRows.results[0]), customRole: role ? parseCustomRole(role) : null };
}

const openLeads = "archived=0 AND status NOT IN ('Won','Lost')";
const openOpportunities = "archived=0 AND stage NOT IN ('Won','Lost')";

export async function openRecordCounts(db: D1Database, workspaceId: string, owner: string) {
  const row = await db.prepare(`SELECT
    (SELECT COUNT(*) FROM leads WHERE workspace_id=?1 AND owner=?2 AND ${openLeads}) leads,
    (SELECT COUNT(*) FROM tasks WHERE workspace_id=?1 AND owner=?2 AND status!='Completed') tasks,
    (SELECT COUNT(*) FROM opportunities WHERE workspace_id=?1 AND owner=?2 AND ${openOpportunities}) opportunities`).bind(workspaceId, owner).first<{ leads: number; tasks: number; opportunities: number }>();
  const counts = { leads: Number(row?.leads || 0), tasks: Number(row?.tasks || 0), opportunities: Number(row?.opportunities || 0) };
  return { ...counts, total: counts.leads + counts.tasks + counts.opportunities };
}

/** Owners are stored as display names, so handing work over means rewriting those names on open records. */
export function transferOpenRecords(db: D1Database, workspaceId: string, from: string, to: string) {
  return [
    db.prepare(`UPDATE leads SET owner=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE workspace_id=? AND owner=? AND ${openLeads}`).bind(to, workspaceId, from),
    db.prepare("UPDATE tasks SET owner=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE workspace_id=? AND owner=? AND status!='Completed'").bind(to, workspaceId, from),
    db.prepare(`UPDATE opportunities SET owner=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE workspace_id=? AND owner=? AND ${openOpportunities}`).bind(to, workspaceId, from),
    db.prepare('UPDATE companies SET owner=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE workspace_id=? AND owner=? AND archived=0').bind(to, workspaceId, from),
  ];
}

type MemberRow = { id: string; email: string; name: string; avatar_url: string | null; joined_at: string | null; role: WorkspaceRole; status: string; last_seen_at: string | null; custom_role_id: string | null; custom_role_name: string | null; suspended: number; in_sales: number | null };
type InviteRow = { id: string; email: string; name: string; role: WorkspaceRole; expires_at: string; custom_role_id: string | null; custom_role_name: string | null; delivery: string; last_sent_at: string | null; note: string };

export async function listMembers(db: D1Database, workspaceId: string, origin: string, includeLinks: boolean) {
  await db.prepare("UPDATE workspace_invitations SET status='expired',updated_at=CURRENT_TIMESTAMP WHERE workspace_id=? AND status='pending' AND expires_at<CURRENT_TIMESTAMP").bind(workspaceId).run();
  const [active, pending] = await db.batch([
    db.prepare(`SELECT u.id,u.email,u.name,u.avatar_url,u.status,u.last_seen_at,m.role,m.custom_role_id,m.suspended,m.in_sales,m.created_at joined_at,r.name custom_role_name FROM workspace_memberships m JOIN users u ON u.id=m.user_id LEFT JOIN workspace_custom_roles r ON r.id=m.custom_role_id WHERE m.workspace_id=? ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END,u.name`).bind(workspaceId),
    db.prepare(`SELECT i.id,i.email,i.name,i.role,i.expires_at,i.custom_role_id,i.delivery,i.last_sent_at,i.note,r.name custom_role_name FROM workspace_invitations i LEFT JOIN workspace_custom_roles r ON r.id=i.custom_role_id WHERE i.workspace_id=? AND i.status='pending' ORDER BY i.created_at DESC`).bind(workspaceId),
  ]);
  return [
    ...(active.results as MemberRow[]).map(row => ({ id: row.id, email: row.email, name: row.name, avatarUrl: row.avatar_url || undefined, joinedAt: row.joined_at || undefined, role: row.role, status: row.suspended ? 'disabled' : row.status, pending: false, lastSeenAt: row.last_seen_at || undefined, inSales: row.in_sales !== 0, customRoleId: row.custom_role_id || undefined, customRoleName: row.custom_role_name || undefined })),
    ...(pending.results as InviteRow[]).map(row => ({ id: `invite:${row.id}`, invitationId: row.id, email: row.email, name: row.name, role: row.role, status: 'invited', pending: true, expiresAt: row.expires_at, customRoleId: row.custom_role_id || undefined, customRoleName: row.custom_role_name || undefined, delivery: row.delivery, lastSentAt: row.last_sent_at || undefined, note: row.note || undefined, inviteUrl: includeLinks ? inviteLink(origin, row.id) : undefined })),
  ];
}

export async function invitationSummary(db: D1Database, id: string) {
  await db.prepare("UPDATE workspace_invitations SET status='expired',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending' AND expires_at<CURRENT_TIMESTAMP").bind(id).run();
  return db.prepare(`SELECT i.workspace_id,i.email,i.status,i.role,i.note,w.name workspace_name,u.name inviter_name,r.name custom_role_name FROM workspace_invitations i JOIN workspaces w ON w.id=i.workspace_id LEFT JOIN users u ON u.id=i.invited_by LEFT JOIN workspace_custom_roles r ON r.id=i.custom_role_id WHERE i.id=?`)
    .bind(id).first<{ workspace_id: string; email: string; status: string; role: string; note: string; workspace_name: string; inviter_name: string | null; custom_role_name: string | null }>();
}
