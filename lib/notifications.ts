import { notificationDefaults, parseObject } from '@/lib/profile';

type Actor = { db: D1Database; session: { user: { name: string }; workspace: { id: string } } };
type Preference = 'leadAssignments' | 'opportunityChanges';

/** Owners are display names, so the recipient is found through workspace membership. Nothing is sent for your own changes. */
export async function notifyMember(actor: Actor, ownerName: string | null | undefined, preference: Preference, title: string, body: string, link: string) {
  if (!ownerName || ownerName === actor.session.user.name) return;
  try {
    const member = await actor.db.prepare('SELECT u.id,u.notifications_json FROM users u JOIN workspace_memberships m ON m.user_id=u.id WHERE m.workspace_id=? AND u.name=? LIMIT 1').bind(actor.session.workspace.id, ownerName).first<{ id: string; notifications_json: string }>();
    if (!member || !parseObject(member.notifications_json, notificationDefaults)[preference]) return;
    await actor.db.prepare('INSERT INTO notifications (id,workspace_id,user_id,title,body,link) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(), actor.session.workspace.id, member.id, title.slice(0, 160), body.slice(0, 240), link).run();
  } catch (error) {
    console.error(JSON.stringify({ event: 'notification_failed', message: error instanceof Error ? error.message : 'unknown' }));
  }
}

export async function listNotifications(db: D1Database, workspaceId: string, userId: string) {
  const rows = await db.prepare('SELECT id,title,body,link,read_at,created_at FROM notifications WHERE workspace_id=? AND user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 30').bind(workspaceId, userId).all<{ id: string; title: string; body: string; link: string; read_at: string | null; created_at: string }>();
  return rows.results.map(row => ({ id: row.id, title: row.title, body: row.body, link: row.link, read: Boolean(row.read_at), createdAt: row.created_at }));
}
