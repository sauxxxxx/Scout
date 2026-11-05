import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendInvitationEmail } from '@/lib/invitation-email';

describe('workspace invitation email', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the manual-link fallback when email is not configured', async () => {
    expect(await sendInvitationEmail({}, { to: 'member@example.com', name: 'Member', inviterName: 'Owner', workspaceName: 'Sales', inviteUrl: 'https://example.com/invite' }))
      .toEqual({ delivered: false, reason: 'not_configured' });
  });

  it('sends a private invitation through the configured provider', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'email-1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await sendInvitationEmail({ apiKey: 'secret', from: 'Scout <invite@example.com>' }, { to: 'member@example.com', name: 'Member', inviterName: 'Owner', workspaceName: 'Sales', inviteUrl: 'https://example.com/invite' });
    expect(result).toEqual({ delivered: true, id: 'email-1' });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ to: ['member@example.com'] });
  });

  it('adds the personal note, workspace message, sender name and real expiry, safely escaped', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'email-2' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await sendInvitationEmail({ apiKey: 'secret', from: 'Scout <invite@example.com>' }, { to: 'member@example.com', name: 'Member', inviterName: 'Owner', workspaceName: 'Sales', inviteUrl: 'https://crm.example.com/?invite=1', expiresInDays: 1, note: 'Hi <b>there</b>', workspaceMessage: 'Start with Leads', senderName: 'Joyno Sales' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.from).toBe('"Joyno Sales" <invite@example.com>');
    expect(body.html).toContain('Hi &lt;b&gt;there&lt;/b&gt;');
    expect(body.html).not.toContain('<b>there</b>');
    expect(body.html).toContain('Start with Leads');
    expect(body.html).toContain('https://crm.example.com/scout-logo.png');
    expect(body.html).toContain('expires in 1 day.');
    expect(body.text).toContain('Hi <b>there</b>');
    expect(body.text).toContain('expires in 1 day.');
  });
});
