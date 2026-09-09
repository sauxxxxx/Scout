'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FiAlertTriangle,
  FiCheck,
  FiChevronRight,
  FiClock,
  FiCopy,
  FiEdit3,
  FiExternalLink,
  FiGlobe,
  FiMail,
  FiMapPin,
  FiPhone,
  FiRefreshCw,
  FiSave,
  FiSearch,
  FiStar,
  FiTarget,
  FiTrash2,
  FiUsers,
  FiX,
  FiZap,
} from 'react-icons/fi';
import type { Lead, Page } from '@/app/page';

type FinderStatus = 'Saved' | 'Queued' | 'Running' | 'Complete' | 'Partial' | 'Failed' | 'Cancelled';
type FinderSearch = {
  id: string; name: string; industry: string; location: string; targetCount: number; requirements: string[];
  provider: string; status: FinderStatus; progress: number; stage: string; foundCount: number; importedCount: number;
  saved: boolean; retryCount: number; error?: string; startedAt?: string; completedAt?: string; createdAt: string; updatedAt: string;
};
type Provenance = { field: string; provider: string; sourceUrl: string; retrievedAt: string };
type FinderResult = {
  id: string; searchId: string; provider: string; providerRecordId: string; name: string; industry: string;
  address: string; city: string; phone: string; email: string; website: string; socialUrl: string; sourceUrl: string;
  businessStatus?: string; rating?: number; reviewCount?: number; score: number; scoreReason: string; opportunity: string;
  provenance: Provenance[]; fetchedAt: string; verifiedAt: string; importedLeadId?: string; websiteSummary: string;
  ruleScore: number; ruleScoreReason: string; aiStatus: 'pending' | 'running' | 'complete' | 'cached' | 'failed' | 'skipped' | 'budget_limited';
  aiModel?: string; aiClassification?: string; aiIcpMatch?: string; aiScore?: number; aiConfidence?: string;
  aiExplanation?: string; aiOpportunitySignals: string[]; aiConcerns: string[]; aiRecommendedAction?: string;
  aiEvidenceReferences: string[]; aiPromptTokens: number; aiOutputTokens: number; aiEstimatedCostUsd: number; aiError?: string; aiAnalyzedAt?: string;
};
type FinderAiUsage = { requests: number; promptTokens: number; outputTokens: number; estimatedUsd: number; budgetUsd: number };
type FinderPayload = { search?: FinderSearch; searches?: FinderSearch[]; results?: FinderResult[]; aiUsage?: FinderAiUsage; imported?: Lead[]; skipped?: number; error?: string };

type Props = {
  notify: (message: string) => void;
  leads: Lead[];
  onImportedLeads: (leads: Lead[]) => void;
  setPage: (page: Page) => void;
  finderView: string;
  setFinderView: (view: string) => void;
  onBreadcrumbChange?: (label: string) => void;
};

const resultFilters = ['All results', 'Qualified', 'Contactable', 'Missing website', 'Already in Leads'];
const resultSorts = ['Highest score', 'Most reviewed', 'Highest rating', 'Business name'];
const terminalStatuses: FinderStatus[] = ['Complete', 'Partial', 'Failed', 'Cancelled'];
const defaultFollowUpDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

function apiDate(value?: string) {
  if (!value) return 'Not run';
  const parsed = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function shortDate(value?: string) {
  if (!value) return 'Unknown';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function scoreOf(result: FinderResult) {
  return Math.round(result.aiScore ?? result.score ?? result.ruleScore ?? 0);
}

function confidenceOf(result: FinderResult) {
  if (result.aiStatus === 'complete' || result.aiStatus === 'cached') return result.aiConfidence || 'medium';
  if (result.aiStatus === 'running' || result.aiStatus === 'pending') return 'analyzing';
  return 'rules';
}

function hasRequirements(result: FinderResult, requirements: string[]) {
  return requirements.every((item) => item === 'Phone' ? Boolean(result.phone)
    : item === 'Website' ? Boolean(result.website)
      : item === 'Email' ? Boolean(result.email)
        : item === 'Social' ? Boolean(result.socialUrl) : true);
}

function qualification(result: FinderResult, requirements: string[]) {
  const score = scoreOf(result);
  if (!hasRequirements(result, requirements)) return 'Does not meet requirements';
  if (result.aiIcpMatch === 'weak' || score < 65) return 'Low fit';
  if (score >= 82 && result.aiIcpMatch !== 'unknown') return 'Strong match';
  return score >= 70 ? 'Qualified' : 'Review';
}

function contactCoverage(result: FinderResult) {
  return [result.phone && 'Phone', result.email && 'Email', result.website && 'Website', result.socialUrl && 'Social'].filter(Boolean) as string[];
}

function Spinner() {
  return <span className="finder-spinner" aria-hidden="true" />;
}

function elapsedBetween(startValue?: string, endValue?: string) {
  if (!startValue) return 'Starting';
  const started = new Date(startValue.includes('T') ? startValue : `${startValue.replace(' ', 'T')}Z`).getTime();
  const ended = endValue ? new Date(endValue.includes('T') ? endValue : `${endValue.replace(' ', 'T')}Z`).getTime() : started;
  if (Number.isNaN(started) || Number.isNaN(ended)) return 'In progress';
  const seconds = Math.max(0, Math.floor((ended - started) / 1000));
  return seconds < 60 ? `${seconds}s elapsed` : `${Math.floor(seconds / 60)}m ${seconds % 60}s elapsed`;
}

export function FinderWorkspace({ notify, leads, onImportedLeads, setPage, finderView, setFinderView, onBreadcrumbChange }: Props) {
  const [criteria, setCriteria] = useState({ industry: 'Dental clinics', location: 'Cebu City', count: '20' });
  const [requirements, setRequirements] = useState(['Phone']);
  const [searches, setSearches] = useState<FinderSearch[]>([]);
  const [activeSearch, setActiveSearch] = useState<FinderSearch | null>(null);
  const [results, setResults] = useState<FinderResult[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<FinderResult | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All results');
  const [sort, setSort] = useState('Highest score');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importSummary, setImportSummary] = useState<{ imported: number; skipped: number } | null>(null);
  const [importForm, setImportForm] = useState({ owner: 'Shaun', priority: 'Medium', status: 'New', followUpDate: defaultFollowUpDate });
  const [aiUsage, setAiUsage] = useState<FinderAiUsage>({ requests: 0, promptTokens: 0, outputTokens: 0, estimatedUsd: 0, budgetUsd: 2 });
  const [editingSearch, setEditingSearch] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const pollRef = useRef<number | null>(null);
  const existingNames = useMemo(() => new Set(leads.map((lead) => lead.name.toLowerCase())), [leads]);

  const request = async (url: string, init?: RequestInit) => {
    const response = await fetch(url, init);
    const data = await response.json() as FinderPayload;
    if (!response.ok) throw new Error(data.error || 'Scout could not complete that Finder action.');
    return data;
  };

  const loadSearches = async () => {
    try {
      const data = await request('/api/finder');
      setSearches(data.searches || []);
      if (data.aiUsage) setAiUsage(data.aiUsage);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Search history is unavailable.');
    } finally {
      setLoading(false);
    }
  };

  // Loading the remote Finder index is the mount-time synchronization for this workspace.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadSearches(); }, []);

  useEffect(() => {
    const label = finderView !== 'New search' ? finderView
      : activeSearch ? (['Queued', 'Running'].includes(activeSearch.status) ? 'Finding leads' : `${activeSearch.industry} in ${activeSearch.location}`)
        : 'New search';
    onBreadcrumbChange?.(label);
  }, [activeSearch, finderView, onBreadcrumbChange]);

  const applyPayload = (data: FinderPayload) => {
    if (data.search) {
      setActiveSearch(data.search);
      setSearches((current) => [data.search!, ...current.filter((item) => item.id !== data.search!.id)]);
    }
    if (data.results) setResults(data.results);
    if (data.aiUsage) setAiUsage(data.aiUsage);
  };

  useEffect(() => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    if (!activeSearch || !['Queued', 'Running'].includes(activeSearch.status)) return;
    const poll = async () => {
      try {
        const data = await request(`/api/finder?id=${encodeURIComponent(activeSearch.id)}`);
        applyPayload(data);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Live Finder progress is unavailable.');
      }
    };
    pollRef.current = window.setInterval(poll, 1400);
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
  }, [activeSearch?.id, activeSearch?.status]);

  const runSearch = async (searchId?: string) => {
    if (!searchId && (!criteria.industry.trim() || !criteria.location.trim())) {
      setError('Industry and location are required.');
      return;
    }
    setBusy(true); setStarting(true); setError(''); setImportSummary(null); setSelected([]); setResults([]);
    try {
      const body = searchId
        ? { action: 'run', searchId }
        : { action: 'run', industry: criteria.industry.trim(), location: criteria.location.trim(), targetCount: Number(criteria.count), requirements };
      const data = await request('/api/finder', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      applyPayload(data);
      setFinderView('New search');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The search could not start.');
    } finally { setBusy(false); setStarting(false); }
  };

  const saveDraft = async () => {
    setBusy(true); setError('');
    try {
      const data = await request('/api/finder', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'save', industry: criteria.industry.trim(), location: criteria.location.trim(), targetCount: Number(criteria.count), requirements }) });
      if (data.search) setSearches((current) => [data.search!, ...current.filter((item) => item.id !== data.search!.id)]);
      if (data.aiUsage) setAiUsage(data.aiUsage);
      notify('Search saved');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The search could not be saved.'); }
    finally { setBusy(false); }
  };

  const openSearch = async (search: FinderSearch) => {
    setBusy(true); setError(''); setSelected([]); setImportSummary(null);
    try {
      const data = await request(`/api/finder?id=${encodeURIComponent(search.id)}`);
      applyPayload(data);
      setCriteria({ industry: search.industry, location: search.location, count: String(search.targetCount) });
      setRequirements(search.requirements);
      setFinderView('New search');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Results could not be loaded.'); }
    finally { setBusy(false); }
  };

  const cancelSearch = async () => {
    if (!activeSearch) return;
    setBusy(true);
    try {
      const data = await request('/api/finder', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: activeSearch.id, action: 'cancel' }) });
      applyPayload(data); notify('Finder search cancelled');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The search could not be cancelled.'); }
    finally { setBusy(false); }
  };

  const updateSearch = async (search: FinderSearch, action: 'save' | 'unsave' | 'rename', name?: string) => {
    try {
      const data = await request('/api/finder', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: search.id, action, name }) });
      applyPayload(data); await loadSearches();
      setEditingSearch(null);
      notify(action === 'rename' ? 'Search renamed' : action === 'save' ? 'Search saved' : 'Search removed from saved');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The search could not be updated.'); }
  };

  const deleteSearch = async (search: FinderSearch) => {
    if (!window.confirm(`Delete “${search.name}”? This cannot be undone.`)) return;
    try {
      await request(`/api/finder?id=${encodeURIComponent(search.id)}`, { method: 'DELETE' });
      setSearches((current) => current.filter((item) => item.id !== search.id));
      if (activeSearch?.id === search.id) { setActiveSearch(null); setResults([]); }
      notify('Search deleted');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The search could not be deleted.'); }
  };

  const duplicateSearch = (search: FinderSearch) => {
    setCriteria({ industry: search.industry, location: search.location, count: String(search.targetCount) });
    setRequirements(search.requirements); setActiveSearch(null); setResults([]); setSelected([]); setFinderView('New search');
    notify('Search copied—adjust it or run it now');
  };

  const importSelected = async () => {
    if (!activeSearch || !selected.length) return;
    setBusy(true); setError('');
    try {
      const data = await request('/api/finder', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'import', searchId: activeSearch.id, resultIds: selected, ...importForm }) });
      const imported = data.imported || [];
      onImportedLeads(imported);
      setImportOpen(false); setSelected([]);
      await openSearch(activeSearch);
      setImportSummary({ imported: imported.length, skipped: data.skipped || 0 });
      notify(`${imported.length} lead${imported.length === 1 ? '' : 's'} added to Scout`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Selected businesses could not be imported.'); }
    finally { setBusy(false); }
  };

  const retryAi = async (result: FinderResult) => {
    try {
      const data = await request('/api/finder', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'retry-ai', searchId: result.searchId, resultId: result.id }) });
      applyPayload(data); notify('AI assessment queued');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'AI assessment could not be retried.'); }
  };

  const activeRequirements = activeSearch?.requirements || requirements;
  const qualified = results.filter((result) => ['Qualified', 'Strong match'].includes(qualification(result, activeRequirements)));
  const contactable = results.filter((result) => result.phone || result.email).length;
  const withWebsites = results.filter((result) => result.website).length;
  const duplicates = results.filter((result) => result.importedLeadId || existingNames.has(result.name.toLowerCase())).length;
  const totalCost = results.reduce((sum, result) => sum + (result.aiEstimatedCostUsd || 0), 0);
  const filteredResults = useMemo(() => {
    let items = results.filter((result) => `${result.name} ${result.city} ${result.industry} ${result.opportunity}`.toLowerCase().includes(query.toLowerCase()));
    if (filter === 'Qualified') items = items.filter((result) => ['Qualified', 'Strong match'].includes(qualification(result, activeRequirements)));
    if (filter === 'Contactable') items = items.filter((result) => result.phone || result.email);
    if (filter === 'Missing website') items = items.filter((result) => !result.website);
    if (filter === 'Already in Leads') items = items.filter((result) => result.importedLeadId || existingNames.has(result.name.toLowerCase()));
    return [...items].sort((a, b) => sort === 'Business name' ? a.name.localeCompare(b.name)
      : sort === 'Highest rating' ? (b.rating || 0) - (a.rating || 0)
        : sort === 'Most reviewed' ? (b.reviewCount || 0) - (a.reviewCount || 0)
          : scoreOf(b) - scoreOf(a));
  }, [results, query, filter, sort, activeRequirements, existingNames]);
  const importable = filteredResults.filter((result) => !result.importedLeadId && !existingNames.has(result.name.toLowerCase()));
  const progressSteps = [
    { label: 'Discovering businesses', threshold: 18, detail: 'Business directory search' },
    { label: 'Checking public details', threshold: 48, detail: 'Phones, websites and public contacts' },
    { label: 'Scoring best matches', threshold: 86, detail: 'Fit and opportunity analysis' },
    { label: 'Preparing results', threshold: 100, detail: 'Saving evidence and recommendations' },
  ];

  const historyTable = (items: FinderSearch[]) => <div className="finder-runs-table">
    <div className="finder-runs-head"><span>Search</span><span>Progress</span><span>Results</span><span>Added</span><span>Last run</span><span>Status</span><span /></div>
    {items.map((search) => <div className="finder-run-row" key={search.id}>
      <div>{editingSearch === search.id ? <input autoFocus value={editingName} onChange={(event) => setEditingName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && editingName.trim()) updateSearch(search, 'rename', editingName.trim()); if (event.key === 'Escape') setEditingSearch(null); }} /> : <><strong>{search.name}</strong><small>{search.industry} · {search.location} · up to {search.targetCount}</small></>}</div>
      <span><i><b style={{ width: `${search.progress}%` }} /></i>{search.progress}%</span><span>{search.foundCount}</span><span>{search.importedCount}</span><span>{apiDate(search.completedAt || search.createdAt)}</span>
      <span><em className={`finder-status status-${search.status.toLowerCase()}`}>{search.status}</em></span>
      <div className="finder-run-actions">
        {editingSearch === search.id ? <button onClick={() => updateSearch(search, 'rename', editingName.trim())} disabled={!editingName.trim()} aria-label="Save name" data-tooltip="Save name"><FiCheck /></button> : <button onClick={() => openSearch(search)} aria-label="Open results" data-tooltip="Open results"><FiChevronRight /></button>}
        <button onClick={() => runSearch(search.id)} aria-label="Run again" data-tooltip="Run again"><FiRefreshCw /></button>
        <button onClick={() => duplicateSearch(search)} aria-label="Duplicate search" data-tooltip="Duplicate search"><FiCopy /></button>
        <button onClick={() => { setEditingSearch(search.id); setEditingName(search.name); }} aria-label="Rename search" data-tooltip="Rename"><FiEdit3 /></button>
        <button onClick={() => updateSearch(search, search.saved ? 'unsave' : 'save')} aria-label={search.saved ? 'Remove from saved' : 'Save search'} data-tooltip={search.saved ? 'Remove from saved' : 'Save search'}><FiSave /></button>
        <button onClick={() => deleteSearch(search)} aria-label="Delete search" data-tooltip="Delete"><FiTrash2 /></button>
      </div>
    </div>)}
    {!items.length && <div className="finder-empty-state"><FiSearch /><strong>No searches here yet</strong><span>Run or save a search and it will appear here.</span></div>}
  </div>;

  if (finderView === 'Search history' || finderView === 'Saved searches') {
    const visible = finderView === 'Saved searches' ? searches.filter((search) => search.saved) : searches;
    return <div className="finder-workspace"><header className="finder-page-head"><div><h1>{finderView}</h1><p>{finderView === 'Saved searches' ? 'Reusable search criteria for recurring prospecting.' : 'Every Finder job, result count, import and retry in one place.'}</p></div><button className="primary" onClick={() => { setFinderView('New search'); setActiveSearch(null); setResults([]); }}>New search</button></header>{error && <div className="finder-alert error"><FiAlertTriangle />{error}<button onClick={() => setError('')}><FiX /></button></div>}{loading ? <div className="finder-loading"><Spinner /> Loading searches…</div> : historyTable(visible)}</div>;
  }

  const isRunning = activeSearch && ['Queued', 'Running'].includes(activeSearch.status);
  const hasResults = Boolean(activeSearch && results.length && (terminalStatuses.includes(activeSearch.status) || isRunning));

  if (!activeSearch) return <div className="finder-workspace finder-setup">
    <header className="finder-page-head"><div><h1>Find businesses worth contacting</h1></div><div className="finder-budget-pill"><FiZap /><span>AI spend</span><strong>${aiUsage.estimatedUsd.toFixed(3)} / ${aiUsage.budgetUsd.toFixed(2)}</strong></div></header>
    {error && <div className="finder-alert error"><FiAlertTriangle />{error}<button onClick={() => setError('')}><FiX /></button></div>}
    <section className="finder-search-card">
      <div className="finder-search-card-head"><div><span>New search</span><strong>Define your ideal business</strong></div></div>
      <div className="finder-search-fields"><label><span>Industry</span><input value={criteria.industry} onChange={(event) => setCriteria({ ...criteria, industry: event.target.value })} placeholder="e.g. Dental clinics" /></label><label><span>Location</span><div><FiMapPin /><input value={criteria.location} onChange={(event) => setCriteria({ ...criteria, location: event.target.value })} placeholder="City or region" /></div></label><label><span>Lead count</span><select value={criteria.count} onChange={(event) => setCriteria({ ...criteria, count: event.target.value })}><option>10</option><option>20</option><option>40</option><option>60</option></select></label></div>
      <div className="finder-requirement-grid"><div><span>Required information</span><small>Only businesses containing every selected field will qualify.</small></div>{['Phone', 'Website', 'Email', 'Social'].map((item) => <button className={requirements.includes(item) ? 'active' : ''} onClick={() => setRequirements((current) => current.includes(item) ? current.filter((value) => value !== item) : [...current, item])} key={item}>{item === 'Phone' ? <FiPhone /> : item === 'Email' ? <FiMail /> : <FiGlobe />}{item}{requirements.includes(item) && <FiCheck />}</button>)}</div>
      <footer><span className="finder-search-estimate">Estimated AI cost: under ${(Number(criteria.count) * 0.001).toFixed(2)} · hard monthly limit ${aiUsage.budgetUsd.toFixed(2)}</span><button className="secondary" disabled={busy} onClick={saveDraft}><FiSave /> Save search</button><button className="primary" disabled={busy} onClick={() => runSearch()}>{starting ? <><Spinner /> Starting search…</> : <><FiSearch /> Find leads</>}</button></footer>
    </section>
    <section className="finder-recent"><div className="finder-section-title"><div><h2>Recent searches</h2><p>Continue reviewing results or run a previous search again.</p></div><button onClick={() => setFinderView('Search history')}>View all <FiChevronRight /></button></div>{loading ? <div className="finder-loading"><Spinner /> Loading recent searches…</div> : historyTable(searches.slice(0, 4))}</section>
  </div>;

  if (isRunning && !hasResults) return <div className="finder-workspace">
    <header className="finder-page-head"><div><h1>{activeSearch.industry} in {activeSearch.location}</h1><p>This job continues safely in the background. You can leave this page and return later.</p></div><button className="secondary" disabled={busy} onClick={cancelSearch}>Cancel search</button></header>
    {error && <div className="finder-alert error"><FiAlertTriangle />{error}<button onClick={() => setError('')}><FiX /></button></div>}
    <section className="finder-live-card"><div className="finder-live-top"><div><Spinner /><span>{activeSearch.stage}</span></div><strong>{activeSearch.progress}%</strong></div><div className="finder-live-track"><b style={{ width: `${activeSearch.progress}%` }} /></div><div className="finder-live-metrics"><div><strong>{activeSearch.foundCount}</strong><span>Businesses found</span></div><div><strong>{results.filter((result) => result.phone || result.email).length}</strong><span>Contactable</span></div><div><strong>{results.filter((result) => ['complete', 'cached'].includes(result.aiStatus)).length}</strong><span>AI scored</span></div><div><strong>{elapsedBetween(activeSearch.startedAt, activeSearch.updatedAt)}</strong><span>Job time</span></div><div><strong>${totalCost.toFixed(3)}</strong><span>AI cost</span></div></div><div className="finder-stage-list">{progressSteps.map((step) => { const done = activeSearch.progress >= step.threshold; const current = !done && activeSearch.progress >= step.threshold - 30; return <div className={done ? 'done' : current ? 'current' : ''} key={step.label}><i>{done ? <FiCheck /> : current ? <Spinner /> : <FiClock />}</i><span><strong>{step.label}</strong><small>{step.detail}</small></span></div>; })}</div></section>
  </div>;

  if (activeSearch.status === 'Failed' || activeSearch.status === 'Cancelled') return <div className="finder-workspace"><header className="finder-page-head"><div><h1>{activeSearch.name}</h1><p>The search criteria are preserved, so you can retry or adjust them.</p></div></header><section className="finder-stop-card"><FiAlertTriangle /><h2>{activeSearch.status === 'Failed' ? 'Search could not finish' : 'Search cancelled'}</h2><p>{activeSearch.error || 'No results were changed.'}</p><div><button className="secondary" onClick={() => duplicateSearch(activeSearch)}>Edit criteria</button><button className="primary" onClick={() => runSearch(activeSearch.id)}><FiRefreshCw /> Retry search</button></div></section></div>;

  return <div className="finder-workspace finder-results-workspace">
    <header className="finder-page-head compact"><div><h1>{activeSearch.industry} in {activeSearch.location}</h1><div className="finder-context-chips"><span>{activeSearch.targetCount} requested</span>{activeSearch.requirements.map((item) => <span key={item}>{item} required</span>)}<span>{apiDate(activeSearch.completedAt)}</span></div></div><div className="finder-result-actions"><button className="secondary" onClick={() => updateSearch(activeSearch, activeSearch.saved ? 'unsave' : 'save')}><FiSave /> {activeSearch.saved ? 'Saved' : 'Save search'}</button><button className="primary" onClick={() => { setActiveSearch(null); setResults([]); setSelected([]); }}>New search</button></div></header>
    {activeSearch.status === 'Partial' && <div className="finder-alert warning"><FiAlertTriangle /><span><strong>Partial results available.</strong> {activeSearch.error || 'Scout saved the businesses collected before the job stopped.'}</span><button onClick={() => runSearch(activeSearch.id)}>Resume</button></div>}
    {importSummary && <div className="finder-alert success"><FiCheck /><span><strong>{importSummary.imported} imported.</strong>{importSummary.skipped ? ` ${importSummary.skipped} duplicate${importSummary.skipped === 1 ? '' : 's'} skipped.` : ' Follow-up tasks were created automatically.'}</span><button onClick={() => setPage('Leads')}>View Leads</button></div>}
    {error && <div className="finder-alert error"><FiAlertTriangle />{error}<button onClick={() => setError('')}><FiX /></button></div>}
    <section className="finder-kpis"><div><i><FiUsers /></i><span><strong>{results.length}</strong>Businesses found</span></div><div><i><FiTarget /></i><span><strong>{qualified.length}</strong>Qualified</span></div><div><i><FiPhone /></i><span><strong>{contactable}</strong>Contactable</span></div><div><i><FiGlobe /></i><span><strong>{withWebsites}</strong>With websites</span></div><div><i><FiCheck /></i><span><strong>{duplicates}</strong>Already in Leads</span></div></section>
    <div className="finder-results-toolbar"><div className="finder-result-search"><FiSearch /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search these results" /></div><select value={filter} onChange={(event) => setFilter(event.target.value)}>{resultFilters.map((item) => <option key={item}>{item}</option>)}</select><select value={sort} onChange={(event) => setSort(event.target.value)}>{resultSorts.map((item) => <option key={item}>{item}</option>)}</select><span>{filteredResults.length} result{filteredResults.length === 1 ? '' : 's'}</span></div>
    <div className="finder-intelligence-table"><div className="finder-intelligence-head"><span><input type="checkbox" aria-label="Select all importable results" checked={Boolean(importable.length) && importable.every((item) => selected.includes(item.id))} onChange={() => setSelected(importable.every((item) => selected.includes(item.id)) ? selected.filter((id) => !importable.some((item) => item.id === id)) : [...new Set([...selected, ...importable.map((item) => item.id)])])} /></span><span>Business</span><span>Contact coverage</span><span>Reputation</span><span>Opportunity</span><span>Fit</span><span /></div>
      {filteredResults.map((result) => { const coverage = contactCoverage(result); const existing = Boolean(result.importedLeadId || existingNames.has(result.name.toLowerCase())); const label = qualification(result, activeRequirements); return <div className={`finder-intelligence-row ${existing ? 'existing' : ''}`} key={result.id} onClick={() => setPreview(result)}><span><input type="checkbox" aria-label={`Select ${result.name}`} disabled={existing} checked={selected.includes(result.id)} onClick={(event) => event.stopPropagation()} onChange={() => setSelected((current) => current.includes(result.id) ? current.filter((id) => id !== result.id) : [...current, result.id])} /></span><div><strong>{result.name}</strong><small><FiMapPin /> {result.city || result.address || 'Location unavailable'}</small>{existing && <em>Already in Leads</em>}</div><div className="finder-coverage">{coverage.length ? coverage.map((item) => <span className="available" key={item}>{item}</span>) : <span>None published</span>}</div><div className="finder-google-signal"><strong>{result.rating ? <><FiStar /> {result.rating.toFixed(1)}</> : 'No rating'}</strong><small>{result.reviewCount ? `${result.reviewCount.toLocaleString()} reviews` : 'Review count unavailable'}</small></div><div><strong>{result.opportunity}</strong><small>{result.website ? 'Website found—review conversion opportunity' : 'No website found—digital presence opportunity'}</small></div><div className="finder-fit"><strong className={`score-${scoreOf(result) >= 82 ? 'high' : scoreOf(result) >= 70 ? 'medium' : 'low'}`}>{scoreOf(result)}</strong><span>{label}</span><small>{confidenceOf(result)} confidence</small></div><FiChevronRight /></div>; })}
      {!filteredResults.length && <div className="finder-empty-state"><FiSearch /><strong>No matching results</strong><span>Change the filters or search terms to see more businesses.</span><button onClick={() => { setQuery(''); setFilter('All results'); }}>Clear filters</button></div>}
    </div>
    {selected.length > 0 && <div className="finder-selection-bar"><div><strong>{selected.length} selected</strong><span>Duplicates are automatically skipped.</span></div><button onClick={() => setSelected([])}>Clear</button><button className="primary" onClick={() => setImportOpen(true)}>Add selected to Leads <FiChevronRight /></button></div>}
    {isRunning && <div className="finder-live-footer"><Spinner /><span><strong>{activeSearch.stage}</strong> · Results continue appearing automatically.</span><strong>{activeSearch.progress}%</strong></div>}
    {preview && <div className="drawer-backdrop" onClick={() => setPreview(null)}><aside className="finder-insight-drawer" role="dialog" aria-modal="true" aria-label={`${preview.name} assessment`} onClick={(event) => event.stopPropagation()}><header><div><h2>{preview.name}</h2><p>{preview.industry} · {preview.city}</p></div><button onClick={() => setPreview(null)} aria-label="Close"><FiX /></button></header><div className="finder-drawer-score"><div><span>Fit score</span><strong>{scoreOf(preview)}</strong><small>{qualification(preview, activeRequirements)}</small></div><div><span>Confidence</span><strong>{confidenceOf(preview)}</strong><small>{preview.aiStatus === 'cached' ? 'Previously assessed' : preview.aiStatus === 'complete' ? 'AI assessed' : 'Basic assessment'}</small></div><div><span>Opportunity</span><strong>{preview.opportunity}</strong><small>{preview.aiClassification || 'Business prospect'}</small></div></div><section><h3>Verified business details</h3><div className="finder-detail-grid"><p><span><FiPhone /> Phone</span><strong>{preview.phone || 'Not published'}</strong></p><p><span><FiMail /> Email</span><strong>{preview.email || 'Not published'}</strong></p><p><span><FiGlobe /> Website</span>{preview.website ? <a href={preview.website} target="_blank" rel="noreferrer">Open website <FiExternalLink /></a> : <strong>Not found</strong>}</p><p><span><FiStar /> Google rating</span><strong>{preview.rating ? `${preview.rating.toFixed(1)} · ${(preview.reviewCount || 0).toLocaleString()} reviews` : 'Not available'}</strong></p></div></section><section className="finder-assessment-block"><h3>Scout assessment</h3><p>{preview.aiExplanation || preview.scoreReason}</p><div className="finder-assessment-tags"><span>{preview.aiIcpMatch || 'rule'} ICP match</span><span>{confidenceOf(preview)} confidence</span><span>{preview.businessStatus?.replaceAll('_', ' ').toLowerCase() || 'status unknown'}</span></div><div className="finder-signal-columns"><div><h4><FiCheck /> Opportunity signals</h4>{(preview.aiOpportunitySignals || []).length ? <ul>{preview.aiOpportunitySignals.map((signal) => <li key={signal}>{signal}</li>)}</ul> : <p>No additional AI signals recorded.</p>}</div><div><h4><FiAlertTriangle /> Concerns</h4>{(preview.aiConcerns || []).length ? <ul>{preview.aiConcerns.map((concern) => <li key={concern}>{concern}</li>)}</ul> : <p>No material concerns found.</p>}</div></div>{preview.aiRecommendedAction && <div className="finder-next-action"><span>Recommended next action</span><strong>{preview.aiRecommendedAction}</strong></div>}{preview.aiStatus === 'failed' && <div className="finder-alert error"><span>{preview.aiError || 'AI assessment failed.'}</span><button onClick={() => retryAi(preview)}>Retry AI</button></div>}</section><section><h3>Evidence and provenance</h3><div className="finder-evidence-list">{preview.provenance.map((item, index) => <a href={item.sourceUrl} target="_blank" rel="noreferrer" key={`${item.field}-${index}`}><i>{item.provider === 'Google Places' ? <FiMapPin /> : <FiGlobe />}</i><span><strong>{item.field === 'business' ? 'Business listing' : `${item.field[0].toUpperCase()}${item.field.slice(1)} source`}</strong><small>{item.provider} · retrieved {shortDate(item.retrievedAt)}</small></span><FiExternalLink /></a>)}</div></section><footer>{preview.importedLeadId || existingNames.has(preview.name.toLowerCase()) ? <button className="primary" onClick={() => setPage('Leads')}>View in Leads</button> : <button className="primary" onClick={() => { setSelected([preview.id]); setPreview(null); setImportOpen(true); }}>Add to Leads</button>}</footer></aside></div>}
    {importOpen && <div className="modal-backdrop" onClick={() => setImportOpen(false)}><div className="modal finder-import-dialog" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}><header><div><h2>Add {selected.length} business{selected.length === 1 ? '' : 'es'} to Leads</h2><p>Scout will create the company, public contact, opportunity, activity, and first follow-up task.</p></div><button onClick={() => setImportOpen(false)} aria-label="Close"><FiX /></button></header><div className="modal-body"><div className="finder-import-grid"><label>Owner<select value={importForm.owner} onChange={(event) => setImportForm({ ...importForm, owner: event.target.value })}><option>Shaun</option><option>Mika</option><option>Paolo</option></select></label><label>Priority<select value={importForm.priority} onChange={(event) => setImportForm({ ...importForm, priority: event.target.value })}><option>High</option><option>Medium</option><option>Low</option></select></label><label>Lead status<select value={importForm.status} onChange={(event) => setImportForm({ ...importForm, status: event.target.value })}><option>New</option><option>Contacted</option><option>Interested</option></select></label><label>First follow-up<input type="date" value={importForm.followUpDate} onChange={(event) => setImportForm({ ...importForm, followUpDate: event.target.value })} /></label></div><div className="finder-import-note"><FiCheck /><span><strong>Duplicate-safe import</strong>Existing companies and leads will not be duplicated.</span></div></div><footer><button onClick={() => setImportOpen(false)}>Cancel</button><button className="primary" disabled={busy} onClick={importSelected}>{busy ? <><Spinner /> Importing…</> : `Add ${selected.length} to Leads`}</button></footer></div></div>}
  </div>;
}
