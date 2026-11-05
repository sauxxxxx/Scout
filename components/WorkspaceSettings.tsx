'use client';

import { useEffect, useState } from 'react';
import { FiPlus, FiTrash2 } from 'react-icons/fi';
import { ScoutSelect } from '@/components/ScoutSelect';
import { formatDateTime } from '@/lib/format';
import { defaultRolePermissions, resolveCapabilities, workspaceCapabilities, type CapabilitySet, type WorkspaceCapability } from '@/lib/permissions';
import { capabilityDetails, type CustomRole, type WorkspaceSettings } from '@/lib/team';

type Notify = (message: string) => void;
type Loaded = { settings: WorkspaceSettings; customRoles: CustomRole[]; workspaceName?: string };
type AuditEntry = { id: string; actor: string; action: string; target: string; detail: string; createdAt: string };

function useWorkspaceConfig() {
  const [state, setState] = useState<Loaded | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    fetch('/api/workspace/settings').then(async response => {
      const data = await response.json() as Loaded & { error?: string };
      if (!active) return;
      if (response.ok) setState({ settings: data.settings, customRoles: data.customRoles, workspaceName: data.workspaceName }); else setError(data.error || 'Settings could not load.');
    }).catch(() => { if (active) setError('Settings could not load.'); });
    return () => { active = false; };
  }, []);
  return { state, setState, error };
}

const fieldMessage = (data: { fields?: Record<string, string[]> }) => Object.values(data.fields || {}).flat()[0];

async function saveSettings(settings: WorkspaceSettings, workspaceName?: string) {
  const response = await fetch('/api/workspace/settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...settings, ...(workspaceName ? { workspaceName } : {}) }) });
  const data = await response.json() as { settings?: WorkspaceSettings; error?: string; fields?: Record<string, string[]> };
  return response.ok ? { settings: data.settings as WorkspaceSettings } : { error: fieldMessage(data) || data.error || 'Settings could not be saved.' };
}

export function WorkspaceDefaults({ notify, onRenamed }: { notify: Notify; onRenamed?: (name: string) => void }) {
  const { state, error } = useWorkspaceConfig();
  if (error) return <><div className="page-head"><h1>Workspace</h1></div><p className="workflow-empty">{error}</p></>;
  if (!state) return <><div className="page-head"><h1>Workspace</h1></div><p className="workflow-empty">Loading settings…</p></>;
  return <DefaultsForm initial={state.settings} initialName={state.workspaceName || ''} notify={notify} onRenamed={onRenamed} />;
}

function DefaultsForm({ initial, initialName, notify, onRenamed }: { initial: WorkspaceSettings; initialName: string; notify: Notify; onRenamed?: (name: string) => void }) {
  const [draft, setDraft] = useState<WorkspaceSettings>(initial);
  const [workspaceName, setWorkspaceName] = useState(initialName);
  const [domains, setDomains] = useState(initial.allowedDomains.join(', '));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const save = async () => {
    setSaving(true); setSaveError('');
    const allowedDomains = domains.split(/[\s,;]+/).map(item => item.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
    const result = await saveSettings({ ...draft, allowedDomains }, workspaceName.trim());
    setSaving(false);
    if (result.error) { setSaveError(result.error); return; }
    setDraft(result.settings!);
    onRenamed?.(workspaceName.trim());
    notify('Workspace settings saved');
  };

  return <>
    <div className="page-head"><h1>Workspace</h1><button className="primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save changes'}</button></div>
    <section className="workspace-settings">
      <h2>General</h2>
      <label className="workspace-setting stacked"><div><strong>Workspace name</strong></div><input maxLength={80} value={workspaceName} onChange={event => setWorkspaceName(event.target.value)} /></label>
      <h2>Invitations</h2>
      <div className="workspace-setting"><div><strong>Default role</strong><span>Selected first when you invite someone.</span></div><ScoutSelect ariaLabel="Default role" value={draft.defaultRole} options={[{ value: 'admin', label: 'Admin' }, { value: 'member', label: 'Member' }, { value: 'viewer', label: 'Viewer' }]} onChange={value => setDraft({ ...draft, defaultRole: value as WorkspaceSettings['defaultRole'] })} /></div>
      <label className="workspace-setting"><div><strong>Admins can invite</strong><span>Off means only owners can invite people.</span></div><input type="checkbox" checked={draft.adminsCanInvite} onChange={event => setDraft({ ...draft, adminsCanInvite: event.target.checked })} /></label>
      <label className="workspace-setting stacked"><div><strong>Allowed email domains</strong><span>Leave empty to allow any address. Separate with commas, like example.com, example.ph</span></div><input value={domains} onChange={event => setDomains(event.target.value)} placeholder="example.com" /></label>
      <h2>Invitation email</h2>
      <label className="workspace-setting stacked"><div><strong>Sender name</strong><span>Shown in the inbox. The sending address stays the same.</span></div><input maxLength={80} value={draft.senderName} onChange={event => setDraft({ ...draft, senderName: event.target.value })} placeholder="Scout" /></label>
      <label className="workspace-setting stacked"><div><strong>Message</strong><span>Added to every invitation, after any personal note.</span></div><textarea rows={4} maxLength={1000} value={draft.emailMessage} onChange={event => setDraft({ ...draft, emailMessage: event.target.value })} placeholder="Welcome to the team. Start with the Leads page." /></label>
      {saveError && <p className="team-field-error" role="alert">{saveError}</p>}
    </section>
  </>;
}

type RoleColumn = { key: string; label: string; capabilities: CapabilitySet; base: 'member' | 'viewer'; custom?: CustomRole };

export function RolePermissions({ notify }: { notify: Notify }) {
  const { state, setState, error } = useWorkspaceConfig();
  if (error) return <><div className="page-head"><h1>Roles</h1></div><p className="workflow-empty">{error}</p></>;
  if (!state) return <><div className="page-head"><h1>Roles</h1></div><p className="workflow-empty">Loading roles…</p></>;
  return <RolesForm state={state} setState={setState} notify={notify} />;
}

function RolesForm({ state, setState, notify }: { state: Loaded; setState: (value: Loaded) => void; notify: Notify }) {
  const [draft, setDraft] = useState<Loaded>(state);
  const [name, setName] = useState('');
  const [base, setBase] = useState<'member' | 'viewer'>('member');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [deleting, setDeleting] = useState<CustomRole | null>(null);

  const columns: RoleColumn[] = [
    { key: 'member', label: 'Member', capabilities: draft.settings.rolePermissions.member, base: 'member' },
    { key: 'viewer', label: 'Viewer', capabilities: draft.settings.rolePermissions.viewer, base: 'viewer' },
    ...draft.customRoles.map(role => ({ key: role.id, label: role.name, capabilities: role.capabilities, base: role.baseRole, custom: role })),
  ];

  const toggle = (column: RoleColumn, capability: WorkspaceCapability, value: boolean) => {
    const capabilities = { ...column.capabilities, [capability]: value };
    if (column.custom) setDraft({ ...draft, customRoles: draft.customRoles.map(role => (role.id === column.key ? { ...role, capabilities } : role)) });
    else setDraft({ ...draft, settings: { ...draft.settings, rolePermissions: { ...draft.settings.rolePermissions, [column.key]: capabilities } } });
  };

  const changed = JSON.stringify(draft) !== JSON.stringify(state);

  const save = async () => {
    setSaving(true); setMessage('');
    const result = await saveSettings(draft.settings);
    if (result.error) { setSaving(false); setMessage(result.error); return; }
    let customRoles = state.customRoles;
    for (const role of draft.customRoles) {
      if (JSON.stringify(role) === JSON.stringify(state.customRoles.find(item => item.id === role.id))) continue;
      const response = await fetch('/api/workspace/roles', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: role.id, name: role.name, capabilities: role.capabilities }) });
      const data = await response.json() as { customRoles?: CustomRole[]; error?: string };
      if (!response.ok) { setSaving(false); setMessage(data.error || 'A role could not be saved.'); return; }
      customRoles = data.customRoles || customRoles;
    }
    setSaving(false);
    const saved = { settings: result.settings!, customRoles };
    setState(saved);
    setDraft(saved);
    notify('Roles saved');
  };

  const addRole = async () => {
    setMessage('');
    const response = await fetch('/api/workspace/roles', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: name.trim(), baseRole: base, capabilities: resolveCapabilities(base, draft.settings.rolePermissions) }) });
    const data = await response.json() as { customRoles?: CustomRole[]; error?: string; fields?: Record<string, string[]> };
    if (!response.ok) { setMessage(fieldMessage(data) || data.error || 'The role could not be created.'); return; }
    setName('');
    setState({ ...state, customRoles: data.customRoles || [] });
    setDraft({ ...draft, customRoles: data.customRoles || [] });
    notify('Role created');
  };

  const removeRole = async (role: CustomRole) => {
    const response = await fetch(`/api/workspace/roles?id=${encodeURIComponent(role.id)}`, { method: 'DELETE' });
    const data = await response.json() as { customRoles?: CustomRole[]; error?: string };
    setDeleting(null);
    if (!response.ok) { notify(data.error || 'The role could not be deleted.'); return; }
    setState({ ...state, customRoles: data.customRoles || [] });
    setDraft({ ...draft, customRoles: data.customRoles || [] });
    notify('Role deleted');
  };

  return <>
    <div className="page-head"><h1>Roles</h1><button className="primary" disabled={!changed || saving} onClick={save}>{saving ? 'Saving…' : 'Save changes'}</button></div>
    <p className="settings-intro">Owners and admins always have every permission.</p>
    <div className="role-matrix-wrap">
      <table className="role-matrix">
        <thead><tr><th scope="col">Permission</th>{columns.map(column => <th scope="col" key={column.key}><span>{column.label}{column.custom && <button aria-label={`Delete ${column.label}`} onClick={() => setDeleting(column.custom!)}><FiTrash2 /></button>}</span>{column.custom && <small>Based on {column.base}</small>}</th>)}</tr></thead>
        <tbody>
          {workspaceCapabilities.map(capability => <tr key={capability}>
            <th scope="row"><strong>{capabilityDetails[capability].label}</strong><small>{capabilityDetails[capability].description}</small></th>
            {columns.map(column => {
              const locked = column.base === 'viewer' && !defaultRolePermissions.viewer[capability] && capability !== 'records:export';
              return <td key={column.key}><input type="checkbox" aria-label={`${capabilityDetails[capability].label} for ${column.label}`} disabled={locked} checked={!locked && column.capabilities[capability]} onChange={event => toggle(column, capability, event.target.checked)} /></td>;
            })}
          </tr>)}
        </tbody>
      </table>
    </div>
    <section className="role-create">
      <h2>Add a custom role</h2>
      <div>
        <label className="team-field">Name<input maxLength={40} value={name} onChange={event => setName(event.target.value)} placeholder="Field sales" /></label>
        <div className="team-field"><span>Based on</span><ScoutSelect ariaLabel="Based on" value={base} options={[{ value: 'member', label: 'Member (can edit records)' }, { value: 'viewer', label: 'Viewer (read-only)' }]} onChange={value => setBase(value as 'member' | 'viewer')} /></div>
        <button className="secondary" disabled={name.trim().length < 2} onClick={addRole}><FiPlus /> Add role</button>
      </div>
      {message && <p className="team-field-error" role="alert">{message}</p>}
    </section>
    {deleting && <div className="modal-backdrop" onClick={() => setDeleting(null)}>
      <div className="modal team-dialog" role="dialog" aria-modal="true" aria-label={`Delete ${deleting.name}?`} onClick={event => event.stopPropagation()}>
        <header><h2>Delete {deleting.name}?</h2></header>
        <div className="team-dialog-body"><p>Anyone with this role goes back to {deleting.baseRole === 'member' ? 'Member' : 'Viewer'}.</p></div>
        <footer><button className="text-link" onClick={() => setDeleting(null)}>Cancel</button><button className="primary" onClick={() => removeRole(deleting)}>Delete role</button></footer>
      </div>
    </div>}
  </>;
}

export function AuditLog() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    fetch('/api/workspace/audit').then(async response => {
      const data = await response.json() as { entries?: AuditEntry[]; error?: string };
      if (!active) return;
      if (response.ok) setEntries(data.entries || []); else setError(data.error || 'The activity log could not load.');
    }).catch(() => { if (active) setError('The activity log could not load.'); });
    return () => { active = false; };
  }, []);
  return <>
    <div className="page-head"><h1>Activity log</h1></div>
    <p className="settings-intro">Who changed access, settings or deleted records. Shows the latest 200 entries.</p>
    {error && <p className="workflow-empty">{error}</p>}
    {!error && !entries && <p className="workflow-empty">Loading…</p>}
    {entries && <div className="audit-list">
      {entries.map(entry => <article key={entry.id}><div><strong>{entry.actor}</strong> {entry.action.toLowerCase()} {entry.target}{entry.detail && <span> · {entry.detail}</span>}</div><time>{formatDateTime(entry.createdAt)}</time></article>)}
      {!entries.length && <p className="workflow-empty">Nothing recorded yet.</p>}
    </div>}
  </>;
}
