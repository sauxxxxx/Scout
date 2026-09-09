import { authenticateRequest } from '@/lib/auth';
import { canAssignRole, type WorkspaceRole } from '@/lib/permissions';
import { memberInputSchema, validationError } from '@/lib/validation';

export const dynamic = 'force-dynamic';

type MemberRow = { id: string; email: string; name: string; avatar_url: string | null; role: WorkspaceRole; status: string };
type InviteRow = { id: string; email: string; name: string; role: WorkspaceRole; expires_at: string };

async function members(db: D1Database, workspaceId: string) {
  await db.prepare("UPDATE workspace_invitations SET status='expired',updated_at=CURRENT_TIMESTAMP WHERE workspace_id=? AND status='pending' AND expires_at<CURRENT_TIMESTAMP").bind(workspaceId).run();
  const [active, pending] = await db.batch([
    db.prepare(`SELECT u.id,u.email,u.name,u.avatar_url,u.status,m.role FROM workspace_memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END,u.name`).bind(workspaceId),
    db.prepare(`SELECT id,email,name,role,expires_at FROM workspace_invitations WHERE workspace_id=? AND status='pending' ORDER BY created_at DESC`).bind(workspaceId),
  ]);
  return [
    ...(active.results as MemberRow[]).map(row => ({ id: row.id, email: row.email, name: row.name, avatarUrl: row.avatar_url || undefined, role: row.role, status: row.status, pending: false })),
    ...(pending.results as InviteRow[]).map(row => ({ id: `invite:${row.id}`, invitationId: row.id, email: row.email, name: row.name, role: row.role, status: 'invited', pending: true, expiresAt: row.expires_at })),
  ];
}

export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;
  return Response.json({ users: await members(auth.db, auth.session.workspace.id), currentUserId: auth.session.user.id, currentRole: auth.session.role });
}

export async function POST(request: Request) {
  const auth = await authenticateRequest(request, 'users:manage');
  if (!auth.ok) return auth.response;
  const parsed = memberInputSchema.safeParse(await request.json());
  if (!parsed.success) return validationError(parsed.error);
  if (!canAssignRole(auth.session.role, parsed.data.role)) return Response.json({ error: 'Only an owner can assign the owner role.' }, { status: 403 });
  const email = parsed.data.email.toLowerCase();
  const existing = await auth.db.prepare(`SELECT u.id FROM users u JOIN workspace_memberships m ON m.user_id=u.id WHERE m.workspace_id=? AND lower(u.email)=lower(?)`).bind(auth.session.workspace.id, email).first<{ id: string }>();
  if (existing) return Response.json({ error: 'This person is already a workspace member.' }, { status: 409 });
  const current = await auth.db.prepare("SELECT id FROM workspace_invitations WHERE workspace_id=? AND lower(email)=lower(?) AND status='pending'").bind(auth.session.workspace.id, email).first<{ id: string }>();
  const id = current?.id || crypto.randomUUID();
  if (current) {
    await auth.db.prepare("UPDATE workspace_invitations SET name=?,role=?,invited_by=?,expires_at=datetime('now','+7 days'),updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(parsed.data.name, parsed.data.role, auth.session.user.id, id).run();
  } else {
    await auth.db.prepare(`INSERT INTO workspace_invitations (id,workspace_id,email,name,role,invited_by,expires_at) VALUES (?,?,?,?,?,?,datetime('now','+7 days'))`).bind(id, auth.session.workspace.id, email, parsed.data.name, parsed.data.role, auth.session.user.id).run();
  }
  return Response.json({ users: await members(auth.db, auth.session.workspace.id), inviteUrl: `${new URL(request.url).origin}/?invite=${encodeURIComponent(id)}` }, { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await authenticateRequest(request, 'users:manage');
  if (!auth.ok) return auth.response;
  const body = await request.json() as { id?: string; role?: WorkspaceRole };
  if (!body.id || !body.role || !['owner', 'admin', 'member', 'viewer'].includes(body.role)) return Response.json({ error: 'User ID and valid role are required.' }, { status: 400 });
  if (!canAssignRole(auth.session.role, body.role)) return Response.json({ error: 'Only an owner can assign the owner role.' }, { status: 403 });
  if (body.id.startsWith('invite:')) {
    const result = await auth.db.prepare("UPDATE workspace_invitations SET role=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=? AND status='pending'").bind(body.role, body.id.slice(7), auth.session.workspace.id).run();
    if (!result.meta.changes) return Response.json({ error: 'Pending invitation not found.' }, { status: 404 });
    return Response.json({ users: await members(auth.db, auth.session.workspace.id) });
  }
  if (body.id === auth.session.user.id && auth.session.role === 'owner' && body.role !== 'owner') {
    const owners = await auth.db.prepare("SELECT COUNT(*) total FROM workspace_memberships WHERE workspace_id=? AND role='owner'").bind(auth.session.workspace.id).first<{ total: number }>();
    if (Number(owners?.total || 0) <= 1) return Response.json({ error: 'Assign another owner before changing your role.' }, { status: 409 });
  }
  const result = await auth.db.prepare('UPDATE workspace_memberships SET role=?,updated_at=CURRENT_TIMESTAMP WHERE workspace_id=? AND user_id=?').bind(body.role, auth.session.workspace.id, body.id).run();
  if (!result.meta.changes) return Response.json({ error: 'Workspace user not found.' }, { status: 404 });
  return Response.json({ users: await members(auth.db, auth.session.workspace.id) });
}

export async function DELETE(request: Request) {
  const auth = await authenticateRequest(request, 'users:manage');
  if (!auth.ok) return auth.response;
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return Response.json({ error: 'User ID is required.' }, { status: 400 });
  if (id.startsWith('invite:')) {
    const result = await auth.db.prepare("UPDATE workspace_invitations SET status='revoked',updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=? AND status='pending'").bind(id.slice(7), auth.session.workspace.id).run();
    if (!result.meta.changes) return Response.json({ error: 'Pending invitation not found.' }, { status: 404 });
    return Response.json({ users: await members(auth.db, auth.session.workspace.id) });
  }
  const target = await auth.db.prepare('SELECT role FROM workspace_memberships WHERE workspace_id=? AND user_id=?').bind(auth.session.workspace.id, id).first<{ role: WorkspaceRole }>();
  if (!target) return Response.json({ error: 'Workspace user not found.' }, { status: 404 });
  if (!canAssignRole(auth.session.role, target.role)) return Response.json({ error: 'You cannot remove this workspace user.' }, { status: 403 });
  if (target.role === 'owner') {
    const owners = await auth.db.prepare("SELECT COUNT(*) total FROM workspace_memberships WHERE workspace_id=? AND role='owner'").bind(auth.session.workspace.id).first<{ total: number }>();
    if (Number(owners?.total || 0) <= 1) return Response.json({ error: 'Scout must keep at least one owner.' }, { status: 409 });
  }
  await auth.db.prepare('DELETE FROM workspace_memberships WHERE workspace_id=? AND user_id=?').bind(auth.session.workspace.id, id).run();
  return Response.json({ users: await members(auth.db, auth.session.workspace.id) });
}
