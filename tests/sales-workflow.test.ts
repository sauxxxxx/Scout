import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { ensureFoundationSchema } from '@/lib/foundation-store';
import { finderCandidateTarget, finderRequestLimit, finishCell, newSearchState, splitBox } from '@/lib/finder-cells';
import { processFinderJob, mapFinderSearch } from '@/lib/finder-store';
import { formatDaysAgo, formatRelativeTime, localDateTime, parseStamp } from '@/lib/format';
import { gmailComposeUrl } from '@/lib/gmail';
import { buildSpreadsheet } from '@/lib/google-sheets';
import { isTouchActivity, matchesTouch, touchRange } from '@/lib/last-touch';
import { leadsToCsv, leadsToRows } from '@/lib/lead-export';
import { buildLeadFilter, leadOrder, ownScope } from '@/lib/lead-query';
import { conversionRate, describeChange, periodRange, trendBuckets } from '@/lib/overview-period';
import { defaultRolePermissions, resolveCapabilities } from '@/lib/permissions';
import { scopeActivities, scopeWorkspace } from '@/lib/record-scope';

import { testD1 } from './helpers/d1';

const lead = { name: '=HYPERLINK("x")', industry: 'Dental', city: 'Cebu', status: 'New', score: 0, owner: 'Ana', contact: '', phone: '', email: '', priority: 'High', next: '', lastTouchAt: '2026-11-03T14:30' };

describe('who can see which leads', () => {
  it('limits reps and viewers, and leaves admins and owners with everything', () => {
    expect(resolveCapabilities('member')['records:view_all']).toBe(false);
    expect(resolveCapabilities('viewer')['records:view_all']).toBe(false);
    expect(resolveCapabilities('admin')['records:view_all']).toBe(true);
    expect(resolveCapabilities('owner')['records:view_all']).toBe(true);
    expect(defaultRolePermissions.member['records:export']).toBe(true);
  });

  it('counts only ownership and open tasks as reasons to see a lead', () => {
    const scope = ownScope('w', 'Ana');
    expect(scope.sql).toContain("status!='Completed'");
    expect(scope.sql).not.toMatch(/opportunities|activities/);
    expect(buildLeadFilter(new URLSearchParams(), 'w', 'Ana', true).where).toContain('leads.owner=?');
  });

  it('hides a handed-over lead from its old owner, even work they did on it', () => {
    const data = {
      leads: [{ id: 'mine', owner: 'Ana', companyId: 'c1' }, { id: 'theirs', owner: 'Ben', companyId: 'c2' }],
      tasks: [{ owner: 'Ana', leadId: 'theirs' }, { owner: 'Ben', leadId: 'mine' }],
      companies: [{ id: 'c1', owner: 'Ana' }, { id: 'c2', owner: 'Ben' }],
      contacts: [{ companyId: 'c1' }, { companyId: 'c2' }],
      opportunities: [{ owner: 'Ana', leadId: 'theirs', companyId: 'c2' }, { owner: 'Ben', leadId: 'mine', companyId: 'c1' }],
    };
    const seen = scopeWorkspace(data, 'Ana', new Set(['mine']));
    expect(seen.leads.map(item => item.id)).toEqual(['mine']);
    expect(seen.tasks.map(item => item.leadId)).toEqual(['mine']);
    expect(seen.opportunities.map(item => item.leadId)).toEqual(['mine']);
    expect(seen.contacts).toEqual([{ companyId: 'c1' }]);
    expect(scopeActivities([{ owner: 'Ana', leadId: 'theirs' }, { owner: 'Ben', leadId: 'mine' }], 'Ana', new Set(['mine']))).toEqual([{ owner: 'Ben', leadId: 'mine' }]);
  });
});

describe('last touch', () => {
  it('counts contact with the customer, not admin work or plans', () => {
    expect(isTouchActivity({ type: 'Note', occurredAt: '2026-11-05T09:00' })).toBe(true);
    expect(isTouchActivity({ type: 'call', occurredAt: '2026-11-05T09:00' })).toBe(true);
    expect(isTouchActivity({ type: 'Assignment', occurredAt: '2026-11-05T09:00' })).toBe(false);
    expect(isTouchActivity({ type: 'Call', status: 'Scheduled', occurredAt: '2026-11-05T09:00' })).toBe(false);
    expect(isTouchActivity({ type: 'Call', deletedAt: 'x', occurredAt: '2026-11-05T09:00' })).toBe(false);
  });

  it('filters by date, by neglect and by never contacted', () => {
    const today = '2026-11-05';
    expect(matchesTouch('2026-11-05T09:00', touchRange('Today', today))).toBe(true);
    expect(matchesTouch('2026-11-04T09:00', touchRange('Today', today))).toBe(false);
    expect(matchesTouch('2026-10-30T09:00', touchRange('Last 7 days', today))).toBe(true);
    expect(matchesTouch('2026-10-29T09:00', touchRange('Last 7 days', today))).toBe(false);
    expect(matchesTouch('2026-10-20T09:00', touchRange('No touch in 14+ days', today))).toBe(true);
    expect(matchesTouch(undefined, touchRange('No touch in 14+ days', today))).toBe(true);
    expect(matchesTouch('2026-11-01T09:00', touchRange('No touch in 14+ days', today))).toBe(false);
    expect(matchesTouch(undefined, touchRange('Never touched', today))).toBe(true);
    expect(matchesTouch('2026-11-01T09:00', touchRange('Never touched', today))).toBe(false);
    expect(matchesTouch('2026-11-01T09:00', touchRange('Custom range', today, { from: '2026-11-02' }))).toBe(false);
    expect(matchesTouch(undefined, touchRange('Any last touch', today))).toBe(true);
  });

  it('sorts and filters on the server with the same rules', () => {
    const params = new URLSearchParams({ touchBefore: '2026-10-23', sort: 'recent', direction: 'desc' });
    const { where, values } = buildLeadFilter(params, 'w', 'Ana', false);
    expect(where).toContain('leads.last_touch_at IS NULL OR substr(leads.last_touch_at,1,10)<?');
    expect(values).toContain('2026-10-23');
    expect(leadOrder(params)).toContain('COALESCE(leads.changed_at,leads.updated_at) DESC');
    expect(leadOrder(new URLSearchParams({ sort: 'lastTouch' }))).toContain('leads.last_touch_at');
  });
});

describe('activity times', () => {
  const at = (minutesAgo: number, now: number) => localDateTime(new Date(now - minutesAgo * 60000));
  const noon = new Date(2026, 10, 5, 12, 0).getTime();

  it('keeps counting instead of staying on "Just now"', () => {
    expect(formatRelativeTime(at(0, noon), '', noon)).toBe('Just now');
    expect(formatRelativeTime(at(5, noon), '', noon)).toBe('5 min ago');
    expect(formatRelativeTime(at(59, noon), '', noon)).toBe('59 min ago');
    expect(formatRelativeTime(at(150, noon), '', noon)).toMatch(/^Today, 9:30/i);
    expect(formatRelativeTime(at(24 * 60, noon), '', noon)).toMatch(/^Yesterday, 12:00/i);
    expect(formatRelativeTime(at(3 * 24 * 60, noon), '', noon)).toMatch(/Nov/);
  });

  it('shows the fallback when there is no time, and full dates for the future', () => {
    expect(formatRelativeTime(undefined, 'Not contacted yet', noon)).toBe('Not contacted yet');
    expect(formatRelativeTime('2026-12-01T10:00', '', noon)).toMatch(/Dec/);
  });

  it('reads database timestamps as UTC', () => {
    expect(parseStamp('2026-11-05 04:00:00')?.toISOString()).toBe('2026-11-05T04:00:00.000Z');
    expect(parseStamp('nonsense')).toBeNull();
  });

  it('counts calendar days', () => {
    expect(formatDaysAgo(at(10, noon), noon)).toBe('Today');
    expect(formatDaysAgo(at(13 * 60, noon), noon)).toBe('Yesterday');
    expect(formatDaysAgo(at(5 * 24 * 60, noon), noon)).toBe('5 days ago');
  });
});

describe('overview periods', () => {
  it('uses calendar periods with weeks starting Monday', () => {
    expect(periodRange('Daily', '2026-11-05')).toMatchObject({ from: '2026-11-05', to: '2026-11-05', previousFrom: '2026-11-04', label: 'Today' });
    expect(periodRange('Weekly', '2026-11-05')).toMatchObject({ from: '2026-11-02', to: '2026-11-08', previousFrom: '2026-10-26', previousTo: '2026-11-01' });
    expect(periodRange('Monthly', '2026-11-05')).toMatchObject({ from: '2026-11-01', to: '2026-11-30', previousFrom: '2026-10-01', previousTo: '2026-10-31' });
    expect(periodRange('Quarterly', '2026-11-05')).toMatchObject({ from: '2026-10-01', to: '2026-12-31', previousFrom: '2026-07-01', label: 'Q4 2026' });
    expect(periodRange('Yearly', '2026-11-05')).toMatchObject({ from: '2026-01-01', to: '2026-12-31', previousFrom: '2025-01-01', label: '2026' });
  });

  it('steps back across year boundaries', () => {
    expect(periodRange('Monthly', '2026-01-15', -1)).toMatchObject({ from: '2025-12-01', to: '2025-12-31' });
    expect(periodRange('Quarterly', '2026-02-15', -1)).toMatchObject({ from: '2025-10-01', to: '2025-12-31', label: 'Q4 2025' });
    expect(periodRange('Weekly', '2026-11-05', -1).from).toBe('2026-10-26');
  });

  it('groups the trend by a sensible unit', () => {
    const series = [{ day: '2026-03-02', value: 100 }, { day: '2026-03-20', value: 50 }, { day: '2026-07-01', value: 25 }];
    expect(trendBuckets('Daily', { from: '2026-03-02', to: '2026-03-02' }, series)).toEqual([]);
    const year = trendBuckets('Yearly', { from: '2026-01-01', to: '2026-12-31' }, series);
    expect(year).toHaveLength(12);
    expect(year[2].value).toBe(150);
    expect(trendBuckets('Weekly', { from: '2026-03-02', to: '2026-03-08' }, series)).toHaveLength(7);
    expect(trendBuckets('Quarterly', { from: '2026-01-01', to: '2026-03-31' }, series).reduce((sum, item) => sum + item.value, 0)).toBe(150);
  });

  it('never reports a percentage of nothing', () => {
    expect(describeChange(5, 0, 'October 2026')).toBe('None in October 2026');
    expect(describeChange(0, 0, 'October 2026')).toBe('Same as October 2026');
    expect(describeChange(15, 10, 'October')).toBe('Up 50% from October');
    expect(describeChange(5, 10, 'October')).toBe('Down 50% from October');
    expect(describeChange(60, 50, 'October', 'points')).toBe('Up 10 pts from October');
    expect(conversionRate({ wonCount: 1, lostCount: 3 })).toBe(25);
    expect(conversionRate({ wonCount: 0, lostCount: 0 })).toBe(0);
  });
});

describe('email and export', () => {
  it('opens Gmail compose with the address and the rep\'s own account', () => {
    const url = new URL(gmailComposeUrl('hello+sales@example.com', 'rep@company.com'));
    expect(url.origin).toBe('https://mail.google.com');
    expect(url.searchParams.get('view')).toBe('cm');
    expect(url.searchParams.get('to')).toBe('hello+sales@example.com');
    expect(url.searchParams.get('authuser')).toBe('rep@company.com');
    expect(new URL(gmailComposeUrl('a@b.com', 'x@local.scout')).searchParams.has('authuser')).toBe(false);
  });

  it('includes last touch and keeps formulas harmless', () => {
    expect(leadsToCsv([lead])).toContain('Last touch');
    expect(leadsToCsv([lead])).toContain('2026-11-03 14:30');
    expect(leadsToCsv([lead])).toContain(`"'=HYPERLINK(""x"")"`);
    const sheet = buildSpreadsheet('Scout leads', leadsToRows([lead]));
    const rows = sheet.sheets[0].data[0].rowData;
    expect(rows[0].values[0].userEnteredValue).toEqual({ stringValue: 'Business' });
    expect(rows[1].values[0].userEnteredValue).toEqual({ stringValue: '=HYPERLINK("x")' });
    expect(JSON.stringify(sheet)).not.toContain('formulaValue');
    expect(sheet.sheets[0].properties.gridProperties.frozenRowCount).toBe(1);
  });
});

describe('Finder at volume', () => {
  it('limits what one search can spend', () => {
    expect(finderCandidateTarget(20)).toBe(40);
    expect(finderCandidateTarget(100)).toBe(120);
    expect(finderRequestLimit(20)).toBe(8);
    expect(finderRequestLimit(100)).toBe(24);
    expect(finderRequestLimit(300)).toBe(72);
  });

  it('splits any area with businesses in it, because Google under-reports them', () => {
    const quiet = newSearchState();
    quiet.cellPlaces = 2;
    finishCell(quiet, { latitude: 10, longitude: 124, radiusKm: 10 });
    expect(quiet.cells).toEqual([]);
    const busy = newSearchState();
    busy.cellPlaces = 12;
    finishCell(busy, { latitude: 10, longitude: 124, radiusKm: 10 });
    expect(busy.cells).toHaveLength(4);
    expect(busy.cellPlaces).toBe(0);
    expect(splitBox({ south: 10, north: 10.01, west: 124, east: 124.01 })).toEqual([]);
  });

  const harness = () => {
    const sql = new DatabaseSync(':memory:');
    for (const file of ['0006_real_finder.sql', '0007_gemini_finder.sql', '0010_finder_map.sql']) sql.exec(readFileSync(`db/migrations/${file}`, 'utf8'));
    sql.exec('CREATE TABLE companies (id TEXT PRIMARY KEY,workspace_id TEXT)');
    sql.exec(readFileSync('db/migrations/0011_finder_radius_facebook.sql', 'utf8'));
    sql.exec('CREATE TABLE leads (id TEXT, workspace_id TEXT)');
    sql.exec(readFileSync('db/migrations/0013_finder_sales_review.sql', 'utf8'));
    sql.exec("CREATE TABLE opportunities (id TEXT)");
    sql.exec(readFileSync('db/migrations/0016_sales_workflow.sql', 'utf8')); sql.exec(readFileSync('db/migrations/0025_finder_channels.sql', 'utf8'));
    const statement = (query: string, values: SQLInputValue[] = []) => ({
      bind: (...args: SQLInputValue[]) => statement(query, args),
      first: async () => sql.prepare(query).get(...values) || null,
      all: async () => ({ results: sql.prepare(query).all(...values) }),
      run: async () => ({ meta: { changes: Number(sql.prepare(query).run(...values).changes) } }),
    });
    const db = { prepare: statement, batch: async (queries: ReturnType<typeof statement>[]) => Promise.all(queries.map(query => query.run())) } as unknown as D1Database;
    const addSearch = (id: string, target: number, extra = 0) => sql.prepare(`INSERT INTO finder_searches (id,workspace_id,created_by,name,industry,location,target_count,requirements_json,status,map_area_json,include_found) VALUES (?,'w','u','Dentists','Dentists','Cebu',?,'["Phone"]','Queued',?,?)`).run(id, target, JSON.stringify({ latitude: 10.3, longitude: 123.9, radiusKm: 10 }), extra);
    return { sql, db, addSearch };
  };
  const place = (id: string) => ({ id, displayName: { text: `Clinic ${id}` }, googleMapsUri: `https://maps.google.com/?cid=${id}`, internationalPhoneNumber: `+63 ${id}`, location: { latitude: 10.3, longitude: 123.9 }, businessStatus: 'OPERATIONAL' });

  /** Google's behaviour: 20 a page, three pages at most, and the same answer every time. */
  const googleLike = () => vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { pageToken?: string; locationRestriction?: { rectangle: { low: { latitude: number; longitude: number } } } };
    const page = Number(body.pageToken || 0);
    const low = body.locationRestriction?.rectangle.low;
    const prefix = low ? `${low.latitude.toFixed(3)}x${low.longitude.toFixed(3)}` : 'root';
    return Response.json({ places: Array.from({ length: 20 }, (_, index) => place(`${prefix}-${page}-${index}`)), ...(page < 2 ? { nextPageToken: String(page + 1) } : {}) });
  });

  it('reaches past Google\'s per-search cap and stays under the spending limit', async () => {
    const { sql, db, addSearch } = harness();
    addSearch('big', 100);
    const fetcher = googleLike();
    vi.stubGlobal('fetch', fetcher);
    try {
      await processFinderJob(db, 'w', 'big', { googlePlacesApiKey: 'k', aiMaxCandidates: 0 });
      const search = mapFinderSearch(sql.prepare("SELECT * FROM finder_searches WHERE id='big'").get()!);
      expect(search.status).toBe('Complete');
      expect(search.foundCount).toBe(100);
      expect(fetcher.mock.calls.length).toBeLessThanOrEqual(finderRequestLimit(100));
      expect(fetcher.mock.calls.length).toBeGreaterThan(3);
      expect(search.coverage).toBe('target');
    } finally { vi.unstubAllGlobals(); sql.close(); }
  });

  it('leaves out businesses already found and finds different ones next time', async () => {
    const { sql, db, addSearch } = harness();
    addSearch('first', 20);
    addSearch('second', 20);
    vi.stubGlobal('fetch', googleLike());
    try {
      await processFinderJob(db, 'w', 'first', { googlePlacesApiKey: 'k', aiMaxCandidates: 0 });
      await processFinderJob(db, 'w', 'second', { googlePlacesApiKey: 'k', aiMaxCandidates: 0 });
      const ids = (id: string) => (sql.prepare('SELECT provider_record_id p FROM finder_results WHERE search_id=?').all(id) as { p: string }[]).map(row => row.p);
      expect(ids('first')).toHaveLength(20);
      expect(ids('second').length).toBeGreaterThan(0);
      expect(ids('second').filter(id => ids('first').includes(id))).toEqual([]);
      const second = mapFinderSearch(sql.prepare("SELECT * FROM finder_searches WHERE id='second'").get()!);
      expect(second.hiddenFoundCount).toBeGreaterThan(0);
    } finally { vi.unstubAllGlobals(); sql.close(); }
  });

  it('remembers only what was shown, keeps memory after a search is deleted, and can include found businesses', async () => {
    const { sql, db, addSearch } = harness();
    addSearch('first', 10);
    addSearch('again', 10, 1);
    vi.stubGlobal('fetch', googleLike());
    try {
      await processFinderJob(db, 'w', 'first', { googlePlacesApiKey: 'k', aiMaxCandidates: 0 });
      expect((sql.prepare('SELECT COUNT(*) n FROM finder_seen_places').get() as { n: number }).n).toBe(10);
      sql.exec("DELETE FROM finder_results WHERE search_id='first'");
      expect((sql.prepare('SELECT COUNT(*) n FROM finder_seen_places').get() as { n: number }).n).toBe(10);
      await processFinderJob(db, 'w', 'again', { googlePlacesApiKey: 'k', aiMaxCandidates: 0 });
      const again = mapFinderSearch(sql.prepare("SELECT * FROM finder_searches WHERE id='again'").get()!);
      expect(again.includeFound).toBe(true);
      expect(again.hiddenFoundCount).toBe(0);
    } finally { vi.unstubAllGlobals(); sql.close(); }
  });

  it('says so when an area runs out', async () => {
    const { sql, db, addSearch } = harness();
    addSearch('small', 100);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ places: [place('only-one')] })));
    try {
      await processFinderJob(db, 'w', 'small', { googlePlacesApiKey: 'k', aiMaxCandidates: 0 });
      const search = mapFinderSearch(sql.prepare("SELECT * FROM finder_searches WHERE id='small'").get()!);
      expect(search.coverage).toBe('complete');
      expect(search.foundCount).toBe(1);
    } finally { vi.unstubAllGlobals(); sql.close(); }
  });

  it('hands long searches to a fresh run and carries on where it stopped', async () => {
    const { sql, db, addSearch } = harness();
    addSearch('long', 300);
    const fetcher = googleLike();
    vi.stubGlobal('fetch', fetcher);
    const requeue = vi.fn(async () => undefined);
    try {
      await processFinderJob(db, 'w', 'long', { googlePlacesApiKey: 'k', aiMaxCandidates: 0 }, requeue);
      expect(requeue).toHaveBeenCalledOnce();
      expect(fetcher.mock.calls).toHaveLength(6);
      expect(mapFinderSearch(sql.prepare("SELECT * FROM finder_searches WHERE id='long'").get()!).status).toBe('Queued');
      for (let run = 0; run < 5; run += 1) await processFinderJob(db, 'w', 'long', { googlePlacesApiKey: 'k', aiMaxCandidates: 0 }, requeue);
      const finished = mapFinderSearch(sql.prepare("SELECT * FROM finder_searches WHERE id='long'").get()!);
      expect(finished.status).toBe('Complete');
      expect(finished.foundCount).toBe(300);
    } finally { vi.unstubAllGlobals(); sql.close(); }
  });
});

describe('upgrading an existing workspace', () => {
  it('moves everyone to the new rules once, and never undoes a later choice by an owner', async () => {
    const { db, sqlite } = testD1();
    await ensureFoundationSchema(db);
    const seeAll = { 'finder:run': true, 'records:delete': true, 'records:export': true, 'records:view_all': true };
    sqlite.exec(`INSERT INTO workspace_settings (workspace_id,role_permissions_json) VALUES ('scout-default','${JSON.stringify({ member: seeAll, viewer: seeAll })}')`);
    sqlite.exec(`INSERT INTO workspace_custom_roles (id,workspace_id,name,base_role,permissions_json) VALUES ('role','scout-default','Team lead','member','${JSON.stringify(seeAll)}')`);
    sqlite.exec(`INSERT INTO users (id,email,name,preferences_json) VALUES ('kept','a@b.c','Kept','{"finderLeadCount":40}'),('moved','d@e.f','Moved','{"finderLeadCount":20}')`);
    sqlite.exec("INSERT INTO leads (id,workspace_id,name,industry,city,status,score,owner,last,next,phone,email,contact,priority,opportunity,updated_at) VALUES ('l1','scout-default','Clinic','Dental','Cebu','New',0,'Ana','','','','','','Low','','2026-01-02 03:04:05')");
    sqlite.exec("INSERT INTO activities (uid,workspace_id,id,lead,lead_id,type,detail,time,owner,status,created_at) VALUES ('a1','scout-default',1,'Clinic','l1','Note','x','Just now','Ana','Completed','2026-11-05 01:30:00')");
    sqlite.exec("INSERT INTO activities (uid,workspace_id,id,lead,lead_id,type,detail,time,owner,status,occurred_at) VALUES ('a2','scout-default',2,'Clinic','l1','Status change','x','t','Ana','Completed','2026-12-01T10:00')");
    sqlite.exec('PRAGMA foreign_keys=OFF');
    const required = (sqlite.prepare('PRAGMA table_info(finder_results)').all() as { name: string; type: string; notnull: number; dflt_value: unknown }[]).filter(column => column.notnull && column.dflt_value === null);
    const known: Record<string, unknown> = { id: 'r1', workspace_id: 'scout-default', search_id: 's1', provider: 'Google Places', provider_record_id: 'place-1' };
    sqlite.prepare(`INSERT INTO finder_results (${required.map(column => column.name).join(',')}) VALUES (${required.map(() => '?').join(',')})`).run(...required.map(column => (known[column.name] ?? (/INT|REAL/.test(column.type) ? 0 : 'x')) as string));
    sqlite.exec('UPDATE schema_meta SET version=16');

    await ensureFoundationSchema(Object.create(db) as D1Database);

    const settings = sqlite.prepare('SELECT role_permissions_json j FROM workspace_settings').get() as { j: string };
    expect(JSON.parse(settings.j).member['records:view_all']).toBe(false);
    expect(JSON.parse(settings.j).member['records:export']).toBe(true);
    expect(JSON.parse((sqlite.prepare('SELECT permissions_json j FROM workspace_custom_roles').get() as { j: string }).j)['records:view_all']).toBe(false);
    expect((sqlite.prepare("SELECT occurred_at o FROM activities WHERE uid='a1'").get() as { o: string }).o).toBe('2026-11-05T09:30');
    const row = sqlite.prepare("SELECT last_touch_at t,changed_at c FROM leads WHERE id='l1'").get() as { t: string; c: string };
    expect(row).toEqual({ t: '2026-11-05T09:30', c: '2026-01-02 03:04:05' });
    expect((sqlite.prepare('SELECT COUNT(*) n FROM finder_seen_places').get() as { n: number }).n).toBe(1);
    expect(JSON.parse((sqlite.prepare("SELECT preferences_json j FROM users WHERE id='moved'").get() as { j: string }).j).finderLeadCount).toBe(100);
    expect(JSON.parse((sqlite.prepare("SELECT preferences_json j FROM users WHERE id='kept'").get() as { j: string }).j).finderLeadCount).toBe(40);

    sqlite.exec(`UPDATE workspace_settings SET role_permissions_json='${JSON.stringify({ member: seeAll, viewer: seeAll })}'`);
    await ensureFoundationSchema(Object.create(db) as D1Database);
    expect(JSON.parse((sqlite.prepare('SELECT role_permissions_json j FROM workspace_settings').get() as { j: string }).j).member['records:view_all']).toBe(true);
  });
});
