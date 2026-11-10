import { describe, expect, it, vi } from 'vitest';
import { ensureFoundationSchema } from '@/lib/foundation-store';
import { importBatches, rotateAssignments } from '@/lib/finder-batches';
import { existingFinderLeads, findDuplicate, possibleDuplicates } from '@/lib/finder-import';
import { loadReport } from '@/lib/report-store';
import { testD1 } from './helpers/d1';

vi.mock('cloudflare:workers', () => ({ env: {} }));

const W = 'workspace-p';
const insertLead = (sqlite: ReturnType<typeof testD1>['sqlite'], id: string, name: string, status: string, city = 'Cebu') =>
  sqlite.prepare("INSERT INTO leads (id,workspace_id,name,industry,city,status,score,owner,last,next,phone,email,contact,priority,opportunity) VALUES (?,?,?,'Dental',?,?,0,'Ana','','','','','','Low','')").run(id, W, name, city, status);
const today = new Date().toISOString().slice(0, 10);
const scope = { workspaceId: W, timezone: 'UTC', owner: '' };
const range = { from: today, to: today, previousFrom: '2000-01-01', previousTo: '2000-01-01' };

describe('prospects', () => {
  it('counts a lead only once someone sets it to Prospect', async () => {
    const { db, sqlite } = testD1();
    await ensureFoundationSchema(db);
    insertLead(sqlite, 'lead-new', 'Added by hand', 'New');
    insertLead(sqlite, 'lead-prospect', 'Added as prospect', 'Prospect');
    expect((await loadReport(db, scope, range)).current.newLeads).toBe(1);

    sqlite.prepare("UPDATE leads SET status='Prospect' WHERE id='lead-new'").run();
    expect((await loadReport(db, scope, range)).current.newLeads).toBe(2);
  });

  it('keeps the first prospect date when the lead moves on', async () => {
    const { db, sqlite } = testD1();
    await ensureFoundationSchema(db);
    insertLead(sqlite, 'lead-a', 'Clinic A', 'Prospect');
    sqlite.prepare("UPDATE leads SET prospect_at='2026-01-02 08:00:00' WHERE id='lead-a'").run();
    sqlite.prepare("UPDATE leads SET status='Contacted' WHERE id='lead-a'").run();
    sqlite.prepare("UPDATE leads SET status='Prospect' WHERE id='lead-a'").run();
    expect(sqlite.prepare("SELECT prospect_at FROM leads WHERE id='lead-a'").get()).toEqual({ prospect_at: '2026-01-02 08:00:00' });
  });
});

describe('matching Finder results to leads by phone', () => {
  it('flags a business with the same phone as a possible existing lead, without treating it as certain', async () => {
    const { db, sqlite } = testD1();
    await ensureFoundationSchema(db);
    insertLead(sqlite, 'lead-p', 'Bright Smile Dental', 'New');
    sqlite.prepare("UPDATE leads SET phone='(032) 123 4567' WHERE id='lead-p'").run();
    const leads = await existingFinderLeads(db, W);
    const prospect = { name: 'Bright Smile Dental Clinic - Lahug', city: 'Cebu', address: '1 Gorordo Ave', phone: '+63 32 123 4567', email: '', website: '', socialUrl: '', provider: 'Google Places', providerRecordId: 'place-9' };
    expect(findDuplicate(prospect, leads)).toBeUndefined();
    expect(possibleDuplicates(prospect, leads).map(lead => lead.id)).toEqual(['lead-p']);
  });
});

describe('counting activities by day', () => {
  it('counts the first and last day of a period, with or without a time, and nothing outside it', async () => {
    const { db, sqlite } = testD1();
    await ensureFoundationSchema(db);
    const insert = sqlite.prepare("INSERT INTO activities (uid,workspace_id,id,lead,type,detail,time,owner,status,occurred_at) VALUES (?,?,?,'Clinic','Call','','','Ana','Completed',?)");
    ['2026-10-31T23:59', '2026-11-01', '2026-11-01T00:00', '2026-11-15T12:30:00.000Z', '2026-11-30T23:59', '2026-11-30 08:00:00', '2026-12-01T00:00'].forEach((at, index) => insert.run(`a-${index}`, W, index + 1, at));
    const report = await loadReport(db, scope, { from: '2026-11-01', to: '2026-11-30', previousFrom: '2026-10-01', previousTo: '2026-10-31' });
    expect(report.current.calls).toBe(5);
    expect(report.previous.calls).toBe(1);
  });
});

describe('adding Finder results in batches', () => {
  it('splits a big selection into requests the server accepts', () => {
    const ids = Array.from({ length: 99 }, (_, index) => `r${index}`);
    const batches = importBatches(ids, 25);
    expect(batches.map(batch => batch.length)).toEqual([25, 25, 25, 24]);
    expect(batches.flat()).toEqual(ids);
  });

  it('shares round robin evenly across batches instead of restarting each one', () => {
    const owners = rotateAssignments(['a', 'b', 'c', 'd', 'e'], ['ana', 'ben']);
    expect(Object.values(owners)).toEqual(['ana', 'ben', 'ana', 'ben', 'ana']);
    expect(rotateAssignments(['a'], [])).toEqual({});
  });
});

describe('matching Finder results to existing leads', () => {
  it('finds the same business by source record or by name, city and address', async () => {
    const { db, sqlite } = testD1();
    await ensureFoundationSchema(db);
    insertLead(sqlite, 'lead-1', 'Smile Dental', 'New');
    sqlite.prepare("UPDATE leads SET finder_provider='Google Places',finder_record_id='place-1',business_address='12 Osmeña Blvd' WHERE id='lead-1'").run();
    insertLead(sqlite, 'lead-2', 'Smile  Dental', 'New');
    sqlite.prepare("UPDATE leads SET business_address='99 Other St' WHERE id='lead-2'").run();
    const leads = await existingFinderLeads(db, W);
    const base = { name: 'Smile Dental', city: 'Cebu', address: '', phone: '', email: '', website: '', socialUrl: '' };

    expect(findDuplicate({ ...base, provider: 'Google Places', providerRecordId: 'place-1' }, leads)?.id).toBe('lead-1');
    expect(findDuplicate({ ...base, provider: 'Other', providerRecordId: 'x', address: '99 other st.' }, leads)?.id).toBe('lead-2');
    expect(findDuplicate({ ...base, name: 'Smile Dental', city: 'Davao', provider: '', providerRecordId: '' }, leads)).toBeUndefined();
    expect(possibleDuplicates({ ...base, provider: 'Other', providerRecordId: 'y', address: '1 New Branch Rd' }, leads).map(lead => lead.id).sort()).toEqual(['lead-1', 'lead-2']);
  });
});
