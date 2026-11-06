import { beforeEach, describe, expect, it } from 'vitest';
import { ensureFoundationSchema } from '@/lib/foundation-store';
import { formatTouchTime, setDisplayPreferences } from '@/lib/format';
import { activityDetails, detailsChanged, leadDetails, markCompanyLeadsChanged, markLeadChanged, opportunityDetails, refreshLeadTouch, taskDetails } from '@/lib/lead-touch-store';
import { testD1 } from './helpers/d1';

const old = '2026-01-01 00:00:00';

describe('what moves a lead to the top', () => {
  let store: ReturnType<typeof testD1>;
  const changedAt = (id = 'lead-1') => (store.sqlite.prepare('SELECT changed_at FROM leads WHERE id=?').get(id) as { changed_at: string }).changed_at;
  const lead = (id: string, company: string) => store.sqlite.prepare("INSERT INTO leads (id,workspace_id,company_id,name,industry,city,status,score,owner,last,next,phone,email,contact,priority,opportunity,version,changed_at,updated_at) VALUES (?,'w',?,?,'Dental','Cebu','New',0,'Sam','','','','','','Low','',1,?,?)").run(id, company, id, old, old);
  const activity = (uid: string, occurredAt: string) => store.sqlite.prepare("INSERT INTO activities (uid,workspace_id,id,version,lead,lead_id,type,detail,time,owner,status,occurred_at) VALUES (?,'w',1,1,'lead-1','lead-1','Note','Hi',?,'Sam','Completed',?)").run(uid, occurredAt, occurredAt);

  beforeEach(async () => {
    store = testD1();
    await ensureFoundationSchema(store.db);
    store.sqlite.exec('PRAGMA foreign_keys=OFF');
    lead('lead-1', 'company-1');
    lead('lead-2', 'company-2');
  });

  it('counts a real change and leaves the version alone', async () => {
    await markLeadChanged(store.db, 'w', 'lead-1');
    expect(changedAt()).not.toBe(old);
    expect(changedAt('lead-2')).toBe(old);
    expect((store.sqlite.prepare("SELECT version FROM leads WHERE id='lead-1'").get() as { version: number }).version).toBe(1);
  });

  it('updates a company\'s own leads only', async () => {
    await markCompanyLeadsChanged(store.db, 'w', 'company-2');
    expect(changedAt()).toBe(old);
    expect(changedAt('lead-2')).not.toBe(old);
  });

  it('corrects the last touch without calling it an update', async () => {
    activity('a-1', '2026-11-06T14:07');
    await refreshLeadTouch(store.db, 'w', 'lead-1', 'Note');
    const row = store.sqlite.prepare("SELECT last_touch_at,changed_at FROM leads WHERE id='lead-1'").get() as { last_touch_at: string; changed_at: string };
    expect(row).toEqual({ last_touch_at: '2026-11-06T14:07', changed_at: old });
  });

  it('ignores links Scout fills in behind the scenes', () => {
    const saved = { detail: 'Hi', status: 'Completed', company_id: null, opportunity_id: null, version: 1, updated_at: 'then' };
    expect(detailsChanged(saved, { ...saved, company_id: 'c', opportunity_id: 'o', version: 2, updated_at: 'now' }, activityDetails)).toBe(false);
    expect(detailsChanged({ title: 'Call', status: 'Open', lead_id: 'l' }, { title: 'Call', status: 'Open', lead_id: 'x' }, taskDetails)).toBe(false);
    expect(detailsChanged({ stage: 'New', probability: 10, value: 5 }, { stage: 'Contacted', probability: 25, value: 5 }, opportunityDetails)).toBe(false);
  });

  it('notices every kind of real edit', () => {
    expect(detailsChanged({ detail: 'Hi' }, { detail: 'Hi there' }, activityDetails)).toBe(true);
    expect(detailsChanged({ status: 'Open' }, { status: 'Completed' }, taskDetails)).toBe(true);
    expect(detailsChanged({ deleted_at: null }, { deleted_at: 'now' }, activityDetails)).toBe(true);
    expect(detailsChanged({ owner: 'Sam' }, { owner: 'Lee' }, leadDetails)).toBe(true);
    expect(detailsChanged({ value: null, closeDate: null }, { value: undefined, closeDate: undefined }, leadDetails)).toBe(false);
  });
});

describe('last touch time', () => {
  it('shows the time as it was entered', () => {
    setDisplayPreferences({ timeFormat: '12-hour' });
    expect(formatTouchTime('2026-11-06T14:07').replace(/\s/g, ' ').toLowerCase()).toBe('2:07 pm');
    setDisplayPreferences({ timeFormat: '24-hour' });
    expect(formatTouchTime('2026-11-06T14:07')).toBe('14:07');
    setDisplayPreferences({ timeFormat: '12-hour' });
  });

  it('adds nothing when only a date was saved', () => {
    expect(formatTouchTime('2026-11-06')).toBe('');
    expect(formatTouchTime(null)).toBe('');
  });
});
