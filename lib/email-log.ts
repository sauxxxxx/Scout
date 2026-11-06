import { markLeadChanged, refreshLeadTouch } from '@/lib/lead-touch-store';

const MAX_RECIPIENTS = 20;
const tokenPattern = /^log+([a-f0-9]{32})@/;
const emailPattern = /[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}/g;

export const validEmailLogDomain = (domain?: string) => {
  const value = domain?.trim().toLowerCase();
  return value && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(value) ? value : null;
};

/**
 * Each rep has their own private address, so a copy shows who sent the email without trusting the message itself.
 * Plus addressing means one Cloudflare rule for log@ receives them all, without taking over the domain's other mail.
 */
export async function emailLogAddress(db: D1Database, workspaceId: string, userId: string, domain: string) {
  await db.prepare('INSERT INTO email_log_tokens (token,workspace_id,user_id) VALUES (?,?,?) ON CONFLICT(workspace_id,user_id) DO NOTHING')
    .bind(crypto.randomUUID().replaceAll('-', ''), workspaceId, userId).run();
  const row = await db.prepare('SELECT token FROM email_log_tokens WHERE workspace_id=? AND user_id=?').bind(workspaceId, userId).first<{ token: string }>();
  return `log+${row!.token}@${domain}`;
}

export function recipientsOf(...headers: (string | null | undefined)[]) {
  const found = headers.join(',').toLowerCase().match(emailPattern) || [];
  return [...new Set(found)].slice(0, MAX_RECIPIENTS);
}

function decodeWord(charset: string, encoding: string, text: string) {
  try {
    const binary = encoding.toLowerCase() === 'b'
      ? atob(text)
      : text.replace(/_/g, ' ').replace(/=([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
    return new TextDecoder(charset).decode(Uint8Array.from(binary, character => character.charCodeAt(0)));
  } catch {
    return text;
  }
}

/** Non-English subjects arrive encoded, like =?UTF-8?B?...?=. */
export function decodeSubject(value?: string | null) {
  return (value || '')
    .replace(/\?=\s+=\?/g, '?==?')
    .replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (_, charset: string, encoding: string, text: string) => decodeWord(charset, encoding, text))
    .replace(/\s+/g, ' ').trim().slice(0, 200);
}

/** Activity times are stored as the rep's own clock. */
function wallClock(timezone: string | null, at: Date) {
  const format = (timeZone: string) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  let parts: Intl.DateTimeFormatPart[];
  try { parts = format(timezone || 'Asia/Manila'); } catch { parts = format('Asia/Manila'); }
  const part = (type: string) => parts.find(item => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

type SentEmail = { address: string; to?: string | null; cc?: string | null; subject?: string | null; messageId?: string | null; at?: Date };
type Rep = { workspace_id: string; name: string; timezone: string | null };
type MatchedLead = { id: string; name: string; company_id: string | null; contact: string | null };

/**
 * Called when the BCC copy arrives, which only happens if the email was really sent. Uses the headers alone: the body
 * is never read or stored. One email to two leads counts once for each, and a redelivered copy is ignored.
 */
export async function logSentEmail(db: D1Database, email: SentEmail) {
  const token = email.address.trim().toLowerCase().match(tokenPattern)?.[1];
  if (!token) return 0;
  const rep = await db.prepare(`SELECT t.workspace_id,u.name,u.timezone FROM email_log_tokens t JOIN users u ON u.id=t.user_id
    JOIN workspace_memberships m ON m.workspace_id=t.workspace_id AND m.user_id=t.user_id
    WHERE t.token=? AND COALESCE(m.suspended,0)=0 AND COALESCE(u.status,'active')<>'disabled'`).bind(token).first<Rep>();
  if (!rep) return 0;

  const leads = new Map<string, MatchedLead>();
  for (const address of recipientsOf(email.to, email.cc)) {
    const lead = await db.prepare(`SELECT l.id,l.name,l.company_id,
      (SELECT ct.id FROM contacts ct WHERE ct.workspace_id=l.workspace_id AND ct.company_id=l.company_id AND ct.archived=0 AND LOWER(ct.email)=?1 LIMIT 1) contact
      FROM leads l LEFT JOIN companies c ON c.id=l.company_id
      WHERE l.workspace_id=?2 AND l.archived=0 AND (LOWER(l.email)=?1 OR LOWER(c.email)=?1 OR EXISTS (SELECT 1 FROM contacts ct WHERE ct.workspace_id=l.workspace_id AND ct.company_id=l.company_id AND ct.archived=0 AND LOWER(ct.email)=?1))
      ORDER BY l.owner=?3 DESC,COALESCE(l.changed_at,l.updated_at) DESC LIMIT 1`).bind(address, rep.workspace_id, rep.name).first<MatchedLead>();
    if (lead) leads.set(lead.id, lead);
  }

  const at = email.at || new Date();
  const when = wallClock(rep.timezone, at);
  const subject = decodeSubject(email.subject);
  const messageId = email.messageId?.trim().slice(0, 300);
  let logged = 0;
  for (const lead of leads.values()) {
    const result = await db.prepare(`INSERT INTO activities (uid,workspace_id,id,version,lead,lead_id,company_id,contact_id,type,detail,time,owner,status,occurred_at,subject,external_ref,updated_at)
      VALUES (?,?,?,1,?,?,?,?,'Email',?,?,?,'Completed',?,?,?,CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING`)
      .bind(crypto.randomUUID(), rep.workspace_id, at.getTime() + logged, lead.name, lead.id, lead.company_id, lead.contact, subject || 'Email sent', when, rep.name, when, subject || null, messageId ? `${messageId}|${lead.id}` : null).run();
    if (!result.meta.changes) continue;
    await refreshLeadTouch(db, rep.workspace_id, lead.id, 'Email');
    await markLeadChanged(db, rep.workspace_id, lead.id);
    logged += 1;
  }
  return logged;
}
