import { env } from 'cloudflare:workers';
import { authenticateRequest } from '@/lib/auth';

export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;
  // This is a separate, HTTP-referrer-restricted browser key. Never expose the Places server key.
  const config = env as unknown as { GOOGLE_MAPS_BROWSER_KEY?: string; GOOGLE_MAPS_MAP_ID?: string };
  return Response.json({ apiKey: config.GOOGLE_MAPS_BROWSER_KEY || '', mapId: config.GOOGLE_MAPS_MAP_ID || 'DEMO_MAP_ID' }, { headers: { 'Cache-Control': 'private, no-store' } });
}
