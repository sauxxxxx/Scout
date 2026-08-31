import { authenticateRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;
  return Response.json({ session: auth.session });
}
