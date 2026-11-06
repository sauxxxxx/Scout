import { beforeEach, describe, expect, it } from 'vitest';
import { decodeSubject, emailLogAddress, logSentEmail, recipientsOf, validEmailLogDomain } from '@/lib/email-log';
import { ensureFoundationSchema } from '@/lib/foundation-store';
import { gmailComposeUrl } from '@/lib/gmail';
import { testD1 } from './helpers/d1';

const old = '2026-01-01 00:00:00';
const at = new Date('2026-11-06T06:30:00Z');

describe('email tracking', () => {
  let store: ReturnType<typeof testD1>;
  let address: string;
  const lead = (id: string, email: string, owner = 'Ana', company: string | null = null) => store.sqlite.prepare("INSERT INTO leads (id,workspace_id,company_id,name,industry,city,status,score,owner,last,next,phone,email,contact,priority,opportunity,version,changed_at,updated_at) VALUES (?,'w',?,?,'Dental','Cebu','New',0,?,'','','',?,'','Low','',1,?,?)").run(id, company, id, owner, email, old, old);
  const emails = () => store.sqlite.prepare("SELECT lead,type,detail,owner,occurred_at,status FROM activities WHERE type='Email' ORDER BY lead").all() as Record<string, unknown>[];

  beforeEach(async () => {
    store = testD1();
    await ensureFoundationSchema(store.db);
    store.sqlite.exec('PRAGMA foreign_keys=OFF');
    store.sqlite.exec(`INSERT INTO users (id,email,name) VALUES ('u-ana','ana@x.co','Ana')`);
    store.sqlite.exec(`INSERT INTO workspace_memberships (workspace_id,user_id,role) VALUES ('w','u-ana','member')`);
    address = await emailLogAddress(store.db, 'w', 'u-ana', 'mail.scout.test');
  });

  it('gives each rep one private address that stays the same', async () => {
    expect(address).toMatch(/^log-[a-f0-9]{32}@mail\.scout\.test$/);
    expect(await emailLogAddress(store.db, 'w', 'u-ana', 'mail.scout.test')).toBe(address);
  });

  it('logs a sent email to the lead as the rep who sent it', async () => {
    lead('lead-1', 'owner@clinic.com');
    expect(await logSentEmail(store.db, { address, to: 'Owner <OWNER@clinic.com>', subject: 'Your quote', messageId: '<1@mail>', at })).toBe(1);
    expect(emails()).toEqual([{ lead: 'lead-1', type: 'Email', detail: 'Your quote', owner: 'Ana', occurred_at: '2026-11-06T14:30', status: 'Completed' }]);
  });

  it('moves the lead up and updates its last touch', async () => {
    lead('lead-1', 'owner@clinic.com');
    await logSentEmail(store.db, { address, to: 'owner@clinic.com', messageId: '<1@mail>', at });
    const row = store.sqlite.prepare("SELECT changed_at,last_touch_at,version FROM leads WHERE id='lead-1'").get() as { changed_at: string; last_touch_at: string; version: number };
    expect(row.changed_at).not.toBe(old);
    expect(row.last_touch_at).toBe('2026-11-06T14:30');
    expect(row.version).toBe(1);
  });

  it('does not count the same email twice', async () => {
    lead('lead-1', 'owner@clinic.com');
    const sent = { address, to: 'owner@clinic.com', messageId: '<1@mail>', at };
    await logSentEmail(store.db, sent);
    expect(await logSentEmail(store.db, sent)).toBe(0);
    expect(emails()).toHaveLength(1);
  });

  it('counts one email once for each lead it went to', async () => {
    lead('lead-1', 'a@clinic.com');
    lead('lead-2', 'b@spa.com');
    expect(await logSentEmail(store.db, { address, to: 'a@clinic.com', cc: 'b@spa.com, friend@gmail.com', messageId: '<1@mail>', at })).toBe(2);
  });

  it('matches a lead through its contacts', async () => {
    lead('lead-1', '', 'Ana', 'c-1');
    store.sqlite.exec(`INSERT INTO contacts (id,workspace_id,company_id,name,title,email,phone,is_primary,archived) VALUES ('ct-1','w','c-1','Ben','','ben@clinic.com','',0,0)`);
    expect(await logSentEmail(store.db, { address, to: 'ben@clinic.com', messageId: '<1@mail>', at })).toBe(1);
  });

  it('prefers the rep\'s own lead when two leads share an address', async () => {
    lead('other', 'shared@clinic.com', 'Ben');
    lead('mine', 'shared@clinic.com', 'Ana');
    await logSentEmail(store.db, { address, to: 'shared@clinic.com', messageId: '<1@mail>', at });
    expect(emails().map(item => item.lead)).toEqual(['mine']);
  });

  it('ignores people who are not leads', async () => {
    lead('lead-1', 'owner@clinic.com');
    expect(await logSentEmail(store.db, { address, to: 'friend@gmail.com', messageId: '<1@mail>', at })).toBe(0);
    expect(emails()).toEqual([]);
  });

  it('ignores addresses Scout did not hand out', async () => {
    lead('lead-1', 'owner@clinic.com');
    for (const fake of ['log-00000000000000000000000000000000@mail.scout.test', 'hello@mail.scout.test']) expect(await logSentEmail(store.db, { address: fake, to: 'owner@clinic.com', at })).toBe(0);
  });

  it('stops logging for a removed rep', async () => {
    lead('lead-1', 'owner@clinic.com');
    store.sqlite.exec(`UPDATE workspace_memberships SET suspended=1 WHERE user_id='u-ana'`);
    expect(await logSentEmail(store.db, { address, to: 'owner@clinic.com', at })).toBe(0);
  });
});

describe('reading email headers', () => {
  it('finds addresses in any common format', () => {
    expect(recipientsOf('"Santos, Ana" <ana@clinic.com>, BEN@spa.com', 'ana@clinic.com')).toEqual(['ana@clinic.com', 'ben@spa.com']);
    expect(recipientsOf(null, undefined)).toEqual([]);
  });

  it('decodes subjects written in other alphabets', () => {
    expect(decodeSubject('=?UTF-8?B?UHJlc3lvIHNhIOKCsQ==?=')).toBe('Presyo sa ₱');
    expect(decodeSubject('=?UTF-8?Q?Hello_there?= =?UTF-8?Q?_friend?=')).toBe('Hello there friend');
    expect(decodeSubject('Plain subject')).toBe('Plain subject');
    expect(decodeSubject(null)).toBe('');
  });

  it('only accepts a real domain', () => {
    expect(validEmailLogDomain(' Mail.Example.com ')).toBe('mail.example.com');
    for (const bad of ['', undefined, 'localhost', 'a b.com', 'x@y.com']) expect(validEmailLogDomain(bad)).toBeNull();
  });
});

describe('Gmail compose link', () => {
  it('adds the tracking address as BCC only when there is one', () => {
    expect(new URL(gmailComposeUrl('a@b.com', 'rep@x.co', 'log-1@mail.x.co')).searchParams.get('bcc')).toBe('log-1@mail.x.co');
    expect(new URL(gmailComposeUrl('a@b.com', 'rep@x.co')).searchParams.has('bcc')).toBe(false);
  });
});
