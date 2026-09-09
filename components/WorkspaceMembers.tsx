'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer';
export type WorkspaceMember = { id: string; email: string; name: string; avatarUrl?: string; role: WorkspaceRole; status: string; pending: boolean; invitationId?: string; expiresAt?: string };
type Session = { user: { id: string; email: string; name: string; avatarUrl?: string }; role: WorkspaceRole };
type MembersContext = {
  members: WorkspaceMember[];
  assignableMembers: WorkspaceMember[];
  currentMember?: WorkspaceMember;
  currentRole: WorkspaceRole;
  loading: boolean;
  refresh: () => Promise<void>;
  replaceMembers: (members: WorkspaceMember[]) => void;
};

const fallbackContext: MembersContext = { members: [], assignableMembers: [], currentRole: 'viewer', loading: false, refresh: async () => {}, replaceMembers: () => {} };
const Context = createContext<MembersContext>(fallbackContext);

export function WorkspaceMembersProvider({ session, children }: { session: Session; children: React.ReactNode }) {
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
  return <Context.Provider value={{ members, assignableMembers, currentMember: members.find(member => member.id === session.user.id) || fallback, currentRole: session.role, loading, refresh, replaceMembers: setMembers }}>{children}</Context.Provider>;
}

export function useWorkspaceMembers() {
  return useContext(Context);
}
