'use client';

import { useEffect, useMemo, useState } from 'react';
import { Avatar } from '@/components/crm/shared';
import { FiMoreHorizontal, FiPlus, FiSearch, FiX } from 'react-icons/fi';
import { ScoutSelect } from '@/components/ScoutSelect';
import { useWorkspaceMembers, type WorkspaceMember, type WorkspaceRole } from '@/components/WorkspaceMembers';
import { formatDate } from '@/lib/format';
import { landingPages } from '@/lib/profile';
import { defaultWorkspaceSettings, inviteExpiryOptions, maxInvitesPerRequest, parseInviteEmails, roleDescriptions, type CustomRole, type WorkspaceSettings } from '@/lib/team';

type Props = { session: { user: { id: string }; workspace: { name: string }; role: WorkspaceRole }; notify: (message: string) => void };
type InviteResult = { email: string; status: 'sent' | 'manual' | 'failed' | 'member' | 'blocked'; inviteUrl?: string };
type Impact = { leads: number; tasks: number; opportunities: number; total: number };
type RoleChoice = { value: string; label: string; description: string; role: WorkspaceRole; customRoleId: string | null };

const title = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
const dbDate = (value?: string) => (value ? new Date(`${value.replace(' ', 'T')}${value.endsWith('Z') ? '' : 'Z'}`) : null);

function lastActive(value?: string) {
  const date = dbDate(value);
  if (!date) return 'Never';
  const days = Math.floor((Date.now() - date.getTime()) / 86400000);
  return days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : days < 30 ? `${days} days ago` : formatDate(value);
}

function expiresIn(value?: string) {
  const date = dbDate(value);
  if (!date) return '';
  const days = Math.ceil((date.getTime() - Date.now()) / 86400000);
  return days <= 0 ? 'Expires today' : days === 1 ? 'Expires tomorrow' : `Expires in ${days} days`;
}

const deliveryLabel = { sent: 'Emailed', manual: 'Not emailed', failed: 'Email failed' };

function roleChoices(actor: WorkspaceRole, customRoles: CustomRole[]): RoleChoice[] {
  const system: WorkspaceRole[] = actor === 'owner' ? ['owner', 'admin', 'member', 'viewer'] : ['admin', 'member', 'viewer'];
  return [
    ...system.map(role => ({ value: role, label: title(role), description: roleDescriptions[role], role, customRoleId: null })),
    ...customRoles.map(role => ({ value: `custom:${role.id}`, label: role.name, description: `Custom role based on ${title(role.baseRole)}.`, role: role.baseRole, customRoleId: role.id })),
  ];
}

const memberRoleValue = (member: WorkspaceMember) => (member.customRoleId ? `custom:${member.customRoleId}` : member.role);
const memberRoleLabel = (member: WorkspaceMember) => member.customRoleName || title(member.role);

function Dialog({ heading, onClose, children }: { heading: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [onClose]);
  return <div className="modal-backdrop" onClick={onClose}>
    <div className="modal team-dialog" role="dialog" aria-modal="true" aria-label={heading} onClick={event => event.stopPropagation()}>
      <header><h2>{heading}</h2><button onClick={onClose} aria-label="Close"><FiX /></button></header>
      {children}
    </div>
  </div>;
}

function InviteDialog({ actor, settings, customRoles, members, onClose, onDone }: { actor: WorkspaceRole; settings: WorkspaceSettings; customRoles: CustomRole[]; members: WorkspaceMember[]; onClose: () => void; onDone: (results: InviteResult[], users: WorkspaceMember[]) => void }) {
  const choices = useMemo(() => roleChoices(actor, customRoles), [actor, customRoles]);
  const [emails, setEmails] = useState('');
  const [role, setRole] = useState<string>(settings.defaultRole);
  const [note, setNote] = useState('');
  const [expires, setExpires] = useState('7');
  const [landing, setLanding] = useState('');
  const [handoff, setHandoff] = useState('');
  const [confirmingOwner, setConfirmingOwner] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const parsed = parseInviteEmails(emails);
  const blocked = settings.allowedDomains.length ? parsed.valid.filter(email => !settings.allowedDomains.includes(email.split('@')[1])) : [];
  const count = parsed.valid.length;
  const tooMany = count > maxInvitesPerRequest;
  const canSend = count > 0 && !parsed.invalid.length && !tooMany && !sending;

  const send = async () => {
    const choice = choices.find(item => item.value === role) || choices[0];
    if (choice.role === 'owner' && !confirmingOwner) { setConfirmingOwner(true); return; }
    setSending(true); setError('');
    const response = await fetch('/api/users', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ emails: parsed.valid, role: choice.role, customRoleId: choice.customRoleId, note: note.trim() || undefined, expiresInDays: Number(expires), landingPage: landing || undefined, handoffOwner: handoff || undefined }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { users?: WorkspaceMember[]; results?: InviteResult[]; error?: string } | null;
    setSending(false);
    if (data?.results) { onDone(data.results, data.users || members); return; }
    setConfirmingOwner(false);
    setError(data?.error || 'Invitations could not be sent. Try again.');
  };

  if (confirmingOwner) {
    return <Dialog heading="Invite as owner?" onClose={() => setConfirmingOwner(false)}>
      <div className="team-dialog-body"><p>Owners have full access and can remove other owners. {count === 1 ? parsed.valid[0] : `${count} people`} will get that access when they accept.</p></div>
      <footer><button className="text-link" onClick={() => setConfirmingOwner(false)}>Back</button><button className="primary" disabled={sending} onClick={send}>{sending ? 'Sending…' : 'Invite as owner'}</button></footer>
    </Dialog>;
  }

  return <Dialog heading="Invite people" onClose={onClose}>
    <div className="team-dialog-body">
      <label className="team-field">Email addresses
        <textarea autoFocus rows={2} value={emails} onChange={event => setEmails(event.target.value)} placeholder="name@company.com, another@company.com" />
        <small>{parsed.invalid.length ? <span className="team-field-error">Check {parsed.invalid.slice(0, 2).join(', ')}{parsed.invalid.length > 2 ? ' and others' : ''}</span> : tooMany ? <span className="team-field-error">Invite up to {maxInvitesPerRequest} people at a time.</span> : 'Each person signs in with the Google account for this address.'}</small>
        {blocked.length > 0 && <small className="team-field-error">{blocked.join(', ')} {blocked.length === 1 ? 'is' : 'are'} outside your allowed domains and will be skipped.</small>}
      </label>

      <fieldset className="team-role-cards">
        <legend>Role</legend>
        {choices.map(choice => <label className={role === choice.value ? 'selected' : ''} key={choice.value}>
          <input type="radio" name="invite-role" checked={role === choice.value} onChange={() => setRole(choice.value)} />
          <span><strong>{choice.label}</strong><small>{choice.description}</small></span>
        </label>)}
      </fieldset>

      <details className="team-more">
        <summary>More options</summary>
        <label className="team-field">Personal note
          <textarea rows={2} maxLength={500} value={note} onChange={event => setNote(event.target.value)} placeholder="Added to the invitation email" />
        </label>
        <div className="team-field-row">
          <div className="team-field"><span>Link expires</span><ScoutSelect ariaLabel="Link expires" value={expires} options={inviteExpiryOptions.map(days => ({ value: String(days), label: days === 1 ? '1 day' : `${days} days` }))} onChange={setExpires} /></div>
          <div className="team-field"><span>Opens on</span><ScoutSelect ariaLabel="Opens on" value={landing} options={[{ value: '', label: 'Their usual page' }, ...landingPages.map(page => ({ value: page, label: page }))]} onChange={setLanding} /></div>
        </div>
        <div className="team-field"><span>Hand over open leads from</span><ScoutSelect ariaLabel="Hand over open leads from" value={handoff} options={[{ value: '', label: 'Nobody' }, ...members.filter(member => !member.pending).map(member => ({ value: member.name, label: member.name }))]} onChange={setHandoff} /><small>Moves that person&apos;s open leads, tasks and opportunities once this invite is accepted.</small></div>
      </details>
      {error && <p className="team-field-error" role="alert">{error}</p>}
    </div>
    <footer><button className="text-link" onClick={onClose}>Cancel</button><button className="primary" disabled={!canSend} onClick={send}>{sending ? 'Sending…' : count > 1 ? `Send ${count} invites` : 'Send invite'}</button></footer>
  </Dialog>;
}

function RemoveDialog({ member, members, onClose, onRemoved }: { member: WorkspaceMember; members: WorkspaceMember[]; onClose: () => void; onRemoved: (users: WorkspaceMember[]) => void }) {
  const [impact, setImpact] = useState<Impact | null>(null);
  const [reassignTo, setReassignTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const successors = members.filter(item => !item.pending && item.id !== member.id && item.role !== 'viewer' && item.status === 'active');

  useEffect(() => {
    let active = true;
    fetch(`/api/users?impact=${encodeURIComponent(member.id)}`).then(response => response.json() as Promise<{ counts?: Impact; error?: string }>)
      .then(data => { if (active) { if (data.counts) setImpact(data.counts); else setError(data.error || 'Could not check their open work.'); } })
      .catch(() => { if (active) setError('Could not check their open work.'); });
    return () => { active = false; };
  }, [member.id]);

  const needsSuccessor = Boolean(impact?.total);
  const remove = async () => {
    setBusy(true); setError('');
    const query = new URLSearchParams({ id: member.id });
    if (reassignTo) query.set('reassignTo', reassignTo);
    const response = await fetch(`/api/users?${query}`, { method: 'DELETE' }).catch(() => null);
    const data = await response?.json().catch(() => null) as { users?: WorkspaceMember[]; error?: string } | null;
    setBusy(false);
    if (response?.ok && data?.users) onRemoved(data.users); else setError(data?.error || 'They could not be removed.');
  };

  return <Dialog heading={`Remove ${member.name}?`} onClose={onClose}>
    <div className="team-dialog-body">
      <p>They&apos;ll lose access straight away and be signed out.</p>
      {!impact && !error && <p className="team-muted">Checking their open work…</p>}
      {impact && !needsSuccessor && <p className="team-muted">They have no open leads, tasks or opportunities.</p>}
      {needsSuccessor && <>
        <p>They still own {impact!.leads} open lead{impact!.leads === 1 ? '' : 's'}, {impact!.tasks} task{impact!.tasks === 1 ? '' : 's'} and {impact!.opportunities} opportunit{impact!.opportunities === 1 ? 'y' : 'ies'}.</p>
        {successors.length
          ? <div className="team-field"><span>Move this work to</span><ScoutSelect ariaLabel="Move this work to" value={reassignTo} options={[{ value: '', label: 'Choose a person' }, ...successors.map(item => ({ value: item.name, label: item.name }))]} onChange={setReassignTo} /></div>
          : <p className="team-field-error">Invite or activate someone else first. There&apos;s nobody to take over this work.</p>}
      </>}
      {error && <p className="team-field-error" role="alert">{error}</p>}
    </div>
    <footer><button className="text-link" onClick={onClose}>Cancel</button><button className="primary" disabled={busy || !impact || (needsSuccessor && !reassignTo)} onClick={remove}>{busy ? 'Removing…' : 'Remove from workspace'}</button></footer>
  </Dialog>;
}

export function TeamSettings({ session, notify }: Props) {
  const { members, loading, replaceMembers, canInvite } = useWorkspaceMembers();
  const canManage = ['owner', 'admin'].includes(session.role);
  const [tab, setTab] = useState<'Active' | 'Pending'>('Active');
  const [query, setQuery] = useState('');
  const [settings, setSettings] = useState<WorkspaceSettings>(defaultWorkspaceSettings);
  const [customRoles, setCustomRoles] = useState<CustomRole[]>([]);
  const [inviting, setInviting] = useState(false);
  const [results, setResults] = useState<InviteResult[] | null>(null);
  const [removing, setRemoving] = useState<WorkspaceMember | null>(null);
  const [revoking, setRevoking] = useState<WorkspaceMember | null>(null);
  const [promoting, setPromoting] = useState<{ member: WorkspaceMember; choice: RoleChoice } | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  useEffect(() => {
    if (!canManage) return;
    let active = true;
    fetch('/api/workspace/settings').then(response => (response.ok ? response.json() as Promise<{ settings: WorkspaceSettings; customRoles: CustomRole[] }> : null))
      .then(data => { if (active && data) { setSettings(data.settings); setCustomRoles(data.customRoles); } }).catch(() => {});
    return () => { active = false; };
  }, [canManage]);

  useEffect(() => {
    if (!openMenu) return;
    const dismiss = (event: PointerEvent) => { if (!(event.target as Element).closest?.('.team-menu-wrap')) setOpenMenu(null); };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [openMenu]);

  const needle = query.trim().toLowerCase();
  const matches = (member: WorkspaceMember) => !needle || `${member.name} ${member.email}`.toLowerCase().includes(needle);
  const active = members.filter(member => !member.pending);
  const pending = members.filter(member => member.pending);
  const visible = (tab === 'Active' ? active : pending).filter(matches);
  const choices = roleChoices(session.role, customRoles);
  const editable = (member: WorkspaceMember) => canManage && member.id !== session.user.id && (session.role === 'owner' || member.role !== 'owner');

  const copy = (url?: string) => { if (url) navigator.clipboard.writeText(url).then(() => notify('Invite link copied'), () => notify('Copy failed. Select the link and copy it manually.')); };

  const applyRole = async (member: WorkspaceMember, choice: RoleChoice) => {
    const response = await fetch('/api/users', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: member.id, role: choice.role, customRoleId: choice.customRoleId }) });
    const data = await response.json() as { users?: WorkspaceMember[]; error?: string };
    if (!response.ok) { notify(data.error || 'Role could not be changed'); return; }
    replaceMembers(data.users || []);
    notify(`${member.name} is now ${choice.label}`);
  };

  const chooseRole = (member: WorkspaceMember, value: string) => {
    const choice = choices.find(item => item.value === value);
    if (!choice) return;
    if (choice.role === 'owner') setPromoting({ member, choice }); else void applyRole(member, choice);
  };

  const setSuspended = async (member: WorkspaceMember, suspend: boolean) => {
    const response = await fetch('/api/users', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: member.id, action: suspend ? 'suspend' : 'reactivate' }) });
    const data = await response.json() as { users?: WorkspaceMember[]; error?: string };
    if (!response.ok) { notify(data.error || 'That could not be changed'); return; }
    replaceMembers(data.users || []);
    notify(suspend ? `${member.name} suspended` : `${member.name} reactivated`);
  };

  const resend = async (member: WorkspaceMember) => {
    const response = await fetch('/api/users', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: member.id, action: 'resend' }) });
    const data = await response.json() as { users?: WorkspaceMember[]; delivery?: 'sent' | 'manual' | 'failed'; error?: string };
    if (!response.ok) { notify(data.error || 'Invite could not be resent'); return; }
    replaceMembers(data.users || []);
    notify(data.delivery === 'sent' ? `Invite resent to ${member.email}` : data.delivery === 'failed' ? 'Email failed. Link extended, so copy it instead.' : 'Email is not set up. Link extended, so copy it instead.');
  };

  const revoke = async (member: WorkspaceMember) => {
    const response = await fetch(`/api/users?id=${encodeURIComponent(member.id)}`, { method: 'DELETE' });
    const data = await response.json() as { users?: WorkspaceMember[]; error?: string };
    setRevoking(null);
    if (!response.ok) { notify(data.error || 'Invite could not be revoked'); return; }
    replaceMembers(data.users || []);
    notify('Invite revoked');
  };

  const emailed = results?.filter(item => item.status === 'sent').length || 0;
  const manual = results?.filter(item => item.inviteUrl && item.status !== 'sent') || [];
  const skipped = results?.filter(item => !item.inviteUrl) || [];

  return <>
    <div className="page-head"><h1>Team</h1>{canInvite && <button className="primary" onClick={() => setInviting(true)}><FiPlus /> Invite people</button>}</div>

    {results && <section className="team-result" role="status">
      <div>
        {emailed > 0 && <p><strong>{emailed === 1 ? 'Invite emailed.' : `${emailed} invites emailed.`}</strong></p>}
        {manual.length > 0 && <p><strong>{manual.length === 1 ? 'This invite was not emailed.' : `${manual.length} invites were not emailed.`}</strong> Copy the link and send it yourself.</p>}
        {manual.map(item => <div className="team-result-row" key={item.email}><span>{item.email}</span><button className="secondary" onClick={() => copy(item.inviteUrl)}>Copy link</button></div>)}
        {skipped.map(item => <p className="team-muted" key={item.email}>{item.email}: {item.status === 'member' ? 'already in this workspace' : 'outside your allowed domains'}</p>)}
      </div>
      <button className="team-result-close" onClick={() => setResults(null)} aria-label="Dismiss"><FiX /></button>
    </section>}

    <div className="team-toolbar">
      <nav className="team-tabs" aria-label="Team views">
        {(['Active', 'Pending'] as const).map(item => <button className={tab === item ? 'active' : ''} onClick={() => setTab(item)} key={item}>{item}<span>{item === 'Active' ? active.length : pending.length}</span></button>)}
      </nav>
      <div className="lead-search"><FiSearch /><input aria-label="Search team" placeholder="Search people…" value={query} onChange={event => setQuery(event.target.value)} /></div>
    </div>

    <section className={`team-list ${tab === 'Pending' ? 'is-pending' : ''}`}>
      <div className="team-head">{tab === 'Active' ? <><span>Person</span><span>Role</span><span>Last active</span><span /></> : <><span>Person</span><span>Role</span><span>Status</span><span /></>}</div>
      {loading && <p className="workflow-empty">Loading team…</p>}
      {!loading && visible.map(member => <div className="team-row" key={member.id}>
        <div className="team-user"><Avatar name={member.name} url={member.avatarUrl} className="team-avatar" /><div><strong>{tab === 'Pending' ? member.email : member.name}</strong><small>{tab === 'Pending' ? member.name : member.email}</small></div></div>
        <div>{editable(member) ? <ScoutSelect ariaLabel={`Role for ${member.name}`} value={memberRoleValue(member)} options={choices.map(choice => ({ value: choice.value, label: choice.label }))} onChange={value => chooseRole(member, value)} /> : <span className="role-label">{memberRoleLabel(member)}</span>}</div>
        {tab === 'Active' ? <span>{member.id === session.user.id ? 'You' : member.status === 'disabled' ? 'Suspended' : lastActive(member.lastSeenAt)}</span> : <span>{member.delivery ? deliveryLabel[member.delivery] : ''}<small>{expiresIn(member.expiresAt)}</small></span>}
        <div className="team-row-actions">
          {tab === 'Pending' && canInvite && <>
            <button className="secondary" onClick={() => copy(member.inviteUrl)}>Copy link</button>
            <div className="team-menu-wrap">
              <button aria-label={`More actions for ${member.email}`} aria-haspopup="menu" aria-expanded={openMenu === member.id} onClick={() => setOpenMenu(current => (current === member.id ? null : member.id))}><FiMoreHorizontal /></button>
              {openMenu === member.id && <div className="team-menu" role="menu">
                <button role="menuitem" onClick={() => { setOpenMenu(null); void resend(member); }}>Resend</button>
                <button role="menuitem" className="danger-text" onClick={() => { setOpenMenu(null); setRevoking(member); }}>Revoke</button>
              </div>}
            </div>
          </>}
          {tab === 'Active' && editable(member) && <div className="team-menu-wrap">
            <button aria-label={`More actions for ${member.name}`} aria-haspopup="menu" aria-expanded={openMenu === member.id} onClick={() => setOpenMenu(current => (current === member.id ? null : member.id))}><FiMoreHorizontal /></button>
            {openMenu === member.id && <div className="team-menu" role="menu">
              <button role="menuitem" onClick={() => { setOpenMenu(null); void setSuspended(member, member.status !== 'disabled'); }}>{member.status === 'disabled' ? 'Reactivate' : 'Suspend'}</button>
              <button role="menuitem" className="danger-text" onClick={() => { setOpenMenu(null); setRemoving(member); }}>Remove</button>
            </div>}
          </div>}
        </div>
      </div>)}
      {!loading && !visible.length && <p className="workflow-empty">{needle ? 'Nobody matches this search.' : tab === 'Pending' ? 'No pending invites.' : 'No team members yet.'}</p>}
    </section>

    {inviting && <InviteDialog actor={session.role} settings={settings} customRoles={customRoles} members={members} onClose={() => setInviting(false)} onDone={(items, users) => { setInviting(false); setResults(items); replaceMembers(users); if (items.some(item => item.inviteUrl)) setTab('Pending'); }} />}
    {removing && <RemoveDialog member={removing} members={members} onClose={() => setRemoving(null)} onRemoved={users => { replaceMembers(users); notify(`${removing.name} removed`); setRemoving(null); }} />}
    {revoking && <Dialog heading="Revoke this invite?" onClose={() => setRevoking(null)}>
      <div className="team-dialog-body"><p>The link for {revoking.email} will stop working.</p></div>
      <footer><button className="text-link" onClick={() => setRevoking(null)}>Cancel</button><button className="primary" onClick={() => revoke(revoking)}>Revoke invite</button></footer>
    </Dialog>}
    {promoting && <Dialog heading={`Make ${promoting.member.name} an owner?`} onClose={() => setPromoting(null)}>
      <div className="team-dialog-body"><p>Owners have full access and can remove other owners, including you.</p></div>
      <footer><button className="text-link" onClick={() => setPromoting(null)}>Cancel</button><button className="primary" onClick={() => { void applyRole(promoting.member, promoting.choice); setPromoting(null); }}>Make owner</button></footer>
    </Dialog>}
  </>;
}
