'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FiCheck, FiMonitor, FiUpload } from 'react-icons/fi';
import { applyDensity, applyFontSize, dateFormats, densities, fontSizes, landingPages, notificationDefaults, pipelineViews, profileDefaults, timeFormats, timezones, type ProfileUpdate } from '@/lib/profile';
import { useWorkspaceMembers } from './WorkspaceMembers';
import { ScoutSelect } from './ScoutSelect';
import { ProfilePhotoEditor } from './ProfilePhotoEditor';
import { ProfileDialog } from './ProfileDialog';

export type ProfileData = ProfileUpdate & { id: string; email: string; joinedAt: string };
type Membership = { id: string; name: string; role: string; joinedAt: string };
type ActiveSession = { id: string; label: string; current: boolean; createdAt: string; lastSeenAt: string; expiresAt: string };
type ProfileResponse = { profile?: ProfileData; memberships?: Membership[]; sessions?: ActiveSession[]; signInMethod?: string; error?: string; fields?: Record<string, string[]> };
const emptyProfile: ProfileData = { id: '', email: '', name: '', avatarUrl: '', jobTitle: '', phone: '', timezone: 'Asia/Manila', language: 'English (Philippines)', dateFormat: 'MMM d, yyyy', timeFormat: '12-hour', preferences: profileDefaults, notifications: notificationDefaults, joinedAt: '' };
const views = [{ value: 'Profile', label: 'Personal information' }, { value: 'Preferences', label: 'Preferences' }, { value: 'Notifications', label: 'Notifications' }, { value: 'Security', label: 'Security' }];

function initials(name: string) { return name.split(/\s+/).filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase() || 'SC'; }
function accountDate(value: string, profile: ProfileData, withTime = true) {
  if (!value) return 'Not available';
  const date = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(date.getTime())) return 'Not available';
  const dateLabel = new Intl.DateTimeFormat(profile.dateFormat === 'dd/MM/yyyy' ? 'en-GB' : 'en-US', { month: profile.dateFormat === 'MMM d, yyyy' ? 'short' : '2-digit', day: profile.dateFormat === 'MMM d, yyyy' ? 'numeric' : '2-digit', year: 'numeric', timeZone: profile.timezone }).format(date);
  return withTime ? `${dateLabel}, ${new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit', hour12: profile.timeFormat === '12-hour', timeZone: profile.timezone }).format(date)}` : dateLabel;
}
function Choice<T extends string | number>({ value, options, onChange, label }: { value: T; options: readonly T[]; onChange: (value: T) => void; label: string }) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  return <div className="profile-choice" role="radiogroup" aria-label={label}>{options.map((option, index) => <button type="button" role="radio" aria-checked={value === option} tabIndex={value === option ? 0 : -1} ref={node => { buttons.current[index] = node; }} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) + options.length) % options.length; onChange(options[next]); buttons.current[next]?.focus(); } }} onClick={() => onChange(option)} key={String(option)}>{String(option)}</button>)}</div>;
}
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) { return <button type="button" className={`profile-switch ${checked ? 'on' : ''}`} role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}><span /></button>; }
function Avatar({ url, name }: { url: string; name: string }) {
  const [failedUrl, setFailedUrl] = useState('');
  return <span className="profile-avatar">{url && failedUrl !== url ? <img src={url} alt="Your profile photo" onError={() => setFailedUrl(url)} /> : initials(name)}</span>;
}

export function ProfileWorkspace({ theme, view, onViewChange, notify, onProfileSaved, onDraftChange }: { theme: ProfileUpdate['preferences']['theme']; view: string; onViewChange: (view: string) => void; notify: (message: string) => void; onProfileSaved: (profile: ProfileData) => void; onDraftChange: (dirty: boolean, discard: () => void, busy?: boolean) => void }) {
  const { refresh: refreshMembers, assignableMembers, currentRole, currentMember } = useWorkspaceMembers();
  const [profile, setProfile] = useState<ProfileData>(emptyProfile);
  const [baseline, setBaseline] = useState<ProfileData>(emptyProfile);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [signInMethod, setSignInMethod] = useState('Google');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string[]>>({});
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const [photoPreview, setPhotoPreview] = useState('');
  const [ending, setEnding] = useState(false);
  const [endScope, setEndScope] = useState<'others' | 'all' | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const dirty = useMemo(() => !!photoBlob || JSON.stringify(profile) !== JSON.stringify(baseline), [profile, baseline, photoBlob]);
  const discard = useCallback(() => { setProfile(baseline); setPhotoBlob(null); setPhotoFile(null); setError(''); setFields({}); }, [baseline]);
  useEffect(() => { onDraftChange(dirty || !!photoFile, discard, saving); return () => onDraftChange(false, () => {}); }, [dirty, photoFile, discard, saving, onDraftChange]);
  useEffect(() => { if (!dirty && !photoFile) return; const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [dirty, photoFile]);
  // Show a font size as soon as it's picked, and put the saved one back if the choice is discarded or left unsaved.
  useEffect(() => { if (loading) return; applyFontSize(profile.preferences.fontSize); return () => applyFontSize(baseline.preferences.fontSize); }, [loading, profile.preferences.fontSize, baseline.preferences.fontSize]);
  useEffect(() => { if (loading) return; applyDensity(profile.preferences.density); return () => applyDensity(baseline.preferences.density); }, [loading, profile.preferences.density, baseline.preferences.density]);
  // Synchronize the preview with a browser-owned object URL and release it on replacement.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { const url = photoBlob ? URL.createObjectURL(photoBlob) : ''; setPhotoPreview(url); return () => { if (url) URL.revokeObjectURL(url); }; }, [photoBlob]);
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch('/api/profile', { signal }); const data = await response.json() as ProfileResponse;
      if (!response.ok || !data.profile) throw new Error(data.error || 'Profile could not be loaded.');
      setProfile(data.profile); setBaseline(data.profile); setMemberships(data.memberships || []); setSessions(data.sessions || []); setSignInMethod(data.signInMethod || 'Google');
    } catch (cause) { if (!signal?.aborted) setLoadError(cause instanceof Error ? cause.message : 'Profile could not be loaded.'); } finally { if (!signal?.aborted) setLoading(false); }
  }, []);
  // Fetch the account once on mount; all loaded state comes from this external request.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  const save = async () => {
    if (saving) return;
    setFields({}); setError('');
    if (profile.name.trim().length < 2) { setFields({ name: ['Enter at least two characters.'] }); onViewChange('Profile'); return; }
    setSaving(true); let uploaded = '';
    try {
      let avatarUrl = profile.avatarUrl;
      if (photoBlob) {
        const form = new FormData(); form.set('file', photoBlob, 'profile.jpg');
        const response = await fetch('/api/profile/photo', { method: 'POST', body: form }); const data = await response.json() as { url?: string; error?: string };
        if (!response.ok || !data.url) throw new Error(data.error || 'Photo could not be uploaded.');
        uploaded = avatarUrl = data.url;
      }
      const payload: ProfileUpdate = { name: profile.name, jobTitle: profile.jobTitle, phone: profile.phone, avatarUrl, timezone: profile.timezone, language: profile.language, dateFormat: profile.dateFormat, timeFormat: profile.timeFormat, preferences: { ...profile.preferences, theme }, notifications: profile.notifications };
      const response = await fetch('/api/profile', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }); const data = await response.json() as ProfileResponse;
      if (!response.ok || !data.profile) { if (data.fields) { setFields(data.fields); if (['name', 'jobTitle', 'phone', 'avatarUrl'].some(key => data.fields?.[key])) onViewChange('Profile'); else if (data.fields.preferences) onViewChange('Preferences'); } throw new Error(data.fields ? 'Check the highlighted fields.' : data.error || 'Changes could not be saved.'); }
      uploaded = ''; setProfile(data.profile); setBaseline(data.profile); setPhotoBlob(null); setMemberships(data.memberships || memberships); setSessions(data.sessions || sessions); onProfileSaved(data.profile); notify('Changes saved');
      void refreshMembers().catch(() => {});
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Changes could not be saved.'); if (uploaded) void fetch(uploaded, { method: 'DELETE' }).catch(() => {}); } finally { setSaving(false); }
  };
  const endSessions = async () => {
    if (!endScope || ending) return;
    setEnding(true); setError('');
    try {
      const response = await fetch(`/api/profile?scope=${endScope}`, { method: 'DELETE' }); const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || 'Sessions could not be ended.');
      if (endScope === 'all') { discard(); window.setTimeout(() => { window.location.href = '/'; }, 0); return; }
      setSessions(value => value.filter(session => session.current)); setEndScope(null); notify('Other sessions signed out');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Sessions could not be ended.'); setEndScope(null); } finally { setEnding(false); }
  };
  const updatePreference = <K extends keyof ProfileData['preferences']>(key: K, value: ProfileData['preferences'][K]) => setProfile(current => ({ ...current, preferences: { ...current.preferences, [key]: value } }));
  const edit = (key: 'name' | 'jobTitle' | 'phone', value: string) => { setProfile(current => ({ ...current, [key]: value })); setFields(current => ({ ...current, [key]: [] })); };
  if (loading) return <div className="profile-workspace"><header className="profile-page-head"><h1>Profile</h1></header><div className="profile-loading" role="status">Loading profile…</div></div>;
  if (loadError) return <div className="profile-workspace"><header className="profile-page-head"><h1>Profile</h1></header><p role="alert">{loadError}</p><button className="profile-primary" onClick={() => { setLoading(true); setLoadError(''); void load(); }}>Try again</button></div>;
  const availableOwners = currentRole === 'owner' || currentRole === 'admin' ? assignableMembers : assignableMembers.filter(member => member.id === currentMember?.id);
  return <div className="profile-workspace">
    <header className="profile-page-head"><h1>Profile</h1></header>
    <nav className="profile-mobile-tabs" aria-label="Profile sections">{views.map(item => <button key={item.value} aria-current={view === item.value ? 'page' : undefined} onClick={() => onViewChange(item.value)}>{item.label}</button>)}</nav>
    {error && <p className="profile-error profile-save-error" role="alert">{error}</p>}
    <fieldset className="profile-editor" disabled={saving}>
    {view === 'Profile' && <>
      <section className="profile-identity-row"><Avatar url={photoPreview || profile.avatarUrl} name={profile.name} /><div className="profile-identity"><div><h2>{profile.name || 'Your name'}</h2><span className="profile-role">{memberships[0]?.role || 'member'}</span></div><span>{profile.email}</span><div className="profile-photo-actions"><button type="button" onClick={() => input.current?.click()}><FiUpload />Change photo</button>{(photoBlob || profile.avatarUrl) && <button type="button" onClick={() => { setPhotoBlob(null); setProfile(current => ({ ...current, avatarUrl: '' })); }}>Remove</button>}</div></div>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden aria-label="Choose profile photo" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setError('Choose a JPEG, PNG, or WebP photo.'); return; } if (file.size > 10 * 1024 * 1024) { setError('Choose a photo under 10 MB.'); return; } setError(''); setPhotoFile(file); }} />
      </section>
      <section className="profile-section"><h2>Personal information</h2><div className="profile-form-grid">
        {([['name', 'Full name', 'name'], ['jobTitle', 'Job title', 'organization-title'], ['phone', 'Phone', 'tel']] as const).map(([key, label, complete]) => <label key={key} htmlFor={`profile-${key}`}><span>{label}</span><input id={`profile-${key}`} autoComplete={complete} type={key === 'phone' ? 'tel' : 'text'} maxLength={key === 'phone' ? 80 : 120} value={profile[key]} aria-invalid={!!fields[key]?.length} aria-describedby={fields[key]?.length ? `error-${key}` : undefined} onChange={event => edit(key, event.target.value)} />{!!fields[key]?.length && <small id={`error-${key}`} className="profile-error">{fields[key][0]}</small>}</label>)}
        <div className="profile-readonly"><span>Email</span><strong>{profile.email}</strong><small>{signInMethod === 'Google' ? 'Managed by your Google account' : 'Managed by your sign-in provider'}</small></div>
      </div>{!!fields.avatarUrl?.length && <p className="profile-error">{fields.avatarUrl[0]}</p>}</section>
      <section className="profile-section profile-membership"><h2>Workspace</h2>{memberships.map(item => <article key={item.id}><div><strong>{item.name}</strong><span>Joined {accountDate(item.joinedAt, profile, false)}</span></div><span className="profile-role">{item.role}</span></article>)}</section>
    </>}
    {view === 'Preferences' && <>
      <section className="profile-section"><h2>Appearance and defaults</h2>{!!fields.preferences?.length && <p className="profile-error">{fields.preferences[0]}</p>}
        <div className="profile-setting-row"><div><strong>Font size</strong><span>Previews as you pick. Save to keep it on every device you use.</span></div><Choice label="Font size" value={profile.preferences.fontSize} options={fontSizes} onChange={value => updatePreference('fontSize', value)} /></div><div className="profile-setting-row"><div><strong>Row spacing</strong><span>Compact fits more leads and tasks on screen.</span></div><Choice label="Row spacing" value={profile.preferences.density} options={densities} onChange={value => updatePreference('density', value)} /></div><div className="profile-setting-row"><div><strong>Start page</strong><span>Where Scout opens when you sign in.</span></div><Choice label="Start page" value={profile.preferences.landingPage} options={landingPages} onChange={(value: string) => setProfile(current => current && ({ ...current, preferences: { ...current.preferences, landingPage: value as (typeof landingPages)[number] } }))} /></div><div className="profile-setting-row"><div><strong>Pipeline view</strong><span>Open Pipeline in this view.</span></div><Choice label="Pipeline view" value={profile.preferences.pipelineView} options={pipelineViews} onChange={value => updatePreference('pipelineView', value)} /></div>
        <div className="profile-setting-row"><div><strong>Default lead owner</strong><span>Used for new leads and opportunities.</span></div><ScoutSelect ariaLabel="Default lead owner" value={profile.preferences.defaultOwner} options={[{ value: 'Me', label: 'You' }, ...availableOwners.filter(member => member.id !== currentMember?.id).map(member => ({ value: member.id, label: member.name }))]} onChange={value => updatePreference('defaultOwner', value)} /></div>
        <div className="profile-setting-row"><div><strong>Finder radius</strong><span>Starting area for a new search, in km.</span></div><Choice label="Finder radius" value={profile.preferences.finderRadius} options={[3, 5, 10, 15, 25, 50]} onChange={value => updatePreference('finderRadius', value)} /></div>
        <div className="profile-setting-row"><div><strong>Finder lead count</strong><span>Target count for a new search.</span></div><input className="profile-number" type="number" inputMode="numeric" min={1} max={300} aria-label="Finder lead count" value={profile.preferences.finderLeadCount} onChange={event => updatePreference('finderLeadCount', Math.min(300, Math.max(1, Number(event.target.value) || 1)))} /></div>
      </section>
      <section className="profile-section"><h2>Opportunity cards</h2><div className="profile-card-properties">{([['value', 'Deal value'], ['owner', 'Owner'], ['closeDate', 'Close date'], ['probability', 'Probability'], ['priority', 'Priority'], ['nextAction', 'Next action']] as const).map(([key, label]) => <button type="button" aria-pressed={profile.preferences.cardProperties[key]} onClick={() => updatePreference('cardProperties', { ...profile.preferences.cardProperties, [key]: !profile.preferences.cardProperties[key] })} key={key}><span>{profile.preferences.cardProperties[key] && <FiCheck />}</span>{label}</button>)}</div></section>
      <section className="profile-section"><h2>Dates and times</h2><div className="profile-setting-row"><div><strong>Timezone</strong><span>Used for dates across Scout, and for working out what counts as today.</span></div><ScoutSelect ariaLabel="Account timezone" value={profile.timezone} options={timezones.map(value => ({ value, label: value.replace('Asia/', '') }))} onChange={timezone => setProfile(current => ({ ...current, timezone: timezone as ProfileData['timezone'] }))} /></div><div className="profile-setting-row"><strong>Date format</strong><Choice label="Date format" value={profile.dateFormat} options={dateFormats} onChange={dateFormat => setProfile(current => ({ ...current, dateFormat }))} /></div><div className="profile-setting-row"><strong>Time format</strong><Choice label="Time format" value={profile.timeFormat} options={timeFormats} onChange={timeFormat => setProfile(current => ({ ...current, timeFormat }))} /></div><div className="profile-format-preview">Preview <time>{accountDate('2026-10-05T08:30:00Z', profile)}</time></div></section>
    </>}
    {view === 'Notifications' && <section className="profile-section"><h2>Notifications</h2><div className="profile-setting-row"><div><strong>Task reminders</strong><span>Show due follow-up reminders while Scout is open.</span></div><Toggle checked={profile.notifications.taskReminders} onChange={taskReminders => setProfile(current => ({ ...current, notifications: { ...current.notifications, taskReminders } }))} label="Task reminders" /></div>{([['leadAssignments', 'Lead and task assignments', 'Tell me in Scout when someone assigns work to me.'], ['opportunityChanges', 'Opportunity changes', 'Tell me when someone moves or reassigns my opportunity.']] as const).map(([key, title, description]) => <div className="profile-setting-row" key={key}><div><strong>{title}</strong><span>{description}</span></div><Toggle checked={profile.notifications[key]} onChange={value => setProfile(current => ({ ...current, notifications: { ...current.notifications, [key]: value } }))} label={title} /></div>)}</section>}
    {view === 'Security' && <>
      <section className="profile-section"><h2>Sign-in</h2><div className="profile-provider"><span className="profile-provider-mark">{signInMethod === 'Google' ? 'G' : 'SC'}</span><div><strong>{signInMethod}</strong><span>{profile.email}</span></div><span className="profile-connected"><FiCheck />Connected</span></div>{signInMethod === 'Google' && <p className="profile-note">Manage your password and account recovery in <a href="https://myaccount.google.com/security" target="_blank" rel="noreferrer">Google Account</a>.</p>}</section>
      <section className="profile-section"><header><h2>Active sessions <span>{sessions.length}</span></h2><button className="profile-text-button" disabled={!sessions.some(item => !item.current)} onClick={() => setEndScope('others')}>Sign out others</button></header><div className="profile-sessions">{sessions.map(item => <article key={item.id}><FiMonitor /><div><strong>{item.label}{item.current && <span className="profile-current">Current</span>}</strong><span>Last active {accountDate(item.lastSeenAt, profile)}</span><small>Signed in {accountDate(item.createdAt, profile)} · Expires {accountDate(item.expiresAt, profile)}</small></div></article>)}</div>{!sessions.length && <p className="profile-note">No browser sessions are recorded for this sign-in method.</p>}</section>
      <section className="profile-section profile-signout"><div><h2>Sign out everywhere</h2><p>End all Scout sessions, including this browser.</p></div><button type="button" onClick={() => setEndScope('all')}>Sign out all sessions</button></section>
    </>}
    </fieldset>
    {dirty && <div className="profile-save-bar" role="region" aria-label="Unsaved profile changes"><span>Unsaved changes</span><button disabled={saving} onClick={discard}>Cancel</button><button className="profile-primary" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save changes'}</button></div>}
    {photoFile && <ProfilePhotoEditor file={photoFile} onClose={() => setPhotoFile(null)} onApply={blob => { setPhotoBlob(blob); setPhotoFile(null); }} />}
    {endScope && <ProfileDialog title={endScope === 'all' ? 'Sign out all sessions?' : 'Sign out other sessions?'} onClose={() => setEndScope(null)} busy={ending}><p>{endScope === 'all' ? 'You will return to the sign-in screen. Other browsers will need to sign in again.' : 'This browser stays signed in. Other browsers will need to sign in again.'}</p>{dirty && endScope === 'all' && <p className="profile-error">Your unsaved changes will be discarded.</p>}<footer><button disabled={ending} onClick={() => setEndScope(null)}>Cancel</button><button className="profile-primary" disabled={ending} onClick={() => void endSessions()}>{ending ? 'Signing out…' : 'Sign out'}</button></footer></ProfileDialog>}
  </div>;
}
