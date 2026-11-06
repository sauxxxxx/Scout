import type { CapabilitySet, WorkspacePermission, WorkspaceRole } from '@/lib/permissions';
import type { Customization } from '@/lib/customization';
import { canInviteMembers, permissionAllowed, resolveCapabilities } from '@/lib/permissions';
import { env } from 'cloudflare:workers';
import { recordAudit } from '@/lib/audit';
import { DEFAULT_WORKSPACE_ID, ensureFoundationSchema } from '@/lib/foundation-store';
import { cookieValue } from '@/lib/session-auth';
import { workspaceDb } from '@/lib/workspace-store';
import { sessionIdentity } from '@/lib/session-auth';
import { loadAccess, transferOpenRecords } from '@/lib/team-store';

export type ScoutSession = {
  user: { id: string; email: string; name: string; avatarUrl?: string };
  workspace: { id: string; name: string };
  workspaces: { id: string; name: string; role: WorkspaceRole }[];
  timezone: string;
  role: WorkspaceRole;
  customRole?: { id: string; name: string };
  capabilities: CapabilitySet;
  canInvite: boolean;
  customization: Customization;
  localDevelopment: boolean;
};

type Identity = { id: string; email: string; name: string; avatarUrl?: string; localDevelopment: boolean };
type AuthResult = { ok: true; session: ScoutSession; db: D1Database } | { ok: false; response: Response };

function decodedHeader(request: Request, name: string) {
  const value = request.headers.get(name);
  if (!value) return undefined;
  try { return decodeURIComponent(value); } catch { return value; }
}

export const SCOUT_WORKSPACE_COOKIE = 'scout_workspace';

async function loadMemberships(db: D1Database, userId: string) {
  const rows = await db.prepare('SELECT w.id,w.name,m.role FROM workspace_memberships m JOIN workspaces w ON w.id=m.workspace_id WHERE m.user_id=? AND m.suspended=0 ORDER BY m.created_at,w.name').bind(userId).all<{ id: string; name: string; role: WorkspaceRole }>();
  return rows.results;
}

/** Runs on every request, so an invite to a second workspace works for someone already signed in elsewhere. */
async function acceptPendingInvites(db: D1Database, identity: Identity, name: string) {
  const invites = await db.prepare(`SELECT id,workspace_id,role,custom_role_id,landing_page,handoff_owner FROM workspace_invitations WHERE lower(email)=lower(?) AND status='pending' AND expires_at>=CURRENT_TIMESTAMP`)
    .bind(identity.email).all<{ id: string; workspace_id: string; role: WorkspaceRole; custom_role_id: string | null; landing_page: string; handoff_owner: string }>();
  for (const invited of invites.results) {
    const clash = await db.prepare('SELECT u.id FROM users u JOIN workspace_memberships m ON m.user_id=u.id WHERE m.workspace_id=? AND u.name=? AND u.id!=?').bind(invited.workspace_id, name, identity.id).first();
    // Records are owned by display name, so two teammates must never share one.
    const memberName = clash ? `${name} (${identity.email.split('@')[0]})` : name;
    await db.batch([
      db.prepare('INSERT OR REPLACE INTO workspace_memberships (workspace_id,user_id,role,custom_role_id,updated_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP)').bind(invited.workspace_id, identity.id, invited.role, invited.custom_role_id),
      db.prepare("UPDATE workspace_invitations SET status='accepted',accepted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(invited.id),
      ...(memberName !== name ? [db.prepare('UPDATE users SET name=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(memberName, identity.id)] : []),
      ...(invited.landing_page ? [db.prepare("UPDATE users SET preferences_json=json_set(COALESCE(NULLIF(preferences_json,''),'{}'),'$.landingPage',?) WHERE id=?").bind(invited.landing_page, identity.id)] : []),
      ...(invited.handoff_owner ? transferOpenRecords(db, invited.workspace_id, invited.handoff_owner, memberName) : []),
    ]);
    await recordAudit({ db, session: { user: { id: identity.id, name: memberName }, workspace: { id: invited.workspace_id } } }, 'invite.accepted', identity.email);
  }
}

async function requestIdentity(request: Request, db: D1Database): Promise<Identity | null> {
  const session = await sessionIdentity(request, db);
  if (session) return session;
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
  const db = workspaceDb();
  await ensureFoundationSchema(db);
  const identity = await requestIdentity(request, db);
  if (!identity) {
    const provider = request.headers.get('x-scout-auth-provider');
    const cloudflareAccess = provider === 'cloudflare-access';
    return {
      ok: false,
      response: Response.json(
        cloudflareAccess
          ? { error: 'Scout access is not enabled yet. Ask the workspace owner to finish Cloudflare Access setup.', signInPath: null }
          : provider === 'openai-sites'
            ? { error: 'Authentication required.', signInPath: '/signin-with-chatgpt?return_to=/' }
            : { error: 'Authentication required.', signInPath: null },
        { status: 401 },
      ),
    };
  }

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
  await db.prepare(`INSERT INTO users (id,email,name,avatar_url,status,last_seen_at,updated_at) VALUES (?,?,?,?, 'active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET email=excluded.email,last_seen_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP`)
    .bind(identity.id, identity.email, identity.name, identity.avatarUrl || null).run();

  const account = await db.prepare('SELECT status,name,avatar_url,timezone FROM users WHERE id=?').bind(identity.id).first<{ status: string; name: string; avatar_url: string | null; timezone: string }>();
  if (account?.status === 'disabled') return { ok: false, response: Response.json({ error: 'This Scout account has been disabled.' }, { status: 403 }) };

  await acceptPendingInvites(db, identity, account?.name || identity.name);

  let memberships = await loadMemberships(db, identity.id);
  if (!memberships.length) {
    const count = await db.prepare('SELECT COUNT(*) total FROM workspace_memberships').first<{ total: number }>();
    const firstOwner = (env as unknown as { SCOUT_OWNER_EMAIL?: string }).SCOUT_OWNER_EMAIL?.trim().toLowerCase();
    if (Number(count?.total || 0) === 0 && (identity.localDevelopment || firstOwner === identity.email.toLowerCase())) {
      await db.prepare("INSERT INTO workspace_memberships (workspace_id,user_id,role) VALUES (?,?,'owner')").bind(DEFAULT_WORKSPACE_ID, identity.id).run();
      memberships = await loadMemberships(db, identity.id);
    }
  }

  const chosen = cookieValue(request, SCOUT_WORKSPACE_COOKIE);
  const membership = memberships.find(item => item.id === chosen) || memberships[0];
  if (!membership) return { ok: false, response: Response.json({ error: 'You do not have access to this Scout workspace.' }, { status: 403 }) };
  const { settings, customRole } = await loadAccess(db, membership.id, identity.id);
  const capabilities = resolveCapabilities(membership.role, settings.rolePermissions, customRole?.capabilities);
  const canInvite = canInviteMembers(membership.role, settings.adminsCanInvite);
  if (!permissionAllowed({ role: membership.role, capabilities, canInvite }, permission)) return { ok: false, response: Response.json({ error: 'Your workspace role does not allow this action.' }, { status: 403 }) };

  return {
    ok: true,
    db,
    session: {
      user: { id: identity.id, email: identity.email, name: account?.name || identity.name, avatarUrl: account?.avatar_url || undefined },
      workspace: { id: membership.id, name: membership.name },
      workspaces: memberships,
      timezone: account?.timezone || 'Asia/Manila',
      role: membership.role,
      customRole: customRole ? { id: customRole.id, name: customRole.name } : undefined,
      capabilities,
      canInvite,
      customization: settings.customization,
      localDevelopment: identity.localDevelopment,
    },
  };
}
