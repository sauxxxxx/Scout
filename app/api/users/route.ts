import { authenticateRequest } from '@/lib/auth';
import { canAssignRole, type WorkspaceRole } from '@/lib/permissions';
import { memberInputSchema, validationError } from '@/lib/validation';

export const dynamic = 'force-dynamic';

type MemberRow = { id: string; email: string; name: string; avatar_url: string | null; role: WorkspaceRole };

async function members(db: D1Database, workspaceId: string) {
  const result = await db.prepare(`SELECT u.id,u.email,u.name,u.avatar_url,m.role FROM workspace_memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END,u.name`).bind(workspaceId).all<MemberRow>();
  return result.results.map(row => ({ id: row.id, email: row.email, name: row.name, avatarUrl: row.avatar_url || undefined, role: row.role, pending: row.id.startsWith('invite:') }));
}

export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;
  return Response.json({ users: await members(auth.db, auth.session.workspace.id) });
}

export async function POST(request: Request) {
  const auth = await authenticateRequest(request, 'users:manage');
  if (!auth.ok) return auth.response;
  const parsed = memberInputSchema.safeParse(await request.json());
  if (!parsed.success) return validationError(parsed.error);
  if (!canAssignRole(auth.session.role, parsed.data.role)) return Response.json({ error: 'Only an owner can assign the owner role.' }, { status: 403 });
  const existing = await auth.db.prepare('SELECT id FROM users WHERE lower(email)=lower(?)').bind(parsed.data.email).first<{ id: string }>();
  const userId = existing?.id || `invite:${crypto.randomUUID()}`;
  await auth.db.batch([
    auth.db.prepare('INSERT INTO users (id,email,name,updated_at) VALUES (?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET email=excluded.email,name=excluded.name,updated_at=CURRENT_TIMESTAMP').bind(userId, parsed.data.email.toLowerCase(), parsed.data.name),
    auth.db.prepare('INSERT INTO workspace_memberships (workspace_id,user_id,role,updated_at) VALUES (?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(workspace_id,user_id) DO UPDATE SET role=excluded.role,updated_at=CURRENT_TIMESTAMP').bind(auth.session.workspace.id, userId, parsed.data.role),
  ]);
  return Response.json({ users: await members(auth.db, auth.session.workspace.id) }, { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await authenticateRequest(request, 'users:manage');
  if (!auth.ok) return auth.response;
  const body = await request.json() as { id?: string; role?: WorkspaceRole };
  if (!body.id || !body.role || !['owner', 'admin', 'member', 'viewer'].includes(body.role)) return Response.json({ error: 'User ID and valid role are required.' }, { status: 400 });
  if (!canAssignRole(auth.session.role, body.role)) return Response.json({ error: 'Only an owner can assign the owner role.' }, { status: 403 });
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
