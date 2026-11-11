import { expect, it, vi } from 'vitest';
import { ensureFoundationSchema } from '@/lib/foundation-store';
import { testD1 } from './helpers/d1';

const mocks = vi.hoisted(() => ({ authenticate: vi.fn() }));
vi.mock('cloudflare:workers', () => ({ env: {} }));
vi.mock('@/lib/auth', () => ({ authenticateRequest: mocks.authenticate }));
import { GET, PATCH, POST } from '@/app/api/leads/route';

it('saves, reads and clears a second email, preserving it when an older client omits it', async () => {
  const { db } = testD1();
  await ensureFoundationSchema(db);
  mocks.authenticate.mockResolvedValue({ ok: true, db, session: {
    role: 'owner', user: { id: 'ana', name: 'Ana' }, workspace: { id: 'scout-default' },
    capabilities: { 'records:view_all': true },
  } });
  const url = 'https://scout.test/api/leads';
  const request = (method: string, body: unknown) => new Request(url, { method, body: JSON.stringify(body) });
  const input = {
    name: 'Smile Dental', industry: 'Dental', city: 'Cebu', status: 'New', score: 0,
    owner: 'Ana', last: '', next: '', phone: '', email: 'hello@smile.ph', contact: 'Ana',
    priority: 'Medium', opportunity: '',
  };
  expect((await POST(request('POST', { ...input, secondaryEmail: 'invalid' }))).status).toBe(422);
  const created = await POST(request('POST', { ...input, secondaryEmail: ' appointments@smile.ph ' }));
  expect(created.status).toBe(201);
  const { lead } = await created.json() as { lead: { id: string; version: number } };
  const read = async () => (await GET(new Request(`${url}?id=${lead.id}`))).json();
  expect(await read()).toMatchObject({ lead: { email: input.email, secondaryEmail: 'appointments@smile.ph' } });

  const updated = await PATCH(request('PATCH', { ...input, id: lead.id, version: lead.version, priority: 'High' }));
  expect(updated.status).toBe(200);
  expect(await read()).toMatchObject({ lead: { secondaryEmail: 'appointments@smile.ph' } });

  const cleared = await PATCH(request('PATCH', { ...input, id: lead.id, version: lead.version + 1, secondaryEmail: '' }));
  expect(cleared.status).toBe(200);
  expect(await read()).toMatchObject({ lead: { email: input.email, secondaryEmail: '' } });
});
