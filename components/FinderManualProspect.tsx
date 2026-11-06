'use client';

import { useState } from 'react';
import { ProfileDialog } from '@/components/ProfileDialog';
import { normalizeFacebookPageUrl } from '@/lib/finder-sales';

export function FinderManualProspect({ location, onClose, onAdd }: { location: string; onClose: () => void; onAdd: (values: { name: string; city: string; address: string; facebookUrl: string; phone: string; email: string; website: string; locationConfirmed: true }) => Promise<void> }) {
  const [form, setForm] = useState({ name: '', city: location, address: '', facebookUrl: '', phone: '', email: '', website: '' });
  const [checked, setChecked] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [discard, setDiscard] = useState(false);
  const close = () => { if (!busy && (form.name || form.facebookUrl)) setDiscard(true); else if (!busy) onClose(); };
  return <ProfileDialog className="finder-sales-dialog" title="Add a Facebook prospect" onClose={close} busy={busy}><form className="finder-manual-form" onSubmit={async event => { event.preventDefault(); setBusy(true); setError(''); try { await onAdd({ ...form, locationConfirmed: true }); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Prospect could not be added.'); } finally { setBusy(false); } }}>
    <p>Use a public business page you found. Confirm its identity and contact options in the next step.</p>
    <label>Business name<input required minLength={2} maxLength={160} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
    <label>Facebook page URL<input required type="url" value={form.facebookUrl} onChange={event => setForm({ ...form, facebookUrl: event.target.value })} placeholder="https://www.facebook.com/business" /></label>
    <div className="finder-research-grid"><label>City or municipality<input required minLength={2} maxLength={160} value={form.city} onChange={event => setForm({ ...form, city: event.target.value })} /></label><label>Business address<input maxLength={300} value={form.address} onChange={event => setForm({ ...form, address: event.target.value })} /></label></div>
    <label className="finder-checkbox-label"><input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} />I checked that this business is inside the search area around {location}.</label>
    <details><summary>Published contact details (optional)</summary><label>Phone<input type="tel" inputMode="tel" autoComplete="tel" maxLength={80} value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value })} /></label><label>Email<input type="email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} /></label><label>Business website<input type="url" value={form.website} onChange={event => setForm({ ...form, website: event.target.value })} /></label></details>
    {error && <p role="alert" className="finder-review-error">{error}</p>}{discard ? <div className="finder-discard-question"><p>Discard this unsaved prospect?</p><button type="button" onClick={() => setDiscard(false)}>Keep editing</button><button type="button" onClick={onClose}>Discard</button></div> : <footer><button type="button" disabled={busy} onClick={close}>Cancel</button><button className="primary" disabled={busy || !checked || !normalizeFacebookPageUrl(form.facebookUrl)}>{busy ? 'Adding…' : 'Add & review page'}</button></footer>}
  </form></ProfileDialog>;
}
