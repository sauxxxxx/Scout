import { ensureFoundationSchema } from '@/lib/foundation-store';
import { allowRequest, clientAddress, tooManyRequests } from '@/lib/rate-limit';
import { maskEmail } from '@/lib/team';
import { invitationSummary } from '@/lib/team-store';
import { workspaceDb } from '@/lib/workspace-store';

export const dynamic = 'force-dynamic';

/** Public on purpose: the sign-in page needs this before anyone has a session. The ID is an unguessable UUID, and the email stays masked. */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get('id');
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ status: 'not_found' });
  const db = workspaceDb();
  await ensureFoundationSchema(db);
  if (!await allowRequest(db, `invite-lookup:${clientAddress(request)}`, 120, 600)) return tooManyRequests(300);
  const invite = await invitationSummary(db, id);
  if (!invite) return Response.json({ status: 'not_found' });
  return Response.json({
    status: invite.status,
    emailHint: maskEmail(invite.email),
    workspaceName: invite.workspace_name,
    inviterName: invite.inviter_name || 'Your team',
    roleLabel: invite.custom_role_name || invite.role,
    note: invite.status === 'pending' ? invite.note : '',
  });
}
