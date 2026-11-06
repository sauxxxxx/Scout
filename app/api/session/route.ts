import { env } from 'cloudflare:workers';
import { authenticateRequest } from '@/lib/auth';
import { emailLogAddress, validEmailLogDomain } from '@/lib/email-log';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;
  const domain = validEmailLogDomain((env as unknown as { EMAIL_LOG_DOMAIN?: string }).EMAIL_LOG_DOMAIN);
  const tracksEmail = domain && auth.session.role !== 'viewer';
  return Response.json({ session: tracksEmail ? { ...auth.session, emailLogAddress: await emailLogAddress(auth.db, auth.session.workspace.id, auth.session.user.id, domain) } : auth.session });
}
