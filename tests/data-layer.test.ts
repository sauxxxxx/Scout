import { beforeEach, describe, expect, it } from 'vitest';
import { recordAudit, listAudit } from '@/lib/audit';
import { ensureFoundationSchema, SCHEMA_VERSION } from '@/lib/foundation-store';
import { listNotifications, notifyMember } from '@/lib/notifications';
import { allowRequest } from '@/lib/rate-limit';
import { visibleLeadIds } from '@/lib/record-scope';
import { openRecordCounts, transferOpenRecords } from '@/lib/team-store';
import { testD1 } from './helpers/d1';

const W = 'scout-default';
const lead = (id: string, name: string, owner: string, extra = '') => `INSERT INTO leads (id,workspace_id,name,industry,city,status,score,owner,last,next,phone,email,contact,priority,opportunity${extra ? ',archived' : ''}) VALUES ('${id}','${W}','${name}','Dental','Cebu','${extra === 'won' ? 'Won' : 'New'}',0,'${owner}','','','','','','Low',''${extra ? `,${extra === 'archived' ? 1 : 0}` : ''})`;
const task = (uid: string, owner: string, leadId: string, status = 'Open') => `INSERT INTO tasks (uid,workspace_id,id,title,lead,lead_id,owner,priority,due,time,type,notes,status) VALUES ('${uid}','${W}',${Math.floor(Math.random() * 1e9)},'Call','x','${leadId}','${owner}','Low','Today','09:00','Call','','${status}')`;

describe('schema setup', () => {
  it('runs in full once, then only checks the version', async () => {
    const first = testD1();
    await ensureFoundationSchema(first.db);
    const setupStatements = first.counter.statements;
    expect(setupStatements).toBeGreaterThan(40);

    await ensureFoundationSchema(first.db);
    expect(first.counter.statements).toBe(setupStatements);

    const restarted = testD1();
    restarted.sqlite.exec('CREATE TABLE schema_meta (id INTEGER PRIMARY KEY, version INTEGER NOT NULL, updated_at TEXT)');
    restarted.sqlite.exec(`INSERT INTO schema_meta (id,version) VALUES (1,${SCHEMA_VERSION})`);
    await ensureFoundationSchema(restarted.db);
    expect(restarted.counter.statements).toBeLessThanOrEqual(2);
  });

  it('moves an old database from name keys to id keys without losing leads', async () => {
    const { db, sqlite } = testD1();
    sqlite.exec(`CREATE TABLE leads (name TEXT PRIMARY KEY, industry TEXT NOT NULL, city TEXT NOT NULL, status TEXT NOT NULL, score INTEGER NOT NULL, owner TEXT NOT NULL, last TEXT NOT NULL, next TEXT NOT NULL, phone TEXT NOT NULL, email TEXT NOT NULL, contact TEXT NOT NULL, priority TEXT NOT NULL, opportunity TEXT NOT NULL, value INTEGER, probability INTEGER, close_date TEXT, archived INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    sqlite.exec(`INSERT INTO leads (name,industry,city,status,score,owner,last,next,phone,email,contact,priority,opportunity) VALUES ('Old Clinic','Dental','Cebu','New',80,'Ana','','','','','','Low','')`);
    await ensureFoundationSchema(db);
    const columns = sqlite.prepare('PRAGMA table_info(leads)').all() as { name: string; pk: number }[];
    expect(columns.find(column => column.pk)?.name).toBe('id');
    expect(sqlite.prepare('SELECT name,score FROM leads').all()).toEqual([{ name: 'Old Clinic', score: 80 }]);
  });
});

describe('with a ready database', () => {
  let store: ReturnType<typeof testD1>;
  const actor = (name = 'Ana') => ({ db: store.db, session: { user: { id: 'u-ana', name }, workspace: { id: W } } });

  beforeEach(async () => {
    store = testD1();
    await ensureFoundationSchema(store.db);
    store.sqlite.exec(`INSERT INTO users (id,email,name) VALUES ('u-ana','ana@x.co','Ana'),('u-ben','ben@x.co','Ben')`);
    store.sqlite.exec(`INSERT INTO workspace_memberships (workspace_id,user_id,role) VALUES ('${W}','u-ana','owner'),('${W}','u-ben','member')`);
  });

  it('counts a lead as visible through work attached to it', async () => {
    store.sqlite.exec(lead('own', 'Own', 'Ana'));
    store.sqlite.exec(lead('linked', 'Linked', 'Ben'));
    store.sqlite.exec(lead('other', 'Other', 'Ben'));
    store.sqlite.exec(task('t1', 'Ana', 'linked'));
    expect([...await visibleLeadIds(store.db, W, 'Ana')].sort()).toEqual(['linked', 'own']);
  });

  it('allows the same business name in two workspaces but not twice in one', async () => {
    store.sqlite.exec(lead('a', 'Same', 'Ana'));
    store.sqlite.exec(`INSERT INTO workspaces (id,name) VALUES ('w2','Two')`);
    store.sqlite.exec(lead('b', 'Same', 'Ana').replace(`'${W}'`, `'w2'`));
    expect(() => store.sqlite.exec(lead('c', 'Same', 'Ana'))).toThrow();
  });

  it('hands over open work only', async () => {
    store.sqlite.exec(lead('open', 'Open', 'Ben'));
    store.sqlite.exec(lead('won', 'Won', 'Ben', 'won'));
    store.sqlite.exec(task('t1', 'Ben', 'open'));
    store.sqlite.exec(task('t2', 'Ben', 'open', 'Completed'));
    expect(await openRecordCounts(store.db, W, 'Ben')).toMatchObject({ leads: 1, tasks: 1, total: 2 });
    await store.db.batch(transferOpenRecords(store.db, W, 'Ben', 'Ana'));
    expect(store.sqlite.prepare("SELECT owner FROM leads WHERE id='open'").get()).toMatchObject({ owner: 'Ana' });
    expect(store.sqlite.prepare("SELECT owner FROM leads WHERE id='won'").get()).toMatchObject({ owner: 'Ben' });
    expect(store.sqlite.prepare("SELECT owner FROM tasks WHERE uid='t2'").get()).toMatchObject({ owner: 'Ben' });
  });

  it('stops requests past the limit and starts fresh next window', async () => {
    const now = 1_700_000_000_000;
    expect(await allowRequest(store.db, 'k', 2, 60, now)).toBe(true);
    expect(await allowRequest(store.db, 'k', 2, 60, now)).toBe(true);
    expect(await allowRequest(store.db, 'k', 2, 60, now)).toBe(false);
    expect(await allowRequest(store.db, 'k', 2, 60, now + 61_000)).toBe(true);
  });

  it('records who did what, newest first', async () => {
    await recordAudit(actor(), 'member.removed', 'Ben', 'Open work moved to Ana');
    await recordAudit(actor(), 'settings.updated');
    const entries = await listAudit(store.db, W);
    expect(entries.map(entry => entry.action)).toEqual(['Updated workspace settings', 'Removed']);
    expect(entries[1]).toMatchObject({ actor: 'Ana', target: 'Ben', detail: 'Open work moved to Ana' });
  });

  it('notifies a colleague, never yourself, and respects their setting', async () => {
    await notifyMember(actor(), 'Ben', 'leadAssignments', 'Lead assigned to you', 'Clinic', '?page=leads');
    await notifyMember(actor(), 'Ana', 'leadAssignments', 'Self', '', '');
    expect((await listNotifications(store.db, W, 'u-ben')).map(item => item.title)).toEqual(['Lead assigned to you']);
    expect(await listNotifications(store.db, W, 'u-ana')).toEqual([]);

    store.sqlite.exec(`UPDATE users SET notifications_json='{"leadAssignments":false}' WHERE id='u-ben'`);
    await notifyMember(actor(), 'Ben', 'leadAssignments', 'Muted', '', '');
    expect(await listNotifications(store.db, W, 'u-ben')).toHaveLength(1);
  });
});
