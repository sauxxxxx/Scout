import { authenticateRequest } from '@/lib/auth';
import { listNotifications } from '@/lib/notifications';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;
  return Response.json({ notifications: await listNotifications(auth.db, auth.session.workspace.id, auth.session.user.id) });
}

export async function PATCH(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;
  await auth.db.prepare('UPDATE notifications SET read_at=CURRENT_TIMESTAMP WHERE workspace_id=? AND user_id=? AND read_at IS NULL').bind(auth.session.workspace.id, auth.session.user.id).run();
  return Response.json({ notifications: await listNotifications(auth.db, auth.session.workspace.id, auth.session.user.id) });
}
