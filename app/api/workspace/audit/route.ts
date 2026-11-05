import { authenticateRequest } from '@/lib/auth';
import { listAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await authenticateRequest(request, 'users:manage');
  if (!auth.ok) return auth.response;
  return Response.json({ entries: await listAudit(auth.db, auth.session.workspace.id) });
}
