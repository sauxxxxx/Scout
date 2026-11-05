export type InvitationEmailConfig = {
  apiKey?: string;
  from?: string;
};

export type InvitationEmailInput = {
  to: string;
  name: string;
  inviterName: string;
  workspaceName: string;
  inviteUrl: string;
  expiresInDays?: number;
  note?: string;
  workspaceMessage?: string;
  senderName?: string;
};

/** Keeps the configured sending address and only swaps the display name people see in their inbox. */
export function formatSender(from: string, senderName?: string) {
  const name = senderName?.replace(/[<>"\r\n]/g, '').trim();
  if (!name) return from;
  const address = from.match(/<([^>]+)>/)?.[1] || from;
  return `"${name}" <${address}>`;
}

export async function sendInvitationEmail(config: InvitationEmailConfig, input: InvitationEmailInput) {
  if (!config.apiKey?.trim() || !config.from?.trim()) return { delivered: false as const, reason: 'not_configured' as const };
  const days = input.expiresInDays ?? 7;
  const paragraphs = (value: string) => escapeHtml(value).replace(/\n/g, '<br/>');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${config.apiKey.trim()}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: formatSender(config.from.trim(), input.senderName),
      to: [input.to],
      subject: `${input.inviterName} invited you to ${input.workspaceName} in Scout`,
      text: [`Hi ${input.name},`, `${input.inviterName} invited you to ${input.workspaceName} in Scout.`, input.note, input.workspaceMessage, `Accept your invitation here:\n${input.inviteUrl}`, `Use the Google account for ${input.to}. This invitation expires in ${days} day${days === 1 ? '' : 's'}.`].filter(Boolean).join('\n\n'),
      html: `<div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:auto;padding:32px;color:#10262a"><img src="${new URL(input.inviteUrl).origin}/scout-logo.png" alt="Scout" width="44" height="44"/><h1 style="font-size:26px;margin:24px 0 8px">Join ${escapeHtml(input.workspaceName)}</h1><p style="line-height:1.6">Hi ${escapeHtml(input.name)}, ${escapeHtml(input.inviterName)} invited you to their Scout workspace.</p>${input.note ? `<p style="line-height:1.6;padding:12px 14px;background:#f7f7f7;border-radius:6px">${paragraphs(input.note)}</p>` : ''}${input.workspaceMessage ? `<p style="line-height:1.6">${paragraphs(input.workspaceMessage)}</p>` : ''}<p style="margin:28px 0"><a href="${escapeHtml(input.inviteUrl)}" style="background:#0b272b;color:white;text-decoration:none;padding:12px 18px;border-radius:6px;display:inline-block">Accept invitation</a></p><p style="font-size:13px;color:#607276">Use the Google account for ${escapeHtml(input.to)}. This invitation expires in ${days} day${days === 1 ? '' : 's'}.</p></div>`,
    }),
  });
  if (!response.ok) throw new Error(`Invitation email provider returned ${response.status}.`);
  const result = await response.json().catch(() => ({})) as { id?: string };
  return { delivered: true as const, id: result.id };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]!);
}
