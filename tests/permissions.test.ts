import { describe, expect, it } from 'vitest';
import { canAssignRole, hasPermission } from '@/lib/permissions';

describe('workspace permissions', () => {
  it('keeps viewers read-only', () => {
    expect(hasPermission('viewer', 'records:read')).toBe(true);
    expect(hasPermission('viewer', 'records:write')).toBe(false);
    expect(hasPermission('viewer', 'users:manage')).toBe(false);
  });

  it('allows members to edit records but not users', () => {
    expect(hasPermission('member', 'records:write')).toBe(true);
    expect(hasPermission('member', 'users:manage')).toBe(false);
  });

  it('reserves owner assignment for owners', () => {
    expect(canAssignRole('admin', 'member')).toBe(true);
    expect(canAssignRole('admin', 'owner')).toBe(false);
    expect(canAssignRole('owner', 'owner')).toBe(true);
  });
});
