'use client';

import { useRef, useState } from 'react';
import { FiCheck, FiChevronDown, FiChevronUp, FiImage, FiPlus, FiRotateCcw, FiTrash2 } from 'react-icons/fi';
import { saveSettings, useWorkspaceConfig } from '@/components/WorkspaceSettings';
import { accentColors, accentHex, applyAccent, defaultTaskTypes, type Customization, type LeadStatus } from '@/lib/customization';
import { leadStatuses } from '@/lib/validation';
import { moved } from '@/lib/view-settings';
import type { WorkspaceSettings } from '@/lib/team';

type Notify = (message: string) => void;
type FormProps = { settings: WorkspaceSettings; notify: Notify; onCustomized?: (customization: Customization) => void };

function Loading({ title, error }: { title: string; error: string }) {
  return <><div className="page-head"><h1>{title}</h1></div><p className="workflow-empty">{error || 'Loading settings…'}</p></>;
}

export function BrandingSettings({ notify, onCustomized }: { notify: Notify; onCustomized?: (customization: Customization) => void }) {
  const { state, error } = useWorkspaceConfig();
  return state ? <BrandingForm settings={state.settings} notify={notify} onCustomized={onCustomized} /> : <Loading title="Branding" error={error} />;
}

export function SalesSetup({ notify, onCustomized }: { notify: Notify; onCustomized?: (customization: Customization) => void }) {
  const { state, error } = useWorkspaceConfig();
  return state ? <SalesSetupForm settings={state.settings} notify={notify} onCustomized={onCustomized} /> : <Loading title="Sales setup" error={error} />;
}

function useSave({ settings, notify, onCustomized }: FormProps) {
  const [saved, setSaved] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState('');
  const save = async (customization: Customization) => {
    setSaving(true); setProblem('');
    const result = await saveSettings({ ...saved, customization });
    setSaving(false);
    if (result.error) { setProblem(result.error); return false; }
    setSaved(result.settings!);
    onCustomized?.(result.settings!.customization);
    notify('Changes saved');
    return true;
  };
  return { saved: saved.customization, save, saving, problem, setProblem };
}

function BrandingForm(props: FormProps) {
  const { saved, save, saving, problem, setProblem } = useSave(props);
  const [draft, setDraft] = useState(saved);
  const [uploading, setUploading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const preview = (accent: Customization['accent']) => { setDraft(current => ({ ...current, accent })); applyAccent(accent); };
  const upload = async (file: File) => {
    setUploading(true); setProblem('');
    try {
      const form = new FormData(); form.set('file', file);
      const response = await fetch('/api/workspace/logo', { method: 'POST', body: form });
      const data = await response.json() as { url?: string; error?: string };
      if (!response.ok || !data.url) throw new Error(data.error || 'The logo could not be uploaded.');
      setDraft(current => ({ ...current, logoUrl: data.url! }));
    } catch (cause) { setProblem(cause instanceof Error ? cause.message : 'The logo could not be uploaded.'); } finally { setUploading(false); }
  };
  const changed = JSON.stringify(draft) !== JSON.stringify(saved);
  return <>
    <div className="page-head"><h1>Branding</h1><div className="page-actions">{changed && <button className="secondary" onClick={() => { setDraft(saved); applyAccent(saved.accent); }}>Cancel</button>}<button className="primary" disabled={saving || uploading || !changed} onClick={() => void save(draft)}>{saving ? 'Saving…' : 'Save changes'}</button></div></div>
    <section className="workspace-settings">
      <h2>Colour</h2>
      <div className="workspace-setting stacked"><div><strong>Accent colour</strong><span>Used for links, highlights and selected items, for everyone in this workspace.</span></div>
        <div className="accent-picker" role="radiogroup" aria-label="Accent colour">{accentColors.map(accent => <button type="button" role="radio" aria-checked={draft.accent === accent} key={accent} onClick={() => preview(accent)}><i style={{ background: accentHex[accent] }}>{draft.accent === accent && <FiCheck />}</i>{accent}</button>)}</div>
      </div>
      <h2>Logo</h2>
      <div className="workspace-setting stacked"><div><strong>Workspace logo</strong><span>Shows in the top bar, on the sign-in page and in invitation emails. PNG, JPEG or WebP, under 1 MB. A wide image with a clear background works best.</span></div>
        <div className="logo-picker"><span className="logo-preview">{draft.logoUrl ? <img src={draft.logoUrl} alt="Workspace logo" /> : <FiImage />}</span><button type="button" className="secondary" disabled={uploading} onClick={() => input.current?.click()}>{uploading ? 'Uploading…' : draft.logoUrl ? 'Change logo' : 'Upload logo'}</button>{draft.logoUrl && <button type="button" className="text-link" onClick={() => setDraft(current => ({ ...current, logoUrl: '' }))}>Remove</button>}<input ref={input} type="file" hidden accept="image/png,image/jpeg,image/webp" aria-label="Choose a logo" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(file); }} /></div>
      </div>
      <h2>Sign-in page</h2>
      <label className="workspace-setting stacked"><div><strong>Welcome message</strong><span>Shown to your team above the sign-in button.</span></div><input maxLength={200} value={draft.welcomeMessage} onChange={event => setDraft({ ...draft, welcomeMessage: event.target.value })} placeholder="Welcome back. Sign in to see your leads." /></label>
      {problem && <p className="team-field-error" role="alert">{problem}</p>}
    </section>
  </>;
}

function SalesSetupForm(props: FormProps) {
  const { saved, save, saving, problem } = useSave(props);
  const [draft, setDraft] = useState(saved);
  const [newType, setNewType] = useState('');
  const changed = JSON.stringify(draft) !== JSON.stringify(saved);
  const rename = (status: LeadStatus, value: string) => {
    const next = { ...draft.statusLabels };
    if (value.trim() && value !== status) next[status] = value; else delete next[status];
    setDraft({ ...draft, statusLabels: next });
  };
  const addType = () => {
    const type = newType.trim();
    if (!type || draft.taskTypes.some(item => item.toLowerCase() === type.toLowerCase())) return;
    setDraft({ ...draft, taskTypes: [...draft.taskTypes, type] });
    setNewType('');
  };
  return <>
    <div className="page-head"><h1>Sales setup</h1><div className="page-actions">{changed && <button className="secondary" onClick={() => setDraft(saved)}>Cancel</button>}<button className="primary" disabled={saving || !changed} onClick={() => void save(draft)}>{saving ? 'Saving…' : 'Save changes'}</button></div></div>
    <section className="workspace-settings">
      <h2>Pipeline stages and lead statuses</h2>
      <p className="setup-note">Rename these to match how your team sells. Existing leads and reports update with the new names. Won and Lost keep their meaning whatever you call them.</p>
      <div className="status-names">{leadStatuses.map(status => <label key={status}><span>{status}</span><input maxLength={30} aria-label={`Name for ${status}`} placeholder={status} value={draft.statusLabels[status] ?? ''} onChange={event => rename(status, event.target.value)} /></label>)}</div>
      <h2>Task types</h2>
      <p className="setup-note">The choices people see when they create a task. Removing a type doesn&apos;t change tasks that already use it.</p>
      <div className="task-type-list">{draft.taskTypes.map((type, index) => <div key={type}><span>{type}</span><button type="button" aria-label={`Move ${type} up`} disabled={index === 0} onClick={() => setDraft({ ...draft, taskTypes: moved(draft.taskTypes, index, -1) })}><FiChevronUp /></button><button type="button" aria-label={`Move ${type} down`} disabled={index === draft.taskTypes.length - 1} onClick={() => setDraft({ ...draft, taskTypes: moved(draft.taskTypes, index, 1) })}><FiChevronDown /></button><button type="button" aria-label={`Remove ${type}`} disabled={draft.taskTypes.length === 1} onClick={() => setDraft({ ...draft, taskTypes: draft.taskTypes.filter(item => item !== type) })}><FiTrash2 /></button></div>)}</div>
      <form className="task-type-add" onSubmit={event => { event.preventDefault(); addType(); }}><input maxLength={40} aria-label="New task type" placeholder="Add a task type, like Site visit" value={newType} onChange={event => setNewType(event.target.value)} /><button className="secondary" disabled={!newType.trim() || draft.taskTypes.length >= 30}><FiPlus /> Add</button><button type="button" className="text-link" onClick={() => setDraft({ ...draft, taskTypes: defaultTaskTypes })}><FiRotateCcw /> Reset to Scout&apos;s list</button></form>
      {problem && <p className="team-field-error" role="alert">{problem}</p>}
    </section>
  </>;
}
