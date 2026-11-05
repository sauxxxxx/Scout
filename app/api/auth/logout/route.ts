import { env } from 'cloudflare:workers';
import { ensureFoundationSchema } from '@/lib/foundation-store';
import type { FinderEnv } from '@/lib/finder-runtime';
import { destroySession } from '@/lib/session-auth';
import { workspaceDb } from '@/lib/workspace-store';

export const dynamic = 'force-dynamic';

async function logout(request: Request) {
  if (!(env as unknown as FinderEnv).GOOGLE_OAUTH_CLIENT_ID) return Response.redirect(`${new URL(request.url).origin}/cdn-cgi/access/logout`, 303);
  const db = workspaceDb();
  await ensureFoundationSchema(db);
  const headers = new Headers({ location: '/' });
  headers.append('set-cookie', await destroySession(request, db));
  return new Response(null, { status: 303, headers });
}

export const GET = logout;
export const POST = logout;
