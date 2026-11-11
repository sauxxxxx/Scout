'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { CapabilitySet } from '@/lib/permissions';
import { peopleLooks, type PersonLook } from '@/lib/person-tone';

export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer';
export type WorkspaceMember = {
  id: string; email: string; name: string; avatarUrl?: string; joinedAt?: string; role: WorkspaceRole; status: string; pending: boolean;
  invitationId?: string; expiresAt?: string; lastSeenAt?: string; customRoleId?: string; customRoleName?: string; inSales?: boolean;
  delivery?: 'sent' | 'manual' | 'failed'; lastSentAt?: string; note?: string; inviteUrl?: string;
};
type Session = { emailLogAddress?: string; user: { id: string; email: string; name: string; avatarUrl?: string }; role: WorkspaceRole; capabilities?: CapabilitySet; canInvite?: boolean };
type MembersContext = {
  members: WorkspaceMember[];
  people: Map<string, PersonLook>;
  assignableMembers: WorkspaceMember[];
  currentMember?: WorkspaceMember;
  defaultOwner?: WorkspaceMember;
  emailLogAddress?: string;
  currentRole: WorkspaceRole;
  capabilities: CapabilitySet;
  canInvite: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
  replaceMembers: (members: WorkspaceMember[]) => void;
};

const allCapabilities: CapabilitySet = { 'finder:run': true, 'records:delete': true, 'records:export': true, 'records:view_all': true };
const fallbackContext: MembersContext = { members: [], people: new Map(), assignableMembers: [], currentRole: 'viewer', capabilities: allCapabilities, canInvite: false, loading: false, refresh: async () => {}, replaceMembers: () => {} };
const Context = createContext<MembersContext>(fallbackContext);

export function WorkspaceMembersProvider({ session, children, preferredOwner = 'Me', initialMembers }: { session: Session; children: React.ReactNode; preferredOwner?: string; initialMembers?: WorkspaceMember[] }) {
  const fallback = useMemo<WorkspaceMember>(() => ({ ...session.user, role: session.role, status: 'active', pending: false }), [session]);
  const [members, setMembers] = useState<WorkspaceMember[]>(initialMembers?.length ? initialMembers : [fallback]);
  const [loading, setLoading] = useState(!initialMembers?.length);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/users');
      const data = await response.json() as { users?: WorkspaceMember[] };
      if (response.ok && data.users) setMembers(data.users);
    } finally { setLoading(false); }
  }, []);
  const hasStartingMembers = !!initialMembers?.length;
  useEffect(() => { if (!hasStartingMembers) void refresh(); }, [refresh, hasStartingMembers]);
  const people = useMemo(() => peopleLooks(members), [members]);
  // People switched out of sales (IT, admins who don't sell) can't be given leads and don't appear in team results.
  const assignableMembers = useMemo(() => members.filter(member => !member.pending && member.status !== 'disabled' && member.role !== 'viewer' && member.inSales !== false), [members]);
  const currentMember = members.find(member => member.id === session.user.id) || fallback;
  const selfIfSelling = assignableMembers.find(member => member.id === currentMember.id);
  const defaultOwner = ['owner', 'admin'].includes(session.role) ? assignableMembers.find(member => member.id === preferredOwner) || selfIfSelling || assignableMembers[0] || currentMember : currentMember;
  return <Context.Provider value={{ members, people, assignableMembers, currentMember, defaultOwner, emailLogAddress: session.emailLogAddress, currentRole: session.role, capabilities: session.capabilities || allCapabilities, canInvite: Boolean(session.canInvite), loading, refresh, replaceMembers: setMembers }}>{children}</Context.Provider>;
}

export function useWorkspaceMembers() {
  return useContext(Context);
}
