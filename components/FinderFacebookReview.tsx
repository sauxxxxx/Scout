'use client';

import { useState } from 'react';
import { FiCheck, FiExternalLink, FiFacebook } from 'react-icons/fi';
import { ScoutSelect } from '@/components/ScoutSelect';
import { facebookActivity, facebookResearchSchema, normalizeFacebookPageUrl, readFacebookResearch, type FacebookResearch, type SalesProspect } from '@/lib/finder-sales';

type Prospect = SalesProspect & { id: string; reviewVersion: number };
/** onNext moves to the next business in the list that still needs its Facebook page checked. */
export function FinderFacebookReview({ result, onSave, onDirty: reportDirty, onNext, remaining = 0 }: { result: Prospect; onSave: (url: string, status: 'confirmed' | 'possible' | 'not_found', research: FacebookResearch, version: number) => Promise<void>; onDirty: (dirty: boolean) => void; onNext?: () => void; remaining?: number }) {
  const [dirty, setDirty] = useState(false);
  const onDirty = (value: boolean) => { setDirty(value); reportDirty(value); };
  const [url, setUrl] = useState(result.socialUrl);
  const [research, setResearch] = useState(() => readFacebookResearch(result.facebookResearch));
  const [version, setVersion] = useState(result.reviewVersion);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const update = (values: Partial<FacebookResearch>) => { setResearch(current => ({ ...current, ...values })); onDirty(true); setSaved(''); };
  const save = async (status: 'confirmed' | 'possible' | 'not_found') => {
    const { reviewedAt: _at, reviewedBy: _by, ...editable } = research;
    void _at; void _by;
    const parsed = facebookResearchSchema.safeParse(status === 'not_found' ? {} : editable);
    if (!parsed.success) { setError(parsed.error.issues.map(issue => issue.message).join(' ')); return; }
    if (status !== 'not_found' && !normalizeFacebookPageUrl(url)) { setError('Use a business page URL, not a post, share link or group.'); return; }
    setBusy(true); setError('');
    try { await onSave(url, status, parsed.data, version); setVersion(value => value + 1); onDirty(false); setSaved(status === 'confirmed' ? 'Page confirmed. Assessment is refreshing.' : status === 'not_found' ? 'No page found in the sources you checked.' : 'Review saved. Page identity still needs confirmation.'); if (status === 'not_found') { setUrl(''); setResearch(readFacebookResearch({})); } }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Review could not be saved.'); }
    finally { setBusy(false); }
  };
  const confirmed = Boolean(normalizeFacebookPageUrl(url) && research.pageName?.trim() && research.identityChecks.includes('name') && research.identityChecks.length >= 2);
  const activity = facebookActivity(result);
  return <section className="finder-sales-review"><h3><FiFacebook /> Facebook review</h3>
    <div className="finder-review-source"><a href={`https://www.facebook.com/search/pages?q=${encodeURIComponent(result.name + ' ' + (result.city || ''))}`} target="_blank" rel="noreferrer">Find the page <FiExternalLink /></a>{normalizeFacebookPageUrl(url) && <a href={normalizeFacebookPageUrl(url)} target="_blank" rel="noreferrer">Open page <FiExternalLink /></a>}</div>
    <label>Business page URL<input type="url" value={url} onChange={event => { setUrl(event.target.value); onDirty(true); setSaved(''); }} placeholder="https://www.facebook.com/business" /></label>
    <div className="finder-research-grid"><label>Page name<input value={research.pageName || ''} maxLength={160} onChange={event => update({ pageName: event.target.value })} /></label><label>Page location<input value={research.pageLocation || ''} maxLength={240} onChange={event => update({ pageLocation: event.target.value })} /></label></div>
    <fieldset className="finder-identity-checks"><legend>Match this page to the business</legend>{(['name', 'location', 'contact'] as const).map(check => <label key={check}><input type="checkbox" checked={research.identityChecks.includes(check)} onChange={() => update({ identityChecks: research.identityChecks.includes(check) ? research.identityChecks.filter(value => value !== check) : [...research.identityChecks, check] })} />{check === 'name' ? 'Name matches' : check === 'location' ? 'Location matches' : 'Phone or email matches'}</label>)}<small>Confirm the name and at least one other detail. A matching name alone is not enough.</small></fieldset>
    <h4>Observed on the page</h4><div className="finder-research-grid"><label>Latest post you checked<input type="date" max={new Date().toISOString().slice(0, 10)} value={research.lastPostAt || ''} onChange={event => update({ lastPostAt: event.target.value })} /></label><label>Post source link<input type="url" value={research.postUrl || ''} maxLength={2000} onChange={event => update({ postUrl: event.target.value })} placeholder="Direct link to the post" /></label></div>
    <small className="finder-review-hint">Optional. Recent means a dated post observed in the last 30 days; it does not prove buying intent.</small>
    <div className="finder-research-grid"><label>Messaging<ScoutSelect ariaLabel="Facebook messaging" value={research.messenger} options={[{ value: 'unknown', label: 'Not checked' }, { value: 'available', label: 'Message button available' }, { value: 'unavailable', label: 'Messaging unavailable' }]} onChange={value => update({ messenger: value as FacebookResearch['messenger'] })} /></label><label>Website presence<ScoutSelect ariaLabel="Reviewed website presence" value={research.websiteStatus} options={[{ value: 'unknown', label: 'Not checked' }, { value: 'present', label: 'Website found' }, { value: 'not_found', label: 'Not found in checked sources' }]} onChange={value => update({ websiteStatus: value as FacebookResearch['websiteStatus'] })} /></label></div>
    <label>Services or offers observed<textarea rows={2} maxLength={1200} value={research.services || ''} onChange={event => update({ services: event.target.value })} placeholder="What does this business sell?" /></label>
    <label>Sales opportunity observed<textarea rows={2} maxLength={1200} value={research.customerSignals || ''} onChange={event => update({ customerSignals: event.target.value })} placeholder="Record a specific issue, request or booking flow to discuss." /></label>
    <label>Opening message to review<textarea rows={2} maxLength={1200} value={research.conversationAngle || ''} onChange={event => update({ conversationAngle: event.target.value })} placeholder="Start with an observation and a question, not an assumed need." /></label>
    <details><summary>Additional notes</summary>{(['promotions', 'activity', 'tone', 'notes'] as const).map(field => <label key={field}>{field === 'tone' ? 'Brand tone' : field === 'activity' ? 'Activity observations' : field === 'promotions' ? 'Promotions' : 'Research notes'}<textarea rows={2} maxLength={1200} value={research[field] || ''} onChange={event => update({ [field]: event.target.value })} /></label>)}</details>
    {result.facebookResearch?.reviewedBy && <small className="finder-review-hint">Reviewed by {result.facebookResearch.reviewedBy} · {new Date(result.facebookResearch.reviewedAt || result.facebookVerifiedAt || '').toLocaleDateString()} · {activity === 'recent' ? 'Recent post observed' : activity === 'older' ? 'Older post observed' : 'Activity unknown'}</small>}
    {error && <p role="alert" className="finder-review-error">{error}</p>}{saved && <p role="status" className="finder-review-saved"><FiCheck />{saved}</p>}
    <div className="finder-review-buttons"><button className="primary" disabled={busy || !confirmed} onClick={() => save('confirmed')}>{busy ? 'Saving…' : 'Confirm & save review'}</button><button className="secondary" disabled={busy || !url.trim()} onClick={() => save('possible')}>Save for review</button><button disabled={busy} onClick={() => save('not_found')}>No page found</button></div>
  {onNext && <div className="finder-review-next"><span>{remaining} more in this list to review</span><button type="button" className="secondary" disabled={busy || dirty} title={dirty ? 'Save or clear your changes first' : undefined} onClick={onNext}>{saved ? 'Next to review' : 'Skip to next'} →</button></div>}</section>;
}
