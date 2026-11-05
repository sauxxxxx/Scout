'use client';

import { useState } from 'react';
import { FiPlus, FiX } from 'react-icons/fi';
import { ScoutSelect } from '@/components/ScoutSelect';

type Workspace = { id: string; name: string };

export function WorkspaceSwitcher({ current, workspaces }: { current: Workspace; workspaces: Workspace[] }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const choose = async (id: string) => {
    if (id === current.id) return;
    const response = await fetch('/api/workspaces', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) });
    if (response.ok) window.location.assign('/');
  };

  const create = async () => {
    setBusy(true); setError('');
    const response = await fetch('/api/workspaces', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: name.trim() }) });
    if (response.ok) { window.location.assign('/'); return; }
    const data = await response.json().catch(() => ({})) as { error?: string };
    setBusy(false); setError(data.error || 'The workspace could not be created.');
  };

  return <div className="workspace-name">
    {workspaces.length > 1
      ? <ScoutSelect ariaLabel="Switch workspace" value={current.id} options={workspaces.map(item => ({ value: item.id, label: item.name }))} onChange={choose} />
      : <span>{current.name}</span>}
    <button className="workspace-add" aria-label="Create a workspace" title="Create a workspace" onClick={() => setCreating(true)}><FiPlus /></button>
    {creating && <div className="modal-backdrop" onClick={() => setCreating(false)}>
      <div className="modal team-dialog" role="dialog" aria-modal="true" aria-label="Create a workspace" onClick={event => event.stopPropagation()}>
        <header><h2>Create a workspace</h2><button onClick={() => setCreating(false)} aria-label="Close"><FiX /></button></header>
        <div className="team-dialog-body">
          <p>A separate space with its own leads, team and settings. You&apos;ll be its owner.</p>
          <label className="team-field">Workspace name<input autoFocus maxLength={80} value={name} onChange={event => setName(event.target.value)} /></label>
          {error && <p className="team-field-error" role="alert">{error}</p>}
        </div>
        <footer><button className="text-link" onClick={() => setCreating(false)}>Cancel</button><button className="primary" disabled={busy || name.trim().length < 2} onClick={create}>{busy ? 'Creating…' : 'Create workspace'}</button></footer>
      </div>
    </div>}
  </div>;
}
