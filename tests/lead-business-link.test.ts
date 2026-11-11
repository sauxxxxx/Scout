import { expect, it, vi } from 'vitest';
import { normalizeBusinessLink } from '@/lib/business-link';
import { ensureFoundationSchema } from '@/lib/foundation-store';
import { testD1 } from './helpers/d1';

const mocks = vi.hoisted(() => ({ authenticate: vi.fn() }));
vi.mock('cloudflare:workers', () => ({ env: {} }));
vi.mock('@/lib/auth', () => ({ authenticateRequest: mocks.authenticate }));
import { GET, PATCH, POST } from '@/app/api/leads/route';

it('accepts business websites and social links with or without a scheme', () => {
  expect(normalizeBusinessLink('www.joynomedia.com')).toBe('https://www.joynomedia.com/');
  expect(normalizeBusinessLink('https://www.instagram.com/tomonokissa/')).toBe('https://www.instagram.com/tomonokissa/');
  expect(normalizeBusinessLink('example.com/?next=https://example.org')).toBe('https://example.com/?next=https://example.org');
  for (const input of ['javascript:alert(1)', 'ftp://example.com', 'https://user@example.com', 'invalid link']) {
    expect(normalizeBusinessLink(input)).toBeNull();
  }
});

it('keeps a lead’s existing Facebook link when a website is saved and cleared', async () => {
  const { db } = testD1();
  await ensureFoundationSchema(db);
  mocks.authenticate.mockResolvedValue({ ok: true, db, session: {
    role: 'owner', user: { id: 'ana', name: 'Ana' }, workspace: { id: 'scout-default' },
    capabilities: { 'records:view_all': true },
  } });
  const url = 'https://scout.test/api/leads';
  const request = (method: string, body: unknown) => new Request(url, { method, body: JSON.stringify(body) });
  const input = {
    name: 'Tomono Kissa', industry: 'Cafe', city: 'Makati', status: 'New', score: 0,
    owner: 'Ana', last: '', next: '', phone: '', email: '', contact: 'Ana',
    priority: 'Medium', opportunity: '',
  };
  const created = await POST(request('POST', input));
  expect(created.status).toBe(201);
  const { lead } = await created.json() as { lead: { id: string; version: number } };
  const edit = (version: number, patch: Record<string, string>) =>
    PATCH(request('PATCH', { ...input, id: lead.id, version, ...patch }));
  const read = async () => (await GET(new Request(`${url}?id=${lead.id}`))).json();
  const facebookUrl = 'https://www.facebook.com/tomonokissa';
  expect((await edit(lead.version, { facebookUrl })).status).toBe(200);
  expect(await read()).toMatchObject({ lead: { facebookUrl } });
  expect((await edit(lead.version + 1, { businessLink: 'ftp://example.com' })).status).toBe(422);

  const updated = await edit(lead.version + 1, { businessLink: 'www.joynomedia.com', facebookUrl });
  expect(updated.status).toBe(200);
  expect(await updated.json()).toMatchObject({ lead: { businessLink: 'https://www.joynomedia.com/', facebookUrl } });
  expect(await read()).toMatchObject({ lead: { businessLink: 'https://www.joynomedia.com/', facebookUrl } });

  expect((await edit(lead.version + 2, { businessLink: '' })).status).toBe(200);
  expect(await read()).toMatchObject({ lead: { businessLink: '', facebookUrl } });
});
