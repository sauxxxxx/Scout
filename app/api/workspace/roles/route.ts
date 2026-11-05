import { recordAudit } from '@/lib/audit';
import { authenticateRequest } from '@/lib/auth';
import { customRoleInputSchema, customRoleUpdateSchema } from '@/lib/team';
import { loadCustomRoles } from '@/lib/team-store';
import { validationError } from '@/lib/validation';

export const dynamic = 'force-dynamic';

async function ownerOnly(request: Request) {
  const auth = await authenticateRequest(request, 'users:manage');
  if (!auth.ok) return auth;
  if (auth.session.role !== 'owner') return { ok: false as const, response: Response.json({ error: 'Only an owner can change roles.' }, { status: 403 }) };
  return auth;
}

export async function POST(request: Request) {
  const auth = await ownerOnly(request);
  if (!auth.ok) return auth.response;
  const parsed = customRoleInputSchema.safeParse(await request.json());
  if (!parsed.success) return validationError(parsed.error);
  try {
    await auth.db.prepare('INSERT INTO workspace_custom_roles (id,workspace_id,name,base_role,permissions_json) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), auth.session.workspace.id, parsed.data.name, parsed.data.baseRole, JSON.stringify(parsed.data.capabilities)).run();
  } catch {
    return Response.json({ error: 'A role with this name already exists.' }, { status: 409 });
  }
  await recordAudit(auth, 'role.created', parsed.data.name);
  return Response.json({ customRoles: await loadCustomRoles(auth.db, auth.session.workspace.id) }, { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await ownerOnly(request);
  if (!auth.ok) return auth.response;
  const parsed = customRoleUpdateSchema.safeParse(await request.json());
  if (!parsed.success) return validationError(parsed.error);
  try {
    const result = await auth.db.prepare('UPDATE workspace_custom_roles SET name=?,permissions_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?').bind(parsed.data.name, JSON.stringify(parsed.data.capabilities), parsed.data.id, auth.session.workspace.id).run();
    if (!result.meta.changes) return Response.json({ error: 'Role not found.' }, { status: 404 });
  } catch {
    return Response.json({ error: 'A role with this name already exists.' }, { status: 409 });
  }
  await recordAudit(auth, 'role.updated', parsed.data.name);
  return Response.json({ customRoles: await loadCustomRoles(auth.db, auth.session.workspace.id) });
}

export async function DELETE(request: Request) {
  const auth = await ownerOnly(request);
  if (!auth.ok) return auth.response;
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return Response.json({ error: 'Role ID is required.' }, { status: 400 });
  const workspaceId = auth.session.workspace.id;
  await auth.db.batch([
    auth.db.prepare('UPDATE workspace_memberships SET custom_role_id=NULL WHERE workspace_id=? AND custom_role_id=?').bind(workspaceId, id),
    auth.db.prepare('UPDATE workspace_invitations SET custom_role_id=NULL WHERE workspace_id=? AND custom_role_id=?').bind(workspaceId, id),
    auth.db.prepare('DELETE FROM workspace_custom_roles WHERE id=? AND workspace_id=?').bind(id, workspaceId),
  ]);
  await recordAudit(auth, 'role.deleted', id);
  return Response.json({ customRoles: await loadCustomRoles(auth.db, workspaceId) });
}
