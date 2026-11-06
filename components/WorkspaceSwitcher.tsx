'use client';

import { useState } from 'react';
import { FiX } from 'react-icons/fi';

/** Saves the choice on the server, then reloads so every screen shows the new workspace. */
export async function switchWorkspace(id: string) {
  const response = await fetch('/api/workspaces', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) });
  if (response.ok) window.location.assign('/');
}

export function WorkspaceSwitcher({ creating, onCloseCreate }: { creating: boolean; onCloseCreate: () => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const create = async () => {
    setBusy(true); setError('');
    const response = await fetch('/api/workspaces', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: name.trim() }) });
    if (response.ok) { window.location.assign('/'); return; }
    const data = await response.json().catch(() => ({})) as { error?: string };
    setBusy(false); setError(data.error || 'The workspace could not be created.');
  };

  return <>
    {creating && <div className="modal-backdrop" onClick={() => onCloseCreate()}>
      <div className="modal team-dialog" role="dialog" aria-modal="true" aria-label="Create a workspace" onClick={event => event.stopPropagation()}>
        <header><h2>Create a workspace</h2><button onClick={() => onCloseCreate()} aria-label="Close"><FiX /></button></header>
        <div className="team-dialog-body">
          <p>A separate space with its own leads, team and settings. You&apos;ll be its owner.</p>
          <label className="team-field">Workspace name<input autoFocus maxLength={80} value={name} onChange={event => setName(event.target.value)} /></label>
          {error && <p className="team-field-error" role="alert">{error}</p>}
        </div>
        <footer><button className="text-link" onClick={() => onCloseCreate()}>Cancel</button><button className="primary" disabled={busy || name.trim().length < 2} onClick={create}>{busy ? 'Creating…' : 'Create workspace'}</button></footer>
      </div>
    </div>}
  </>;
}
