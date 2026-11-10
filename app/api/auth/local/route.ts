import { isLocalRequest, LOCAL_SIGNED_OUT_COOKIE } from '@/lib/session-auth';

export const dynamic = 'force-dynamic';

/** Turns the automatic local sign-in back on after signing out. Only answers on this computer. */
export function GET(request: Request) {
  if (!isLocalRequest(request)) return new Response('Not found', { status: 404 });
  return new Response(null, { status: 303, headers: { location: '/', 'set-cookie': `${LOCAL_SIGNED_OUT_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` } });
}
