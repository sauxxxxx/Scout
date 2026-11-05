/** Fixed-window counter stored in D1, so limits hold across Worker isolates. */
export async function allowRequest(db: D1Database, key: string, limit: number, windowSeconds: number, now = Date.now()) {
  const bucket = Math.floor(now / 1000 / windowSeconds);
  const row = await db.prepare('INSERT INTO rate_limits (key,bucket,hits) VALUES (?,?,1) ON CONFLICT(key,bucket) DO UPDATE SET hits=hits+1 RETURNING hits').bind(key, bucket).first<{ hits: number }>();
  if (Math.random() < 0.02) await db.prepare('DELETE FROM rate_limits WHERE bucket<?').bind(bucket - 2).run();
  return Number(row?.hits || 0) <= limit;
}

export function clientAddress(request: Request) {
  return request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

export const tooManyRequests = (retryAfterSeconds = 60) => Response.json({ error: 'Too many attempts. Wait a few minutes and try again.' }, { status: 429, headers: { 'retry-after': String(retryAfterSeconds) } });
