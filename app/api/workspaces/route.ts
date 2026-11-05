import { z } from 'zod';
import { recordAudit } from '@/lib/audit';
import { authenticateRequest, SCOUT_WORKSPACE_COOKIE } from '@/lib/auth';
import { allowRequest, tooManyRequests } from '@/lib/rate-limit';
import { validationError } from '@/lib/validation';

export const dynamic = 'force-dynamic';

const createSchema = z.object({ name: z.string().trim().min(2).max(80) }).strict();
const switchSchema = z.object({ id: z.string().min(1).max(80) }).strict();

function workspaceCookie(request: Request, id: string) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${SCOUT_WORKSPACE_COOKIE}=${encodeURIComponent(id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure}`;
}

export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;
  if (!await allowRequest(auth.db, `workspace-create:${auth.session.user.id}`, 5, 86400)) return tooManyRequests(3600);
  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) return validationError(parsed.error);
  const id = crypto.randomUUID();
  await auth.db.batch([
    auth.db.prepare('INSERT INTO workspaces (id,name) VALUES (?,?)').bind(id, parsed.data.name),
    auth.db.prepare("INSERT INTO workspace_memberships (workspace_id,user_id,role) VALUES (?,?,'owner')").bind(id, auth.session.user.id),
  ]);
  await recordAudit({ ...auth, session: { ...auth.session, workspace: { ...auth.session.workspace, id } } }, 'settings.updated', parsed.data.name, 'Workspace created');
  return Response.json({ id }, { status: 201, headers: { 'set-cookie': workspaceCookie(request, id) } });
}

export async function PATCH(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;
  const parsed = switchSchema.safeParse(await request.json());
  if (!parsed.success) return validationError(parsed.error);
  if (!auth.session.workspaces.some(item => item.id === parsed.data.id)) return Response.json({ error: 'You are not a member of that workspace.' }, { status: 403 });
  return Response.json({ id: parsed.data.id }, { headers: { 'set-cookie': workspaceCookie(request, parsed.data.id) } });
}
