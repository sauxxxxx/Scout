import { activityFiles } from '@/lib/activity-store';
import { recordAudit } from '@/lib/audit';
import { authenticateRequest } from '@/lib/auth';
import { workspaceSettingsSchema, type WorkspaceSettings } from '@/lib/team';
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
  const { workspaceName, ...settings } = parsed.data as typeof parsed.data & WorkspaceSettings;
  const previousLogo = (await loadWorkspaceSettings(auth.db, auth.session.workspace.id)).customization.logoUrl;
  await saveWorkspaceSettings(auth.db, auth.session.workspace.id, settings);
  if (previousLogo && previousLogo !== settings.customization.logoUrl) {
    const oldKey = new URL(previousLogo, request.url).searchParams.get('key');
    if (oldKey?.startsWith(`logos/${encodeURIComponent(auth.session.workspace.id)}/`)) await activityFiles().delete(oldKey).catch(() => {});
  }
  if (workspaceName) await auth.db.prepare('UPDATE workspaces SET name=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(workspaceName, auth.session.workspace.id).run();
  await recordAudit(auth, 'settings.updated');
  return Response.json({ settings, workspaceName: workspaceName || auth.session.workspace.name });
}
