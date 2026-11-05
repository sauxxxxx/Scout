import { authenticateRequest } from '@/lib/auth';
import { notificationDefaults, parseObject, profileDefaults, profilePreferencesSchema, profileUpdateSchema, type ProfileUpdate } from '@/lib/profile';
import { activityFiles } from '@/lib/activity-store';
import { currentSessionHash, SCOUT_SESSION_COOKIE } from '@/lib/session-auth';
import { validationError } from '@/lib/validation';

export const dynamic = 'force-dynamic';

type ProfileRow = {
  id: string; email: string; name: string; avatar_url: string | null; job_title: string; phone: string; timezone: string; language: string;
  date_format: string; time_format: string; preferences_json: string; notifications_json: string; created_at: string;
};

function profileFrom(row: ProfileRow) {
  const stored = parseObject(row.preferences_json, profileDefaults);
  const candidate = { ...stored, currency: 'PHP', cardProperties: { ...profileDefaults.cardProperties, ...stored.cardProperties } };
  const preferences = profilePreferencesSchema.safeParse(candidate);
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatar_url || '',
    jobTitle: row.job_title || '',
    phone: row.phone || '',
    timezone: row.timezone || 'Asia/Manila',
    language: row.language || 'English (Philippines)',
    dateFormat: row.date_format || 'MMM d, yyyy',
    timeFormat: row.time_format || '12-hour',
    preferences: preferences.success ? preferences.data : profileDefaults,
    notifications: parseObject(row.notifications_json, notificationDefaults),
    joinedAt: row.created_at,
  };
}

async function responseData(request: Request, db: D1Database, userId: string, localDevelopment = false) {
  const row = await db.prepare(`SELECT id,email,name,avatar_url,job_title,phone,timezone,language,date_format,time_format,preferences_json,notifications_json,created_at FROM users WHERE id=?`)
    .bind(userId).first<ProfileRow>();
  if (!row) return null;
  const currentHash = await currentSessionHash(request);
  const [memberships, sessions] = await db.batch([
    db.prepare(`SELECT w.id,w.name,m.role,m.created_at FROM workspace_memberships m JOIN workspaces w ON w.id=m.workspace_id WHERE m.user_id=? ORDER BY m.created_at`).bind(userId),
    db.prepare(`SELECT token_hash,created_at,last_seen_at,expires_at FROM auth_sessions WHERE user_id=? AND expires_at>CURRENT_TIMESTAMP ORDER BY last_seen_at DESC`).bind(userId),
  ]);
  return {
    profile: profileFrom(row),
    memberships: (memberships.results as Array<Record<string, unknown>>).map(item => ({ id: String(item.id), name: String(item.name), role: String(item.role), joinedAt: String(item.created_at) })),
    sessions: (sessions.results as Array<Record<string, unknown>>).map((item, index) => ({
      id: String(item.token_hash).slice(0, 16),
      label: String(item.token_hash) === currentHash ? 'This browser' : `Signed-in browser ${index + 1}`,
      current: String(item.token_hash) === currentHash,
      createdAt: String(item.created_at),
      lastSeenAt: String(item.last_seen_at),
      expiresAt: String(item.expires_at),
    })),
    signInMethod: localDevelopment ? 'Local development' : 'Google',
  };
}

export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;
  const data = await responseData(request, auth.db, auth.session.user.id, auth.session.localDevelopment);
  return data ? Response.json(data) : Response.json({ error: 'Profile not found.' }, { status: 404 });
}

export async function PATCH(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: 'Invalid profile data.' }, { status: 400 }); }
  const parsed = profileUpdateSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);
  const value: ProfileUpdate = parsed.data;
  if (value.avatarUrl.startsWith('/api/profile/photo?')) {
    const key = new URL(value.avatarUrl, request.url).searchParams.get('key') || '';
    if (!key.startsWith(`profiles/${encodeURIComponent(auth.session.user.id)}/`) || !await activityFiles().head(key)) return Response.json({ error: 'Choose a photo uploaded to your account.', fields: { avatarUrl: ['This photo is unavailable. Upload it again.'] } }, { status: 422 });
  }
  if (value.preferences.defaultOwner !== 'Me') {
    const owner = await auth.db.prepare("SELECT u.id FROM workspace_memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? AND u.id=? AND u.status!='disabled' AND m.role!='viewer'").bind(auth.session.workspace.id, value.preferences.defaultOwner).first();
    if (!owner || !['owner', 'admin'].includes(auth.session.role)) return Response.json({ error: 'Choose an active workspace owner.', fields: { preferences: ['Choose an active workspace member.'] } }, { status: 422 });
  }
  const previous = await auth.db.prepare('SELECT avatar_url,name FROM users WHERE id=?').bind(auth.session.user.id).first<{ avatar_url: string; name: string }>();
  const renamed = previous && previous.name !== value.name;
  if (renamed) {
    const workspaceIds = auth.session.workspaces.map(item => item.id);
    const taken = await auth.db.prepare(`SELECT u.id FROM users u JOIN workspace_memberships m ON m.user_id=u.id WHERE m.workspace_id IN (${workspaceIds.map(() => '?').join(',')}) AND u.name=? AND u.id!=? LIMIT 1`).bind(...workspaceIds, value.name, auth.session.user.id).first();
    if (taken) return Response.json({ error: 'Someone on your team already uses this name.', fields: { name: ['Someone on your team already uses this name.'] } }, { status: 409 });
    // Records store the owner's name, so a rename has to reach every record or the person loses them.
    await auth.db.batch(workspaceIds.flatMap(workspaceId => ['leads', 'tasks', 'opportunities', 'companies', 'activities'].map(table => auth.db.prepare(`UPDATE ${table} SET owner=?,updated_at=CURRENT_TIMESTAMP WHERE workspace_id=? AND owner=?`).bind(value.name, workspaceId, previous!.name))));
  }
  await auth.db.prepare(`UPDATE users SET name=?,job_title=?,phone=?,avatar_url=?,timezone=?,language=?,date_format=?,time_format=?,preferences_json=?,notifications_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .bind(value.name, value.jobTitle, value.phone, value.avatarUrl || null, value.timezone, value.language, value.dateFormat, value.timeFormat, JSON.stringify(value.preferences), JSON.stringify(value.notifications), auth.session.user.id).run();
  const data = await responseData(request, auth.db, auth.session.user.id, auth.session.localDevelopment);
  if (previous?.avatar_url?.startsWith('/api/profile/photo?') && previous.avatar_url !== value.avatarUrl) {
    const oldKey = new URL(previous.avatar_url, request.url).searchParams.get('key');
    if (oldKey?.startsWith(`profiles/${encodeURIComponent(auth.session.user.id)}/`)) await activityFiles().delete(oldKey).catch(() => {});
  }
  return Response.json(data);
}

export async function DELETE(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;
  const scope = new URL(request.url).searchParams.get('scope');
  if (!['others', 'all'].includes(scope || '')) return Response.json({ error: 'Choose which sessions to sign out.' }, { status: 400 });
  const currentHash = await currentSessionHash(request);
  if (scope === 'others' && currentHash) await auth.db.prepare('DELETE FROM auth_sessions WHERE user_id=? AND token_hash<>?').bind(auth.session.user.id, currentHash).run();
  else if (scope === 'others') await auth.db.prepare('DELETE FROM auth_sessions WHERE user_id=?').bind(auth.session.user.id).run();
  else await auth.db.prepare('DELETE FROM auth_sessions WHERE user_id=?').bind(auth.session.user.id).run();
  const headers = new Headers();
  if (scope === 'all') headers.set('set-cookie', `${SCOUT_SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
  return Response.json({ ok: true }, { headers });
}
