import { GET as loadNotifications } from '@/app/api/notifications/route';
import { GET as loadProfile } from '@/app/api/profile/route';
import { GET as loadSession } from '@/app/api/session/route';
import { GET as loadUsers } from '@/app/api/users/route';

export const dynamic = 'force-dynamic';

const body = async (response: Response) => response.ok ? await response.json() as Record<string, unknown> : {};

/** What every screen needs before it can draw, in one request instead of four. */
export async function GET(request: Request) {
  const session = await loadSession(request);
  if (!session.ok) return session;
  const [signedIn, profile, notifications, users] = await Promise.all([body(session), loadProfile(request).then(body), loadNotifications(request).then(body), loadUsers(request).then(body)]);
  return Response.json({ session: signedIn.session, profile: profile.profile, view: profile.view, notifications: notifications.notifications, users: users.users });
}
