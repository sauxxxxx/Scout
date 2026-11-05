import { allowRequest } from '@/lib/rate-limit';

export type AlertEnv = { RESEND_API_KEY?: string; SCOUT_EMAIL_FROM?: string; SCOUT_ALERT_EMAIL?: string; DB?: D1Database };
export type AlertEvent = { event: string; path?: string; status?: number; message?: string; source?: string };

const QUIET_SECONDS = 900;

/** Logs every failure and emails the first of each kind per 15 minutes, so a broken page can't flood an inbox. */
export async function reportFailure(env: AlertEnv, failure: AlertEvent) {
  console.error(JSON.stringify(failure));
  const to = env.SCOUT_ALERT_EMAIL?.trim();
  if (!to || !env.RESEND_API_KEY?.trim() || !env.SCOUT_EMAIL_FROM?.trim() || !env.DB) return { sent: false as const };
  try {
    const key = `alert:${failure.event}:${failure.path || failure.source || ''}`.slice(0, 200);
    if (!await allowRequest(env.DB, key, 1, QUIET_SECONDS)) return { sent: false as const };
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY.trim()}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: env.SCOUT_EMAIL_FROM.trim(),
        to: [to],
        subject: `Scout alert: ${failure.event}${failure.path ? ` on ${failure.path}` : ''}`,
        text: `${JSON.stringify(failure, null, 2)}\n\nSimilar failures are silenced for 15 minutes. Full history is in Cloudflare Workers Logs.`,
      }),
    });
    return { sent: response.ok };
  } catch (error) {
    console.error(JSON.stringify({ event: 'alert_failed', message: error instanceof Error ? error.message : 'unknown' }));
    return { sent: false as const };
  }
}
