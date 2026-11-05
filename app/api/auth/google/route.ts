import { env } from 'cloudflare:workers';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { authenticateRequest } from '@/lib/auth';
import type { FinderEnv } from '@/lib/finder-runtime';
import { createSession } from '@/lib/session-auth';
import { ensureFoundationSchema } from '@/lib/foundation-store';
import { allowRequest, clientAddress, tooManyRequests } from '@/lib/rate-limit';
import { maskEmail } from '@/lib/team';
import { invitationSummary } from '@/lib/team-store';
import { workspaceDb } from '@/lib/workspace-store';

export const dynamic = 'force-dynamic';

const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

export async function POST(request: Request) {
  const clientId = (env as unknown as FinderEnv).GOOGLE_OAUTH_CLIENT_ID?.trim();
  if (!clientId) return Response.json({ error: 'Google sign-in is not configured yet.' }, { status: 503 });
  let body: { credential?: string; invite?: string };
  try { body = await request.json() as typeof body; } catch { return Response.json({ error: 'Invalid sign-in response.' }, { status: 400 }); }
  const limiter = workspaceDb();
  await ensureFoundationSchema(limiter);
  if (!await allowRequest(limiter, `signin:${clientAddress(request)}`, 60, 600)) return tooManyRequests(300);
  if (!body.credential || body.credential.length > 10000) return Response.json({ error: 'Google did not return a valid credential.' }, { status: 400 });

  let payload;
  try {
    ({ payload } = await jwtVerify(body.credential, googleKeys, {
      audience: clientId,
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
    }));
  } catch (error) {
    console.error('Google identity verification failed', error instanceof Error ? { name: error.name, message: error.message } : { name: 'UnknownError' });
    return Response.json({ error: 'Google could not verify this sign-in. Please try again.', code: 'GOOGLE_IDENTITY_REJECTED' }, { status: 401 });
  }

  if (!payload.sub || typeof payload.email !== 'string' || payload.email_verified !== true) return Response.json({ error: 'Use a verified Google account.' }, { status: 401 });

  try {
    const db = workspaceDb();
    await ensureFoundationSchema(db);
    if (body.invite) {
      const invite = await invitationSummary(db, body.invite);
      if (invite?.status === 'pending' && invite.email.toLowerCase() !== payload.email.toLowerCase()) return Response.json({ error: `This invitation was sent to ${maskEmail(invite.email)}. Sign in with that Google account.` }, { status: 403 });
    }
    const existing = await db.prepare('SELECT id FROM users WHERE lower(email)=lower(?)').bind(payload.email).first<{ id: string }>();
    const headers = new Headers(request.headers);
    headers.set('oai-authenticated-user-id', existing?.id || `google:${payload.sub}`);
    headers.set('oai-authenticated-user-email', payload.email.toLowerCase());
    headers.set('oai-authenticated-user-name', encodeURIComponent(typeof payload.name === 'string' ? payload.name : payload.email.split('@')[0]));
    if (typeof payload.picture === 'string') headers.set('oai-authenticated-user-avatar-url', payload.picture);
    const auth = await authenticateRequest(new Request(request.url, { headers }));
    if (!auth.ok) return auth.response;
    return Response.json({ session: auth.session }, { headers: { 'set-cookie': await createSession(auth.db, auth.session.user.id) } });
  } catch (error) {
    console.error('Scout session creation failed', error instanceof Error ? { name: error.name, message: error.message } : { name: 'UnknownError' });
    return Response.json({ error: 'Scout could not start your session. Please try again.', code: 'SCOUT_SESSION_FAILED' }, { status: 500 });
  }
}
