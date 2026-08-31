export const workspaceRoles = ['viewer', 'member', 'admin', 'owner'] as const;

export type WorkspaceRole = (typeof workspaceRoles)[number];
export type WorkspacePermission = 'records:read' | 'records:write' | 'users:manage';

const roleRank: Record<WorkspaceRole, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

const requiredRole: Record<WorkspacePermission, WorkspaceRole> = {
  'records:read': 'viewer',
  'records:write': 'member',
  'users:manage': 'admin',
};

export function hasPermission(role: WorkspaceRole, permission: WorkspacePermission) {
  return roleRank[role] >= roleRank[requiredRole[permission]];
}

export function canAssignRole(actor: WorkspaceRole, target: WorkspaceRole) {
  if (actor === 'owner') return true;
  return actor === 'admin' && target !== 'owner';
}
