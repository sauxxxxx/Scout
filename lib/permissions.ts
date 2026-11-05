export const workspaceRoles = ['viewer', 'member', 'admin', 'owner'] as const;
export const workspaceCapabilities = ['finder:run', 'records:delete', 'records:export', 'records:view_all'] as const;

export type WorkspaceRole = (typeof workspaceRoles)[number];
export type WorkspaceCapability = (typeof workspaceCapabilities)[number];
export type CapabilitySet = Record<WorkspaceCapability, boolean>;
export type RolePermissions = Record<'member' | 'viewer', CapabilitySet>;
export type BaseRole = 'records:read' | 'records:write' | 'users:manage';
export type WorkspacePermission = BaseRole | WorkspaceCapability | 'users:invite';

const roleRank: Record<WorkspaceRole, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

const requiredRole: Record<BaseRole, WorkspaceRole> = {
  'records:read': 'viewer',
  'records:write': 'member',
  'users:manage': 'admin',
};

const fullAccess: CapabilitySet = { 'finder:run': true, 'records:delete': true, 'records:export': true, 'records:view_all': true };

export const defaultRolePermissions: RolePermissions = {
  member: { ...fullAccess },
  viewer: { 'finder:run': false, 'records:delete': false, 'records:export': false, 'records:view_all': true },
};

export function hasPermission(role: WorkspaceRole, permission: BaseRole) {
  return roleRank[role] >= roleRank[requiredRole[permission]];
}

/** Owners and admins always have everything. A viewer can never write, so running Finder and deleting stay off. */
export function resolveCapabilities(role: WorkspaceRole, permissions: RolePermissions = defaultRolePermissions, custom?: Partial<CapabilitySet> | null): CapabilitySet {
  if (role === 'owner' || role === 'admin') return { ...fullAccess };
  const resolved = { ...defaultRolePermissions[role], ...permissions[role], ...custom };
  return role === 'viewer' ? { ...resolved, 'finder:run': false, 'records:delete': false } : resolved;
}

export function canInviteMembers(role: WorkspaceRole, adminsCanInvite: boolean) {
  return role === 'owner' || (role === 'admin' && adminsCanInvite);
}

export function permissionAllowed(access: { role: WorkspaceRole; capabilities: CapabilitySet; canInvite: boolean }, permission: WorkspacePermission) {
  if (permission === 'users:invite') return access.canInvite;
  if (permission in access.capabilities) return access.capabilities[permission as WorkspaceCapability];
  return hasPermission(access.role, permission as BaseRole);
}

export function canAssignRole(actor: WorkspaceRole, target: WorkspaceRole) {
  if (actor === 'owner') return true;
  return actor === 'admin' && target !== 'owner';
}

/** Changing a role depends on who the person is now as well as what they become, so an admin cannot demote an owner. */
export function canChangeRole(actor: WorkspaceRole, current: WorkspaceRole, next: WorkspaceRole) {
  return canAssignRole(actor, current) && canAssignRole(actor, next);
}
