'use client';

import { useMemo, useRef, useState } from 'react';
import { FiCheck, FiDownload, FiUploadCloud } from 'react-icons/fi';
import { ProfileDialog } from '@/components/ProfileDialog';
import { ScoutSelect } from '@/components/ScoutSelect';
import { useWorkspaceMembers } from '@/components/WorkspaceMembers';
import { useCustomization } from '@/components/crm/shared';
import { importBatches } from '@/lib/finder-batches';
import { guessMapping, LEAD_IMPORT_MAX_ROWS, LEAD_IMPORT_STATUSES, leadImportFields, leadImportTemplate, parseCsv, planLeadImport, type LeadImportField, type LeadImportMapping } from '@/lib/lead-import';
import type { Lead } from '@/lib/crm-types';

type Sheet = { fileName: string; table: string[][] };
type Outcome = { added: number; skipped: string[]; phoneMatches: { name: string; existing: string }[]; error?: string };

/** Adds leads from a CSV that Excel or Google Sheets saved. Rows go up in batches of 25, and leads already in Scout are skipped. */
export function LeadImport({ onClose, onImported }: { onClose: () => void; onImported: (leads: Lead[]) => void }) {
  const { assignableMembers, currentMember, currentRole } = useWorkspaceMembers();
  const { statusLabel } = useCustomization();
  const canAssignTeam = ['owner', 'admin'].includes(currentRole);
  const owners = canAssignTeam ? assignableMembers : assignableMembers.filter(member => member.id === currentMember?.id);
  const fileInput = useRef<HTMLInputElement>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [mapping, setMapping] = useState<LeadImportMapping | null>(null);
  const [defaults, setDefaults] = useState({ industry: '', city: '' });
  const [settings, setSettings] = useState({ ownerId: currentMember?.id || owners[0]?.id || '', status: 'New', priority: 'Medium', allowPhoneMatches: false });
  const [readError, setReadError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const busy = progress !== null;

  const plan = useMemo(() => sheet && mapping ? planLeadImport(sheet.table, mapping, defaults) : null, [sheet, mapping, defaults]);
  const headers = sheet?.table[0] || [];
  const columnOptions = [{ value: '-1', label: "Don't import" }, ...headers.map((header, index) => ({ value: String(index), label: header || `Column ${index + 1}` }))];

  const [pasted, setPasted] = useState('');
  const readText = (text: string, source: string, delimiter?: string) => {
    setReadError(''); setOutcome(null);
    if (text.length > 5 * 1024 * 1024) { setReadError('That’s more than 5 MB of text. Split it into smaller parts.'); return; }
    const table = parseCsv(text, delimiter);
    if (table.length < 2) { setReadError('Include the header row and at least one row of leads under it.'); return; }
    setSheet({ fileName: source, table });
    setMapping(guessMapping(table[0]));
  };
  const readFile = async (file: File | undefined) => {
    if (!file) return;
    if (!/\.(csv|txt|tsv)$/i.test(file.name) && !/csv|tab-separated|text\/plain/.test(file.type)) { setReadError('Choose a CSV file, or copy the rows from Google Sheets and paste them below.'); return; }
    readText(await file.text(), file.name);
  };
  /** Google Sheets copies cells as tab-separated text, so a paste goes straight to matching columns. */
  const readPaste = (text: string) => readText(text, 'Pasted from Google Sheets', text.includes('\t') ? '\t' : undefined);

  const runImport = async () => {
    if (!plan?.rows.length || !settings.ownerId) return;
    const added: Lead[] = [];
    const skipped: string[] = [];
    const phoneMatches: Outcome['phoneMatches'] = [];
    setOutcome(null);
    try {
      for (const batch of importBatches(plan.rows)) {
        setProgress({ done: added.length + skipped.length, total: plan.rows.length });
        const response = await fetch('/api/leads/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...settings, rows: batch }) });
        const data = await response.json() as { imported?: Lead[]; skipped?: string[]; phoneMatches?: Outcome['phoneMatches']; error?: string; fields?: Record<string, string[]> };
        if (!response.ok) throw new Error([data.error || 'This batch could not be saved.', ...Object.values(data.fields || {}).flat()].join(' '));
        added.push(...(data.imported || [])); skipped.push(...(data.skipped || [])); phoneMatches.push(...(data.phoneMatches || []));
        onImported(data.imported || []);
      }
      setOutcome({ added: added.length, skipped, phoneMatches });
    } catch (cause) {
      setOutcome({ added: added.length, skipped, phoneMatches, error: `${cause instanceof Error ? cause.message : 'The import stopped.'} ${added.length ? `${added.length} were added before it stopped. Import the same rows again to add the rest; leads already added are skipped.` : ''}`.trim() });
    } finally { setProgress(null); }
  };

  const setColumn = (field: LeadImportField, value: string) => mapping && setMapping({ ...mapping, [field]: Number(value) });
  const downloadTemplate = () => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([leadImportTemplate], { type: 'text/csv' }));
    link.download = 'scout-lead-import-template.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return <ProfileDialog className="lead-import-dialog" title="Import leads" busy={busy} onClose={onClose}>
    <div className="lead-import">
      {outcome && !outcome.error ? <section className="lead-import-done" aria-live="polite">
        <span className="lead-import-done-icon"><FiCheck aria-hidden="true" /></span>
        <h3>{outcome.added} lead{outcome.added === 1 ? '' : 's'} added</h3>
        <p>{outcome.skipped.length || outcome.phoneMatches.length ? [outcome.skipped.length ? `${outcome.skipped.length} already in Scout by name` : '', outcome.phoneMatches.length ? `${outcome.phoneMatches.length} share a phone number with a lead already in Scout` : ''].filter(Boolean).join(', ') + ', so they were skipped.' : 'They’re in Leads now with the owner and status you chose.'}</p>
        {outcome.skipped.length > 0 && <details><summary>Show businesses skipped by name</summary><ul>{outcome.skipped.map(name => <li key={name}>{name}</li>)}</ul></details>}
        {outcome.phoneMatches.length > 0 && <details open><summary>Show businesses with a matching phone</summary><ul>{outcome.phoneMatches.map(item => <li key={item.name}>{item.name} — same phone as {item.existing}</li>)}</ul><p className="lead-import-hint">If these are separate branches, import the same rows again with “Add rows whose phone is already in Scout” ticked. Rows already added are skipped.</p></details>}
        <footer><button type="button" className="primary" onClick={onClose}>Done</button></footer>
      </section> : !sheet || !mapping || !plan ? <section>
        <label className="lead-import-paste">
          <strong>Paste from Google Sheets</strong>
          <span>In your sheet, select the rows including the header row, copy them (Ctrl+C), then paste here (Ctrl+V).</span>
          <textarea value={pasted} rows={5} spellCheck={false} placeholder={'Business name\tCity\tPhone\nSmile Dental Clinic\tCebu City\t+63 912 345 6789'} onChange={event => setPasted(event.target.value)} onPaste={event => { const text = event.clipboardData.getData('text'); if (text.includes('\t')) { event.preventDefault(); setPasted(text); readPaste(text); } }} />
        </label>
        {pasted.trim() && <button type="button" className="secondary lead-import-use-paste" onClick={() => readPaste(pasted)}>Use pasted rows</button>}
        {readError && <p className="form-error" role="alert">{readError}</p>}
        <div className="lead-import-or"><span>or</span></div>
        <label className={`lead-import-drop${dragging ? ' dragging' : ''}`} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); void readFile(event.dataTransfer.files[0]); }}>
          <FiUploadCloud aria-hidden="true" />
          <strong>Upload a CSV file</strong>
          <span>Choose or drop a file. Up to {LEAD_IMPORT_MAX_ROWS.toLocaleString()} rows.</span>
          <input ref={fileInput} type="file" accept=".csv,.tsv,text/csv" onChange={event => void readFile(event.target.files?.[0])} />
        </label>
        <p className="lead-import-hint">Scout matches columns like Business name, Phone, Email and Facebook automatically.</p>
        <button type="button" className="text-link lead-import-template" onClick={downloadTemplate}><FiDownload aria-hidden="true" />Download a template</button>
      </section> : <section>
        <div className="lead-import-file"><strong>{sheet.fileName}</strong><span>{sheet.table.length - 1} row{sheet.table.length === 2 ? '' : 's'}</span><button type="button" className="text-link" disabled={busy} onClick={() => { setSheet(null); setMapping(null); setOutcome(null); setPasted(''); }}>Start over</button></div>

        <h3 className="lead-import-heading">Match your columns</h3>
        <div className="lead-import-mapping">{leadImportFields.map(field => <label key={field.key}><span>{field.label}{'required' in field && field.required ? ' *' : ''}</span><ScoutSelect ariaLabel={`Column for ${field.label}`} value={String(mapping[field.key])} options={columnOptions} onChange={value => setColumn(field.key, value)} /></label>)}</div>
        {(mapping.industry < 0 || mapping.city < 0 || plan.rows.some(row => row.industry === 'Not set' || row.city === 'Not set')) && <div className="lead-import-mapping lead-import-defaults">
          <label><span>Industry for rows without one</span><input value={defaults.industry} maxLength={120} placeholder="e.g. Dental clinics" onChange={event => setDefaults({ ...defaults, industry: event.target.value })} /></label>
          <label><span>City for rows without one</span><input value={defaults.city} maxLength={120} placeholder="e.g. Davao City" onChange={event => setDefaults({ ...defaults, city: event.target.value })} /></label>
        </div>}

        <h3 className="lead-import-heading">Assign</h3>
        <div className="lead-import-mapping">
          <label><span>Owner</span><ScoutSelect ariaLabel="Owner for imported leads" value={settings.ownerId} options={owners.map(member => ({ value: member.id, label: member.name }))} onChange={ownerId => setSettings({ ...settings, ownerId })} /></label>
          <label><span>Status</span><ScoutSelect ariaLabel="Status for imported leads" value={settings.status} options={LEAD_IMPORT_STATUSES.map(value => ({ value, label: statusLabel(value) }))} onChange={status => setSettings({ ...settings, status })} /></label>
          <label><span>Priority</span><ScoutSelect ariaLabel="Priority for imported leads" value={settings.priority} options={['High', 'Medium', 'Low'].map(value => ({ value, label: value }))} onChange={priority => setSettings({ ...settings, priority })} /></label>
        </div>
        <label className="lead-import-check"><input type="checkbox" checked={settings.allowPhoneMatches} onChange={event => setSettings({ ...settings, allowPhoneMatches: event.target.checked })} />Add rows whose phone is already in Scout (separate branches sharing a number)</label>

        <div className="lead-import-summary" aria-live="polite">
          <p><strong>{plan.rows.length} ready to add.</strong>{plan.missingName.length ? ` ${plan.missingName.length} without a business name left out.` : ''}{plan.repeated.length ? ` ${plan.repeated.length} repeated in the file left out.` : ''} Businesses already in Scout, by name or phone number, are skipped.</p>
          {sheet.table.length - 1 > LEAD_IMPORT_MAX_ROWS && <p>Only the first {LEAD_IMPORT_MAX_ROWS.toLocaleString()} rows are imported. Split the file to add the rest.</p>}
          {plan.fixes.map(fix => <p key={fix}>{fix}</p>)}
        </div>
        {plan.rows.length > 0 && <div className="lead-import-preview" role="table" aria-label="First rows to import">
          <div role="row"><span role="columnheader">Business</span><span role="columnheader">City</span><span role="columnheader">Phone</span><span role="columnheader">Email</span></div>
          {plan.rows.slice(0, 5).map(row => <div role="row" key={row.line}><span role="cell">{row.name}</span><span role="cell">{row.city}</span><span role="cell">{row.phone || '—'}</span><span role="cell">{row.email || '—'}</span></div>)}
        </div>}
        {outcome?.error && <p className="form-error" role="alert">{outcome.error}</p>}
        {progress && <div className="finder-import-progress" role="progressbar" aria-label="Importing leads" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}><i style={{ width: `${Math.round(progress.done / progress.total * 100)}%` }} /></div>}
        <footer className="lead-import-actions"><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button type="button" className="primary" disabled={busy || mapping.name < 0 || !plan.rows.length || !settings.ownerId} onClick={runImport}>{progress ? `Adding ${progress.done} of ${progress.total}…` : `Add ${plan.rows.length} lead${plan.rows.length === 1 ? '' : 's'}`}</button></footer>
      </section>}
    </div>
  </ProfileDialog>;
}
