import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reportFailure } from '@/lib/alerts';
import { formatActivityTime, formatClock, formatDate, setDisplayPreferences } from '@/lib/format';
import { ensureFoundationSchema } from '@/lib/foundation-store';
import { buildLeadFilter, leadColumns, leadJoins, leadOrder, pageParams } from '@/lib/lead-query';
import { testD1 } from './helpers/d1';

const W = 'scout-default';

describe('lead pages', () => {
  let store: ReturnType<typeof testD1>;
  const insert = (id: string, name: string, overrides: Record<string, string | number> = {}) => {
    const row = { industry: 'Dental', city: 'Cebu', status: 'New', score: 50, owner: 'Ana', priority: 'Medium', archived: 0, ...overrides };
    store.sqlite.prepare("INSERT INTO leads (id,workspace_id,name,industry,city,status,score,owner,last,next,phone,email,contact,priority,opportunity,archived,created_at) VALUES (?,?,?,?,?,?,?,?,'','','','','',?,'',?,datetime('now'))").run(id, W, name, row.industry, row.city, row.status, row.score, row.owner, row.priority, row.archived);
  };
  const names = async (search: string, viewer = 'Ana', ownOnly = false) => {
    const params = new URLSearchParams(search);
    const { where, values } = buildLeadFilter(params, W, viewer, ownOnly);
    const { offset, pageSize } = pageParams(params);
    const rows = await store.db.prepare(`SELECT ${leadColumns} ${leadJoins} WHERE ${where} ORDER BY ${leadOrder(params)} LIMIT ? OFFSET ?`).bind(...values, pageSize, offset).all<{ name: string }>();
    return rows.results.map(row => row.name);
  };

  beforeEach(async () => {
    store = testD1();
    await ensureFoundationSchema(store.db);
    insert('a', 'Alpha Dental', { score: 90, priority: 'High' });
    insert('b', 'Beta Hotel', { industry: 'Hotels', owner: 'Ben' });
    insert('c', 'Gamma Dental', { status: 'Proposal', city: 'Mandaue', owner: 'Ben' });
    insert('d', 'Delta Archived', { archived: 1 });
  });

  it('pages through results in a stable order', async () => {
    expect(await names('pageSize=2&page=1')).toEqual(['Alpha Dental', 'Beta Hotel']);
    expect(await names('pageSize=2&page=2')).toEqual(['Gamma Dental']);
  });

  it('applies the same filters as the Leads screen', async () => {
    expect(await names('query=dental')).toEqual(['Alpha Dental', 'Gamma Dental']);
    expect(await names('status=Proposal')).toEqual(['Gamma Dental']);
    expect(await names('owner=Ben&industry=Hotels')).toEqual(['Beta Hotel']);
    expect(await names('minScore=80')).toEqual(['Alpha Dental']);
    expect(await names('view=High+priority')).toEqual(['Alpha Dental']);
    expect(await names('view=Archived')).toEqual(['Delta Archived']);
    expect(await names('view=Assigned+to+me', 'Ben')).toEqual(['Beta Hotel', 'Gamma Dental']);
    expect(await names('status=All+statuses&owner=All+owners')).toHaveLength(3);
  });

  it('sorts on the requested column and refuses unknown ones', async () => {
    expect((await names('sort=score&direction=desc'))[0]).toBe('Alpha Dental');
    expect(leadOrder(new URLSearchParams('sort=1;DROP TABLE leads'))).not.toContain('DROP');
  });

  it('keeps own-records people inside their own records, even when searching', async () => {
    expect(await names('', 'Ben', true)).toEqual(['Beta Hotel', 'Gamma Dental']);
    expect(await names('query=alpha', 'Ben', true)).toEqual([]);
  });

  it('treats search text as text', async () => {
    expect(await names("query=' OR 1=1 --")).toEqual([]);
    expect(await names('query=100%25')).toEqual([]);
  });

  it('caps page size', () => {
    expect(pageParams(new URLSearchParams('pageSize=99999')).pageSize).toBe(200);
    expect(pageParams(new URLSearchParams('page=-3')).page).toBe(1);
  });
});

describe('failure alerts', () => {
  afterEach(() => vi.unstubAllGlobals());
  const config = (db: D1Database) => ({ RESEND_API_KEY: 'key', SCOUT_EMAIL_FROM: 'Scout <a@x.co>', SCOUT_ALERT_EMAIL: 'me@x.co', DB: db });

  it('emails the first failure of a kind and stays quiet for the rest', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { db } = testD1();
    await ensureFoundationSchema(db);
    const failure = { event: 'request_failed', path: '/api/leads', status: 500 };
    expect(await reportFailure(config(db), failure)).toEqual({ sent: true });
    expect(await reportFailure(config(db), failure)).toEqual({ sent: false });
    expect(await reportFailure(config(db), { ...failure, path: '/api/tasks' })).toEqual({ sent: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).subject).toContain('/api/leads');
  });

  it('still logs when no alert address is set', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await reportFailure({}, { event: 'request_crashed' })).toEqual({ sent: false });
    expect(log).toHaveBeenCalled();
  });
});

describe('date settings', () => {
  afterEach(() => setDisplayPreferences({ dateFormat: 'MMM d, yyyy', timeFormat: '12-hour', timezone: 'Asia/Manila' }));

  it('shows a typed activity time exactly as entered, in the chosen format', () => {
    expect(formatActivityTime('2026-04-16T09:30')).toBe('Apr 16, 2026, 9:30 AM');
    setDisplayPreferences({ timeFormat: '24-hour', dateFormat: 'dd/MM/yyyy' });
    expect(formatActivityTime('2026-04-16T21:05')).toBe('16/04/2026, 21:05');
    expect(formatClock(new Date(2026, 3, 16, 21, 5))).toBe('21:05');
  });

  it('falls back when an activity has no real time', () => {
    expect(formatActivityTime(undefined, 'Just now')).toBe('Just now');
  });

  it('keeps plain dates on their calendar day in every timezone', () => {
    setDisplayPreferences({ timezone: 'UTC' });
    expect(formatDate('2026-11-05')).toBe('Nov 5, 2026');
    setDisplayPreferences({ timezone: 'Asia/Manila' });
    expect(formatDate('2026-11-05')).toBe('Nov 5, 2026');
  });
});
