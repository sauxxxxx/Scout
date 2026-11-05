import { env } from 'cloudflare:workers';
import type { FinderEnv } from '@/lib/finder-runtime';

export const dynamic = 'force-dynamic';

export async function GET() {
  const clientId = (env as unknown as FinderEnv).GOOGLE_OAUTH_CLIENT_ID?.trim();
  return Response.json({ provider: 'google', clientId: clientId || null, enabled: Boolean(clientId) });
}
