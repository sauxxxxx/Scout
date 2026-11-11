import { beforeEach, describe, expect, it, vi } from 'vitest';
import { guessMapping, parseCsv, planLeadImport } from '@/lib/lead-import';
import { ensureFoundationSchema } from '@/lib/foundation-store';
import { testD1 } from './helpers/d1';

const mocks = vi.hoisted(() => ({ authenticate: vi.fn() }));
vi.mock('cloudflare:workers', () => ({ env: {} }));
vi.mock('@/lib/auth', () => ({ authenticateRequest: mocks.authenticate }));
import { POST } from '@/app/api/leads/import/route';

describe('reading a spreadsheet', () => {
  it('reads quoted cells, commas and line breaks the way Excel saves them', () => {
    const table = parseCsv('﻿Business name,Phone,Notes\r\n"Smile, Dental",0912,"Line one\nLine two"\r\n"Say ""hi"" Spa",,\r\n\r\n');
    expect(table).toEqual([['Business name', 'Phone', 'Notes'], ['Smile, Dental', '0912', 'Line one\nLine two'], ['Say "hi" Spa', '', '']]);
  });

  it('reads rows copied from Google Sheets, keeping commas inside cells', () => {
    const copied = 'Business name\tAddress\tNotes\nSmile Dental\t12 Osmeña Blvd, Cebu\t"Two\nlines"\nAna Salon\t\t';
    expect(parseCsv(copied, '\t')).toEqual([['Business name', 'Address', 'Notes'], ['Smile Dental', '12 Osmeña Blvd, Cebu', 'Two\nlines'], ['Ana Salon', '', '']]);
  });

  it('treats copied rows as tab-separated even when the header has commas', () => {
    expect(parseCsv('Name, as listed\tCity\nAna Salon\tDavao', '\t')).toEqual([['Name, as listed', 'City'], ['Ana Salon', 'Davao']]);
  });

  it('reads semicolon files from Excel set to European regions', () => {
    expect(parseCsv('Company;City\nAna Salon;Davao')).toEqual([['Company', 'City'], ['Ana Salon', 'Davao']]);
  });

  it('matches common header names without setup', () => {
    const mapping = guessMapping(['Company Name', 'Category', 'Town', 'Mobile Number', 'E-mail', 'FB Page', 'Contact Person']);
    expect(mapping).toMatchObject({ name: 0, industry: 1, city: 2, phone: 3, email: 4, facebookUrl: 5, contact: 6, country: -1 });
  });

  it('leaves out rows without a name or repeated in the file, and blanks bad emails and links', () => {
    const table = parseCsv('Business,City,Email,Facebook\nAna Salon,,ana@salon.ph,facebook.com/anasalon\n,Cebu,,\nana  salon,Cebu,,\nBen Spa,Davao,not-an-email,https://example.com');
    const plan = planLeadImport(table, guessMapping(table[0]), { industry: 'Salons', city: 'Davao City' });
    expect(plan.rows).toMatchObject([
      { line: 2, name: 'Ana Salon', city: 'Davao City', industry: 'Salons', email: 'ana@salon.ph', facebookUrl: 'https://facebook.com/anasalon', country: 'PH' },
      { line: 5, name: 'Ben Spa', city: 'Davao', email: '', facebookUrl: '' },
    ]);
    expect(plan.missingName).toEqual([3]);
    expect(plan.repeated).toEqual([4]);
    expect(plan.fixes).toHaveLength(2);
  });
});

describe('saving an import batch', () => {
  const W = 'scout-default';
  let store: ReturnType<typeof testD1>;
  const send = (body: unknown) => POST(new Request('https://scout.test/api/leads/import', { method: 'POST', body: JSON.stringify(body) }));
  const row = (line: number, name: string, extra = {}) => ({ line, name, industry: 'Dental clinics', city: 'Cebu', country: 'PH', contact: '', phone: '', email: '', facebookUrl: '', ...extra });

  beforeEach(async () => {
    store = testD1();
    await ensureFoundationSchema(store.db);
    store.sqlite.exec(`INSERT INTO users (id,email,name) VALUES ('u-ana','ana@x.co','Ana'),('u-ben','ben@x.co','Ben')`);
    store.sqlite.exec(`INSERT INTO workspace_memberships (workspace_id,user_id,role) VALUES ('${W}','u-ana','member'),('${W}','u-ben','member')`);
    store.sqlite.exec(`INSERT INTO leads (id,workspace_id,name,industry,city,status,score,owner,last,next,phone,email,contact,priority,opportunity) VALUES ('old','${W}','Old Clinic','Dental','Cebu','Won',0,'Ana','','','','','','Low','')`);
    mocks.authenticate.mockResolvedValue({ ok: true, db: store.db, session: { role: 'member', user: { id: 'u-ana', name: 'Ana' }, workspace: { id: W } } });
  });

  it('adds new leads with a company and contact, and skips ones already in Scout', async () => {
    const response = await send({ ownerId: 'u-ana', status: 'New', priority: 'Medium', rows: [row(2, 'Smile Dental', { phone: '0912', email: 'hi@smile.ph', facebookUrl: 'https://facebook.com/smiledental', contact: 'Dr. Cruz' }), row(3, 'old clinic')] });
    expect(response.status).toBe(200);
    const data = await response.json() as { imported: { name: string; phone: string; email: string; contact: string; facebookUrl?: string; status: string; owner: string }[]; skipped: string[] };
    expect(data.skipped).toEqual(['old clinic']);
    expect(data.imported).toMatchObject([{ name: 'Smile Dental', phone: '0912', email: 'hi@smile.ph', contact: 'Dr. Cruz', facebookUrl: 'https://www.facebook.com/smiledental', status: 'New', owner: 'Ana' }]);
    expect(store.sqlite.prepare("SELECT prospect_at FROM leads WHERE name='Smile Dental'").get()).toEqual({ prospect_at: null });
    expect(store.sqlite.prepare("SELECT COUNT(*) total FROM activities WHERE type='Lead import'").get()).toEqual({ total: 1 });
  });

  it('is safe to retry: a second run of the same rows adds nothing', async () => {
    const body = { ownerId: 'u-ana', status: 'Prospect', priority: 'High', rows: [row(2, 'Smile Dental')] };
    await send(body);
    const again = await (await send(body)).json() as { imported: unknown[]; skipped: string[] };
    expect(again).toEqual({ imported: [], skipped: ['Smile Dental'], phoneMatches: [] });
    expect(store.sqlite.prepare("SELECT COUNT(*) total FROM leads WHERE name='Smile Dental'").get()).toEqual({ total: 1 });
    expect(store.sqlite.prepare("SELECT prospect_at IS NOT NULL counted FROM leads WHERE name='Smile Dental'").get()).toEqual({ counted: 1 });
  });

  it('holds back rows whose phone is already on a lead, unless the rep says they are separate branches', async () => {
    store.sqlite.exec("UPDATE leads SET phone='0917 123 4567' WHERE id='old'");
    const body = { ownerId: 'u-ana', status: 'New', priority: 'Medium', rows: [row(2, 'Old Clinic Branch 2', { phone: '+63 917-123-4567' }), row(3, 'New Spa', { phone: '0918 000 0000' })] };
    const first = await (await send(body)).json() as { imported: { name: string }[]; phoneMatches: { name: string; existing: string }[] };
    expect(first.imported.map(lead => lead.name)).toEqual(['New Spa']);
    expect(first.phoneMatches).toEqual([{ name: 'Old Clinic Branch 2', existing: 'Old Clinic' }]);
    const again = await (await send({ ...body, allowPhoneMatches: true })).json() as { imported: { name: string }[]; skipped: string[] };
    expect(again.imported.map(lead => lead.name)).toEqual(['Old Clinic Branch 2']);
    expect(again.skipped).toEqual(['New Spa']);
  });

  it('stops reps from importing leads for someone else', async () => {
    expect((await send({ ownerId: 'u-ben', status: 'New', priority: 'Medium', rows: [row(2, 'Smile Dental')] })).status).toBe(403);
  });

  it('refuses an owner who is switched out of sales', async () => {
    store.sqlite.exec("UPDATE workspace_memberships SET in_sales=0 WHERE user_id='u-ana'");
    const response = await send({ ownerId: 'u-ana', status: 'New', priority: 'Medium', rows: [row(2, 'Smile Dental')] });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: 'Choose an active sales member as the owner.' });
  });

  it('refuses batches bigger than 25 rows', async () => {
    const rows = Array.from({ length: 26 }, (_, index) => row(index + 2, `Clinic ${index}`));
    expect((await send({ ownerId: 'u-ana', status: 'New', priority: 'Medium', rows })).status).toBe(422);
  });
});
