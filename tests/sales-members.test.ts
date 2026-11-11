import { describe, expect, it, vi } from 'vitest';
import { ensureFoundationSchema } from '@/lib/foundation-store';
import { loadReport, loadReportRecords } from '@/lib/report-store';
import { testD1 } from './helpers/d1';

vi.mock('cloudflare:workers', () => ({ env: {} }));

const W = 'scout-default';
const range = { from: '2026-11-01', to: '2026-11-30', previousFrom: '2026-10-01', previousTo: '2026-10-31' };

async function workspace() {
  const store = testD1();
  await ensureFoundationSchema(store.db);
  store.sqlite.exec("INSERT INTO users (id,email,name) VALUES ('u-it','it@x.co','IT Person'),('u-rep','rep@x.co','Real Rep')");
  store.sqlite.exec(`INSERT INTO workspace_memberships (workspace_id,user_id,role) VALUES ('${W}','u-it','owner'),('${W}','u-rep','member')`);
  const call = store.sqlite.prepare("INSERT INTO activities (uid,workspace_id,id,lead,type,detail,time,owner,status,occurred_at) VALUES (?,?,?,'Clinic','Call','','',?,'Completed','2026-11-05T10:00')");
  call.run('a-it-1', W, 1, 'IT Person'); call.run('a-it-2', W, 2, 'IT Person'); call.run('a-rep', W, 3, 'Real Rep');
  return store;
}

describe('people who run Scout but do not sell', () => {
  it('count as sales until someone switches them off', async () => {
    const { db } = await workspace();
    const report = await loadReport(db, { workspaceId: W, timezone: 'UTC', owner: '' }, range);
    expect(report.current.calls).toBe(3);
    expect(report.byRep.map(row => row.name).sort()).toEqual(['IT Person', 'Real Rep']);
  });

  it('are left out of the rep rows, the totals and the records behind them once switched off', async () => {
    const { db, sqlite } = await workspace();
    sqlite.exec(`UPDATE workspace_memberships SET in_sales=0 WHERE user_id='u-it'`);
    const report = await loadReport(db, { workspaceId: W, timezone: 'UTC', owner: '' }, range);
    expect(report.current.calls).toBe(1);
    expect(report.byRep.map(row => row.name)).toEqual(['Real Rep']);
    const records = await loadReportRecords(db, { workspaceId: W, timezone: 'UTC', owner: '' }, 'calls', range.from, range.to);
    expect(records.map(record => record.rep)).toEqual(['Real Rep']);
  });
});

it('counts every completed attempt and drills into only the matching call outcomes', async () => {
  const { db, sqlite } = await workspace();
  sqlite.exec('DELETE FROM activities');
  const log = sqlite.prepare(`INSERT INTO activities
    (uid,workspace_id,id,lead,type,detail,time,owner,status,occurred_at,outcome,deleted_at)
    VALUES (?,?,?,'Clinic',?,?,'','Real Rep',?,'2026-11-05T10:00',?,?)`);
  log.run('connected', W, 1, 'Call', 'Asked about a quote', 'Completed', 'Connected', null);
  log.run('declined', W, 2, 'Call', 'Not interested · Already has a vendor', 'Completed', null, null);
  log.run('unanswered', W, 3, 'Callback', 'Call the clinic · No answer · Try later', 'Completed', null, null);
  log.run('voicemail', W, 4, 'Call', 'Connected', 'Completed', 'Voicemail', null);
  log.run('unknown', W, 5, 'Call', 'Old call without an outcome', 'Completed', null, null);
  log.run('scheduled', W, 6, 'Call', '', 'Scheduled', 'Connected', null);
  log.run('deleted', W, 7, 'Call', '', 'Completed', 'No answer', '2026-11-06');
  log.run('email', W, 8, 'Email', '', 'Completed', 'No answer', null);
  const scope = { workspaceId: W, timezone: 'UTC', owner: '' };
  const report = await loadReport(db, scope, range);
  const counts = { calls: 5, liveCalls: 2, noAnswerCalls: 1 };
  expect(report.current).toMatchObject(counts);
  expect(report.byRep).toMatchObject([{ name: 'Real Rep', ...counts }]);
  expect(report.byDay).toMatchObject([{ day: '2026-11-05', ...counts }]);
  const keys = async (metric: 'calls' | 'liveCalls' | 'noAnswerCalls') =>
    (await loadReportRecords(db, scope, metric, range.from, range.to)).map(row => row.key).sort();
  expect(await keys('calls')).toEqual(['connected', 'declined', 'unanswered', 'unknown', 'voicemail']);
  expect(await keys('liveCalls')).toEqual(['connected', 'declined']);
  expect(await keys('noAnswerCalls')).toEqual(['unanswered']);
});
