'use client';

import { useMemo, useState } from 'react';
import { ProfileDialog } from '@/components/ProfileDialog';
import { FACEBOOK_BULK_MAX, parseFacebookLines, type BulkFacebookRow } from '@/lib/facebook-bulk';

/** Facebook-only businesses never show up on Google, so reps paste the pages they find and Scout queues them for review. */
export function FinderBulkFacebook({ location, onClose, onAdd }: { location: string; onClose: () => void; onAdd: (prospects: BulkFacebookRow[], city: string) => Promise<void> }) {
  const [text, setText] = useState('');
  const [city, setCity] = useState(location);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const parsed = useMemo(() => parseFacebookLines(text), [text]);
  const submit = async () => {
    setBusy(true); setError('');
    try { await onAdd(parsed.rows, city.trim()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'These pages could not be added.'); }
    finally { setBusy(false); }
  };
  return <ProfileDialog className="finder-sales-dialog" title="Add Facebook pages in bulk" busy={busy} onClose={() => { if (!busy) onClose(); }}>
    <form className="finder-manual-form finder-bulk-facebook" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <p>Paste one page per line, up to {FACEBOOK_BULK_MAX}. Put the business name before the link, or paste just the link and Scout reads the name from it. Rows copied from a sheet with a name column and a link column work too.</p>
      <label>Facebook pages<textarea rows={7} spellCheck={false} value={text} onChange={event => setText(event.target.value)} placeholder={'Smile Dental Cebu\thttps://www.facebook.com/smiledentalcebu\nhttps://www.facebook.com/anasalon.davao'} /></label>
      <label>City or municipality<input required minLength={2} maxLength={160} value={city} onChange={event => setCity(event.target.value)} /></label>
      {text.trim() && <div className="finder-bulk-summary" aria-live="polite">
        <strong>{parsed.rows.length} page{parsed.rows.length === 1 ? '' : 's'} ready</strong>
        {parsed.extra > 0 && <span> · {parsed.extra} over the limit of {FACEBOOK_BULK_MAX} left out</span>}
        {parsed.rows.length > 0 && <ul className="finder-bulk-list">{parsed.rows.map(row => <li key={row.line}><span>{row.name}</span><small>{row.facebookUrl.replace(/^https:\/\/www\./, '')}</small></li>)}</ul>}
        {parsed.problems.length > 0 && <details open={parsed.rows.length === 0}><summary>{parsed.problems.length} line{parsed.problems.length === 1 ? '' : 's'} left out</summary><ul className="finder-bulk-problems">{parsed.problems.map(problem => <li key={problem.line}>Line {problem.line}: {problem.reason}</li>)}</ul></details>}
      </div>}
      <label className="finder-checkbox-label"><input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} />I checked that these businesses are inside the search area around {location}.</label>
      {error && <p role="alert" className="finder-review-error">{error}</p>}
      <footer><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="primary" disabled={busy || !checked || !parsed.rows.length || city.trim().length < 2}>{busy ? 'Adding…' : `Add ${parsed.rows.length || ''} for review`.replace('  ', ' ')}</button></footer>
    </form>
  </ProfileDialog>;
}
