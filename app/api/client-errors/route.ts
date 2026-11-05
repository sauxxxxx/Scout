import { env } from 'cloudflare:workers';
import { reportFailure, type AlertEnv } from '@/lib/alerts';
import { ensureFoundationSchema } from '@/lib/foundation-store';
import { allowRequest, clientAddress, tooManyRequests } from '@/lib/rate-limit';
import { workspaceDb } from '@/lib/workspace-store';

export const dynamic = 'force-dynamic';

const text = (value: unknown, limit: number) => (typeof value === 'string' ? value.replace(/[\r\n]+/g, ' ').slice(0, limit) : '');

/** Browser crashes never reach the server otherwise. Open to signed-out visitors, so it is limited and stores nothing. */
export async function POST(request: Request) {
  const db = workspaceDb();
  await ensureFoundationSchema(db);
  if (!await allowRequest(db, `client-error:${clientAddress(request)}`, 20, 600)) return tooManyRequests(600);
  const body = await request.json().catch(() => null) as { message?: unknown; page?: unknown } | null;
  const message = text(body?.message, 300);
  if (!message) return new Response(null, { status: 204 });
  await reportFailure(env as unknown as AlertEnv, { event: 'browser_error', source: text(body?.page, 80), message });
  return new Response(null, { status: 204 });
}
