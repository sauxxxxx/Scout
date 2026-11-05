'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { CapabilitySet } from '@/lib/permissions';

export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer';
export type WorkspaceMember = {
  id: string; email: string; name: string; avatarUrl?: string; role: WorkspaceRole; status: string; pending: boolean;
  invitationId?: string; expiresAt?: string; lastSeenAt?: string; customRoleId?: string; customRoleName?: string;
  delivery?: 'sent' | 'manual' | 'failed'; lastSentAt?: string; note?: string; inviteUrl?: string;
};
type Session = { user: { id: string; email: string; name: string; avatarUrl?: string }; role: WorkspaceRole; capabilities?: CapabilitySet; canInvite?: boolean };
type MembersContext = {
  members: WorkspaceMember[];
  assignableMembers: WorkspaceMember[];
  currentMember?: WorkspaceMember;
  defaultOwner?: WorkspaceMember;
  currentRole: WorkspaceRole;
  capabilities: CapabilitySet;
  canInvite: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
  replaceMembers: (members: WorkspaceMember[]) => void;
};

const allCapabilities: CapabilitySet = { 'finder:run': true, 'records:delete': true, 'records:export': true, 'records:view_all': true };
const fallbackContext: MembersContext = { members: [], assignableMembers: [], currentRole: 'viewer', capabilities: allCapabilities, canInvite: false, loading: false, refresh: async () => {}, replaceMembers: () => {} };
const Context = createContext<MembersContext>(fallbackContext);

export function WorkspaceMembersProvider({ session, children, preferredOwner = 'Me' }: { session: Session; children: React.ReactNode; preferredOwner?: string }) {
  const fallback = useMemo<WorkspaceMember>(() => ({ ...session.user, role: session.role, status: 'active', pending: false }), [session]);
  const [members, setMembers] = useState<WorkspaceMember[]>([fallback]);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/users');
      const data = await response.json() as { users?: WorkspaceMember[] };
      if (response.ok && data.users) setMembers(data.users);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const assignableMembers = useMemo(() => members.filter(member => !member.pending && member.status !== 'disabled' && member.role !== 'viewer'), [members]);
  const currentMember = members.find(member => member.id === session.user.id) || fallback;
  const defaultOwner = ['owner', 'admin'].includes(session.role) ? assignableMembers.find(member => member.id === preferredOwner) || currentMember : currentMember;
  return <Context.Provider value={{ members, assignableMembers, currentMember, defaultOwner, currentRole: session.role, capabilities: session.capabilities || allCapabilities, canInvite: Boolean(session.canInvite), loading, refresh, replaceMembers: setMembers }}>{children}</Context.Provider>;
}

export function useWorkspaceMembers() {
  return useContext(Context);
}
