import type { WorkspacePermission, WorkspaceRole } from '@/lib/permissions';
import { hasPermission } from '@/lib/permissions';
import { DEFAULT_WORKSPACE_ID, ensureFoundationSchema } from '@/lib/foundation-store';
import { workspaceDb } from '@/lib/workspace-store';

export type ScoutSession = {
  user: { id: string; email: string; name: string; avatarUrl?: string };
  workspace: { id: string; name: string };
  role: WorkspaceRole;
  localDevelopment: boolean;
};

type Identity = { id: string; email: string; name: string; avatarUrl?: string; localDevelopment: boolean };
type AuthResult = { ok: true; session: ScoutSession; db: D1Database } | { ok: false; response: Response };

function decodedHeader(request: Request, name: string) {
  const value = request.headers.get(name);
  if (!value) return undefined;
  try { return decodeURIComponent(value); } catch { return value; }
}

function requestIdentity(request: Request): Identity | null {
  const id = request.headers.get('oai-authenticated-user-id');
  const email = request.headers.get('oai-authenticated-user-email');
  if (id && email) {
    const name = decodedHeader(request, 'oai-authenticated-user-name') || decodedHeader(request, 'oai-authenticated-user-full-name') || email.split('@')[0];
    return { id, email: email.toLowerCase(), name, avatarUrl: request.headers.get('oai-authenticated-user-avatar-url') || undefined, localDevelopment: false };
  }
  const hostname = new URL(request.url).hostname;
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return { id: 'local:sauxxxxx', email: 'sauxxxxx@local.scout', name: 'sauxxxxx', localDevelopment: true };
  }
  return null;
}

export async function authenticateRequest(request: Request, permission: WorkspacePermission = 'records:read'): Promise<AuthResult> {
  const identity = requestIdentity(request);
  if (!identity) {
    return { ok: false, response: Response.json({ error: 'Authentication required.', signInPath: '/signin-with-chatgpt?return_to=/' }, { status: 401 }) };
  }

  const db = workspaceDb();
  await ensureFoundationSchema(db);
  const emailUser = await db.prepare('SELECT id FROM users WHERE lower(email)=lower(?)').bind(identity.email).first<{ id: string }>();
  if (emailUser && emailUser.id !== identity.id) {
    if (!emailUser.id.startsWith('invite:')) return { ok: false, response: Response.json({ error: 'This email is already connected to another Scout identity.' }, { status: 409 }) };
    const invitedMembership = await db.prepare('SELECT role FROM workspace_memberships WHERE workspace_id=? AND user_id=?').bind(DEFAULT_WORKSPACE_ID, emailUser.id).first<{ role: WorkspaceRole }>();
    await db.batch([
      db.prepare('DELETE FROM workspace_memberships WHERE workspace_id=? AND user_id=?').bind(DEFAULT_WORKSPACE_ID, emailUser.id),
      db.prepare('DELETE FROM users WHERE id=?').bind(emailUser.id),
      db.prepare('INSERT INTO users (id,email,name,avatar_url,updated_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP)').bind(identity.id, identity.email, identity.name, identity.avatarUrl || null),
      ...(invitedMembership ? [db.prepare('INSERT INTO workspace_memberships (workspace_id,user_id,role,updated_at) VALUES (?,?,?,CURRENT_TIMESTAMP)').bind(DEFAULT_WORKSPACE_ID, identity.id, invitedMembership.role)] : []),
    ]);
  }
  await db.prepare(`INSERT INTO users (id,email,name,avatar_url,updated_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET email=excluded.email,name=excluded.name,avatar_url=excluded.avatar_url,updated_at=CURRENT_TIMESTAMP`)
    .bind(identity.id, identity.email, identity.name, identity.avatarUrl || null).run();

  let membership = await db.prepare(`SELECT m.role,w.name workspace_name FROM workspace_memberships m JOIN workspaces w ON w.id=m.workspace_id WHERE m.workspace_id=? AND m.user_id=?`)
    .bind(DEFAULT_WORKSPACE_ID, identity.id).first<{ role: WorkspaceRole; workspace_name: string }>();

  if (!membership) {
    const invited = await db.prepare(`SELECT m.user_id,m.role FROM workspace_memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? AND lower(u.email)=lower(?)`)
      .bind(DEFAULT_WORKSPACE_ID, identity.email).first<{ user_id: string; role: WorkspaceRole }>();
    if (invited) {
      await db.batch([
        db.prepare('DELETE FROM workspace_memberships WHERE workspace_id=? AND user_id=?').bind(DEFAULT_WORKSPACE_ID, invited.user_id),
        db.prepare('INSERT OR REPLACE INTO workspace_memberships (workspace_id,user_id,role,updated_at) VALUES (?,?,?,CURRENT_TIMESTAMP)').bind(DEFAULT_WORKSPACE_ID, identity.id, invited.role),
      ]);
      membership = { role: invited.role, workspace_name: 'Sales workspace' };
    }
  }

  if (!membership) {
    const count = await db.prepare('SELECT COUNT(*) total FROM workspace_memberships WHERE workspace_id=?').bind(DEFAULT_WORKSPACE_ID).first<{ total: number }>();
    if (Number(count?.total || 0) === 0) {
      await db.prepare("INSERT INTO workspace_memberships (workspace_id,user_id,role) VALUES (?,?,'owner')").bind(DEFAULT_WORKSPACE_ID, identity.id).run();
      membership = { role: 'owner', workspace_name: 'Sales workspace' };
    }
  }

  if (!membership) return { ok: false, response: Response.json({ error: 'You do not have access to this Scout workspace.' }, { status: 403 }) };
  if (!hasPermission(membership.role, permission)) return { ok: false, response: Response.json({ error: 'Your workspace role does not allow this action.' }, { status: 403 }) };

  return {
    ok: true,
    db,
    session: {
      user: { id: identity.id, email: identity.email, name: identity.name, avatarUrl: identity.avatarUrl },
      workspace: { id: DEFAULT_WORKSPACE_ID, name: membership.workspace_name },
      role: membership.role,
      localDevelopment: identity.localDevelopment,
    },
  };
}
