import { workspaceDb } from '@/lib/workspace-store';

export const dynamic = 'force-dynamic';

/** For uptime monitors. Confirms the database answers and reveals nothing else. */
export async function GET() {
  try {
    await workspaceDb().prepare('SELECT 1').first();
    return Response.json({ status: 'ok' }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return Response.json({ status: 'unavailable' }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
}
