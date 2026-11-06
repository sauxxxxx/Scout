import { defaultCustomization } from '@/lib/customization';
import { describe, expect, it } from 'vitest';
import { leadsToCsv } from '@/lib/lead-export';
import { canChangeRole, canInviteMembers, defaultRolePermissions, permissionAllowed, resolveCapabilities } from '@/lib/permissions';
import { formatSender } from '@/lib/invitation-email';
import { scopeActivities, scopeWorkspace } from '@/lib/record-scope';
import { customRoleInputSchema, inviteOrigin, invitationInputSchema, isDomainAllowed, maskEmail, parseInviteEmails, parseWorkspaceSettings, workspaceSettingsSchema } from '@/lib/team';

describe('role changes', () => {
  it('stops an admin demoting or promoting an owner', () => {
    expect(canChangeRole('admin', 'owner', 'member')).toBe(false);
    expect(canChangeRole('admin', 'member', 'owner')).toBe(false);
    expect(canChangeRole('admin', 'member', 'viewer')).toBe(true);
    expect(canChangeRole('owner', 'owner', 'member')).toBe(true);
    expect(canChangeRole('member', 'viewer', 'member')).toBe(false);
  });
});

describe('capabilities', () => {
  it('always gives owners and admins everything, whatever the workspace turned off', () => {
    const locked = { member: { ...defaultRolePermissions.member, 'finder:run': false }, viewer: defaultRolePermissions.viewer };
    expect(resolveCapabilities('admin', locked)['finder:run']).toBe(true);
    expect(resolveCapabilities('member', locked)['finder:run']).toBe(false);
  });

  it('applies a custom role on top of its base role', () => {
    expect(resolveCapabilities('member', defaultRolePermissions, { 'records:view_all': false })).toMatchObject({ 'records:view_all': false, 'finder:run': true });
  });

  it('never lets a viewer run Finder or delete, even if a role says so', () => {
    expect(resolveCapabilities('viewer', defaultRolePermissions, { 'finder:run': true, 'records:delete': true })).toMatchObject({ 'finder:run': false, 'records:delete': false });
  });

  it('checks base roles and capabilities through one gate', () => {
    const access = { role: 'viewer' as const, capabilities: resolveCapabilities('viewer'), canInvite: false };
    expect(permissionAllowed(access, 'records:read')).toBe(true);
    expect(permissionAllowed(access, 'records:write')).toBe(false);
    expect(permissionAllowed(access, 'records:export')).toBe(false);
    expect(permissionAllowed(access, 'users:invite')).toBe(false);
  });

  it('lets a workspace stop admins inviting without affecting owners', () => {
    expect(canInviteMembers('admin', true)).toBe(true);
    expect(canInviteMembers('admin', false)).toBe(false);
    expect(canInviteMembers('owner', false)).toBe(true);
    expect(canInviteMembers('member', true)).toBe(false);
  });
});

describe('own-records scope', () => {
  const data = {
    leads: [{ id: 'mine', owner: 'Ana', companyId: 'c1' }, { id: 'linked', owner: 'Ben', companyId: 'c2' }, { id: 'other', owner: 'Ben', companyId: 'c3' }],
    tasks: [{ owner: 'Ana', leadId: 'linked' }, { owner: 'Ben', leadId: 'other' }, { owner: 'Ben', leadId: 'mine' }],
    companies: [{ id: 'c1', owner: 'Ben' }, { id: 'c2', owner: 'Ben' }, { id: 'c3', owner: 'Ben' }],
    contacts: [{ companyId: 'c1' }, { companyId: 'c3' }],
    opportunities: [{ owner: 'Ben', leadId: 'other', companyId: 'c3' }, { owner: 'Ben', leadId: 'mine', companyId: 'c1' }],
  };

  it('keeps linked leads so tasks can still sync, and hides everyone else’s work', () => {
    const scoped = scopeWorkspace(data, 'Ana', new Set(['mine', 'linked']));
    expect(scoped.leads.map(lead => lead.id)).toEqual(['mine', 'linked']);
    expect(scoped.tasks).toHaveLength(2);
    expect(scoped.companies.map(company => company.id)).toEqual(['c1', 'c2']);
    expect(scoped.contacts).toEqual([{ companyId: 'c1' }]);
    expect(scoped.opportunities).toHaveLength(1);
  });

  it('every task a person can see has its lead loaded', () => {
    const scoped = scopeWorkspace(data, 'Ana', new Set(['mine', 'linked']));
    const loaded = new Set(scoped.leads.map(lead => lead.id));
    expect(scoped.tasks.every(task => loaded.has(task.leadId))).toBe(true);
  });

  it('scopes activities the same way', () => {
    const activities = [{ owner: 'Ana', leadId: 'mine' }, { owner: 'Ben', leadId: 'mine' }, { owner: 'Ben', leadId: 'other' }];
    expect(scopeActivities(activities, 'Ana', new Set(['mine']))).toHaveLength(2);
  });
});

describe('invitations', () => {
  it('masks the address shown to anyone holding the link', () => {
    expect(maskEmail('reamar@gmail.com')).toBe('r***r@gmail.com');
    expect(maskEmail('al@x.co')).toBe('a***@x.co');
  });

  it('splits, cleans and dedupes pasted addresses', () => {
    expect(parseInviteEmails('A@x.com, b@x.com;\na@x.com nope')).toEqual({ valid: ['a@x.com', 'b@x.com'], invalid: ['nope'] });
  });

  it('builds links for the app that created the invite', () => {
    expect(inviteOrigin('http://localhost:3000/api/users', 'https://scoutcrm.pages.dev')).toBe('http://localhost:3000');
    expect(inviteOrigin('http://scout.localhost:3000/api/users', 'https://scoutcrm.pages.dev')).toBe('http://scout.localhost:3000');
    expect(inviteOrigin('https://scout.example.workers.dev/api/users', 'https://scoutcrm.pages.dev/')).toBe('https://scoutcrm.pages.dev');
  });

  it('enforces allowed domains only when some are set', () => {
    expect(isDomainAllowed('a@any.com', [])).toBe(true);
    expect(isDomainAllowed('a@EXAMPLE.com', ['example.com'])).toBe(true);
    expect(isDomainAllowed('a@notexample.com', ['example.com'])).toBe(false);
  });

  it('limits a single invite request and only accepts real expiry options', () => {
    const base = { role: 'member', emails: ['a@x.com'] };
    expect(invitationInputSchema.safeParse(base).data?.expiresInDays).toBe(7);
    expect(invitationInputSchema.safeParse({ ...base, expiresInDays: 3 }).success).toBe(false);
    expect(invitationInputSchema.safeParse({ ...base, emails: Array.from({ length: 21 }, (_, i) => `a${i}@x.com`) }).success).toBe(false);
  });

  it('changes the display name without changing the sending address', () => {
    expect(formatSender('Scout <invites@x.com>', 'Joyno Sales')).toBe('"Joyno Sales" <invites@x.com>');
    expect(formatSender('invites@x.com', 'Joyno')).toBe('"Joyno" <invites@x.com>');
    expect(formatSender('Scout <invites@x.com>', '')).toBe('Scout <invites@x.com>');
    expect(formatSender('invites@x.com', 'A"\r\nBcc: x@y.z')).not.toMatch(/[\r\n]/);
  });
});

describe('workspace settings', () => {
  it('falls back safely on missing or damaged stored values', () => {
    expect(parseWorkspaceSettings(null).defaultRole).toBe('member');
    const damaged = parseWorkspaceSettings({ default_role: 'owner', allowed_domains_json: 'nope', role_permissions_json: '{', admins_can_invite: 0 });
    expect(damaged).toMatchObject({ defaultRole: 'member', allowedDomains: [], adminsCanInvite: false });
    expect(damaged.rolePermissions.member['finder:run']).toBe(true);
  });

  it('rejects unsafe settings', () => {
    const valid = { customization: defaultCustomization, defaultRole: 'member', senderName: 'Scout', emailMessage: '', allowedDomains: ['example.com'], adminsCanInvite: true, rolePermissions: defaultRolePermissions };
    expect(workspaceSettingsSchema.safeParse(valid).success).toBe(true);
    expect(workspaceSettingsSchema.safeParse({ ...valid, defaultRole: 'owner' }).success).toBe(false);
    expect(workspaceSettingsSchema.safeParse({ ...valid, senderName: 'x\r\nBcc: a@b.c' }).success).toBe(false);
    expect(workspaceSettingsSchema.safeParse({ ...valid, allowedDomains: ['not a domain'] }).success).toBe(false);
  });

  it('cannot base a custom role on admin or owner', () => {
    expect(customRoleInputSchema.safeParse({ name: 'Boss', baseRole: 'admin', capabilities: defaultRolePermissions.member }).success).toBe(false);
  });
});

describe('lead export', () => {
  const lead = { name: 'Bakery', industry: 'Food', city: 'Cebu', status: 'New', score: 0, owner: 'Ana', contact: '', phone: '', email: '', priority: 'Low', next: '' };

  it('quotes commas and leaves unscored leads blank', () => {
    const [, row] = leadsToCsv([{ ...lead, name: 'Sun, Moon "Co"' }]).split('\r\n');
    expect(row.startsWith('"Sun, Moon ""Co""",Food,Cebu,Philippines,New,,Ana')).toBe(true);
  });

  it('stops business names running as spreadsheet formulas', () => {
    const [, row] = leadsToCsv([{ ...lead, name: '=HYPERLINK("http://bad")' }]).split('\r\n');
    expect(row.startsWith(`"'=HYPERLINK`)).toBe(true);
  });
});
