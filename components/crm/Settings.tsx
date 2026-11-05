'use client';

import { TeamSettings } from '@/components/TeamSettings';
import { AuditLog, RolePermissions, WorkspaceDefaults } from '@/components/WorkspaceSettings';
import type { Session } from '@/lib/crm-types';
import { Heading } from '@/components/crm/shared';

export function Settings({session,notify,view='Team',onWorkspaceRenamed}:{session:Session;notify:(message:string)=>void;view?:string;onWorkspaceRenamed?:(name:string)=>void}) {
  if(view==='Access')return <><Heading title="Access & security"/><section className="access-settings"><article><div><strong>Google sign-in</strong><span>{session.user.email}</span></div><em>Connected</em></article><article><div><strong>Workspace role</strong><span>{session.customRole?.name||session.role.charAt(0).toUpperCase()+session.role.slice(1)} in {session.workspace.name}</span></div><em>Active</em></article><article><div><strong>End this session</strong><span>Sign out on this browser.</span></div><a className="secondary" href="/api/auth/logout">Sign out</a></article></section></>;
  if(view==='Activity log'&&['owner','admin'].includes(session.role))return <AuditLog/>;
  if(view==='Workspace'&&session.role==='owner')return <WorkspaceDefaults notify={notify} onRenamed={onWorkspaceRenamed}/>;
  if(view==='Roles'&&session.role==='owner')return <RolePermissions notify={notify}/>;
  return <TeamSettings session={session} notify={notify}/>;
}
