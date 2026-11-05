export const SCOUT_SESSION_COOKIE = 'scout_session';
const SESSION_DAYS = 30;

function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function hashSessionToken(token: string) {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))));
}

export function cookieValue(request: Request, name: string) {
  const entry = request.headers.get('cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : null;
}

export async function currentSessionHash(request: Request) {
  const token = cookieValue(request, SCOUT_SESSION_COOKIE);
  return token && token.length >= 32 ? hashSessionToken(token) : null;
}

export async function sessionIdentity(request: Request, db: D1Database) {
  const token = cookieValue(request, SCOUT_SESSION_COOKIE);
  if (!token || token.length < 32) return null;
  const tokenHash = await hashSessionToken(token);
  const row = await db.prepare(`SELECT u.id,u.email,u.name,u.avatar_url FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>CURRENT_TIMESTAMP AND u.status='active'`).bind(tokenHash).first<{ id: string; email: string; name: string; avatar_url: string | null }>();
  if (!row) return null;
  await db.batch([
    db.prepare('UPDATE auth_sessions SET last_seen_at=CURRENT_TIMESTAMP WHERE token_hash=?').bind(tokenHash),
    db.prepare('UPDATE users SET last_seen_at=CURRENT_TIMESTAMP WHERE id=?').bind(row.id),
  ]);
  return { id: row.id, email: row.email, name: row.name, avatarUrl: row.avatar_url || undefined, localDevelopment: false };
}

export async function createSession(db: D1Database, userId: string) {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = bytesToHex(bytes);
  const tokenHash = await hashSessionToken(token);
  await db.batch([
    db.prepare("DELETE FROM auth_sessions WHERE expires_at<=CURRENT_TIMESTAMP"),
    db.prepare("INSERT INTO auth_sessions (token_hash,user_id,expires_at) VALUES (?,?,datetime('now',?))").bind(tokenHash, userId, `+${SESSION_DAYS} days`),
  ]);
  return `${SCOUT_SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}

export async function destroySession(request: Request, db: D1Database) {
  const token = cookieValue(request, SCOUT_SESSION_COOKIE);
  if (token) await db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').bind(await hashSessionToken(token)).run();
  return `${SCOUT_SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
