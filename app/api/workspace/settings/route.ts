import { recordAudit } from '@/lib/audit';
import { authenticateRequest } from '@/lib/auth';
import { workspaceSettingsSchema } from '@/lib/team';
import { loadCustomRoles, loadWorkspaceSettings, saveWorkspaceSettings } from '@/lib/team-store';
import { validationError } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await authenticateRequest(request, 'users:manage');
  if (!auth.ok) return auth.response;
  const workspaceId = auth.session.workspace.id;
  return Response.json({ settings: await loadWorkspaceSettings(auth.db, workspaceId), customRoles: await loadCustomRoles(auth.db, workspaceId), workspaceName: auth.session.workspace.name });
}

export async function PATCH(request: Request) {
  const auth = await authenticateRequest(request, 'users:manage');
  if (!auth.ok) return auth.response;
  if (auth.session.role !== 'owner') return Response.json({ error: 'Only an owner can change workspace settings.' }, { status: 403 });
  const parsed = workspaceSettingsSchema.safeParse(await request.json());
  if (!parsed.success) return validationError(parsed.error);
  const { workspaceName, ...settings } = parsed.data;
  await saveWorkspaceSettings(auth.db, auth.session.workspace.id, settings);
  if (workspaceName) await auth.db.prepare('UPDATE workspaces SET name=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(workspaceName, auth.session.workspace.id).run();
  await recordAudit(auth, 'settings.updated');
  return Response.json({ settings, workspaceName: workspaceName || auth.session.workspace.name });
}
