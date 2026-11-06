'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CustomSelect, useCustomization } from '@/components/crm/shared';
import { countryName, countryOptions, DEFAULT_COUNTRY, placeLabel } from '@/lib/countries';
import { FINDER_DEFAULT_LEADS, FINDER_MAX_LEADS } from '@/lib/finder-cells';
import {
  FiAlertTriangle,
  FiBriefcase,
  FiCheck,
  FiChevronRight,
  FiClock,
  FiEdit3,
  FiExternalLink,
  FiFacebook,
  FiGlobe,
  FiMail,
  FiMapPin,
  FiMoreHorizontal,
  FiPhone,
  FiRefreshCw,
  FiSave,
  FiSearch,
  FiStar,
  FiX,
} from 'react-icons/fi';
import { FinderDrawer } from '@/components/FinderDrawer';
import { formatDateTime } from '@/lib/format';
import { FinderFacebookReview } from '@/components/FinderFacebookReview';
import { FinderManualProspect } from '@/components/FinderManualProspect';
import { ProfileDialog } from '@/components/ProfileDialog';
import { contactChannel, facebookActivity, outreachPlan, pageConfirmed, prospectScore, readiness, salesFocuses, type FacebookResearch, type RequirementMode, type SalesFocus } from '@/lib/finder-sales';
import { FinderMap } from '@/components/FinderMap';
import { ScoutSelect } from '@/components/ScoutSelect';
import { hasCoordinates, type FinderArea } from '@/lib/finder-map';
import { finderIndustries } from '@/lib/finder-industries';
import type { Lead, Page } from '@/lib/crm-types';
import { useViewState } from '@/lib/client-view-cache';
import { useWorkspaceMembers } from '@/components/WorkspaceMembers';

type FinderStatus = 'Saved' | 'Queued' | 'Running' | 'Complete' | 'Partial' | 'Failed' | 'Cancelled';
function FinderCoverageNote({ search }: { search: { foundCount: number; targetCount: number; hiddenFoundCount?: number; coverage?: 'target' | 'limit' | 'complete' } }) {
  const hidden = search.hiddenFoundCount || 0;
  const short = search.foundCount < search.targetCount;
  const notes = [
    hidden ? `${hidden} ${hidden === 1 ? 'business' : 'businesses'} already found ${hidden === 1 ? 'was' : 'were'} left out.` : '',
    short && search.coverage === 'complete' ? `Found ${search.foundCount} of ${search.targetCount}: that's everything new in this area. Try a wider area for more.` : '',
    short && search.coverage === 'limit' ? `Found ${search.foundCount} of ${search.targetCount}. Scout stopped here to control search costs. Try a different area or run it again.` : '',
  ].filter(Boolean);
  return notes.length ? <p className="finder-coverage-note" role="status">{notes.join(' ')}</p> : null;
}

type FinderSearch = {
  area?: FinderArea;
  id: string; name: string; industry: string; location: string; country?: string; targetCount: number; requirements: string[]; salesFocus: SalesFocus; requirementMode: RequirementMode;
  industryType?: string; industryPsicCode?: string; locationCode?: string; locationType?: string; locationProvince?: string; locationRegion?: string;
  provider: string; status: FinderStatus; progress: number; stage: string; foundCount: number; importedCount: number; hiddenFoundCount?: number; coverage?: 'target' | 'limit' | 'complete';
  saved: boolean; retryCount: number; error?: string; startedAt?: string; completedAt?: string; createdAt: string; updatedAt: string;
};
type Provenance = { field: string; provider: string; sourceUrl: string; retrievedAt: string };
type FinderResult = {
  facebookResearch: FacebookResearch; reviewVersion: number; possibleDuplicates?: {id: string; name: string; city: string; address: string}[]; latitude?: number; longitude?: number; distanceKm?: number; facebookStatus: 'confirmed' | 'possible' | 'not_found'; facebookVerifiedAt?: string;
  id: string; searchId: string; provider: string; providerRecordId: string; name: string; industry: string;
  address: string; city: string; phone: string; email: string; website: string; socialUrl: string; sourceUrl: string;
  businessStatus?: string; rating?: number; reviewCount?: number; score: number; scoreReason: string; opportunity: string;
  provenance: Provenance[]; fetchedAt: string; verifiedAt: string; importedLeadId?: string; websiteSummary: string;
  ruleScore: number; ruleScoreReason: string; aiStatus: 'pending' | 'running' | 'complete' | 'cached' | 'failed' | 'skipped';
  aiModel?: string; aiClassification?: string; aiIcpMatch?: string; aiScore?: number; aiConfidence?: string;
  aiExplanation?: string; aiOpportunitySignals: string[]; aiConcerns: string[]; aiRecommendedAction?: string;
  aiEvidenceReferences: string[]; aiError?: string; aiAnalyzedAt?: string;
};
type FinderPayload = { search?: FinderSearch; searches?: FinderSearch[]; results?: FinderResult[]; updatedLeads?: Lead[]; addedResultId?: string; fields?: Record<string,string[]>; imported?: Lead[]; skipped?: number; assignments?: { userId: string; name: string; count: number }[]; error?: string };

type Props = {
  notify: (message: string) => void;
  leads: Lead[];
  onImportedLeads: (leads: Lead[]) => void;
  onOpenLead?: (id: string) => void;
  setPage: (page: Page) => void;
  finderView: string;
  setFinderView: (view: string) => void;
  onBreadcrumbChange?: (label: string) => void;
  defaults?: { radius: number; leadCount: number };
};

const resultFilters = ['All results', 'Ready for outreach', 'Needs review', 'Contactable', 'Facebook confirmed', 'Facebook possible', 'Facebook not discovered', 'Recent Facebook post, no website found', 'Website not listed', 'Already in Leads'];
const resultSorts = ['Highest score', 'Most reviewed', 'Highest rating', 'Business name'];
const reviewPreferences = new Map<string, { query: string; filter: string; sort: string }>();
const defaultFollowUpDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

function apiDate(value?: string) {
  return formatDateTime(value, 'Not run');
}

function shortDate(value?: string) {
  if (!value) return 'Unknown';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

const scoreOf = prospectScore;
function confidenceOf(result: FinderResult) {
  return ['complete', 'cached'].includes(result.aiStatus) ? result.aiConfidence || 'medium' : ['pending', 'running'].includes(result.aiStatus) ? 'analyzing' : 'rules';
}
function qualificationLabel(result: FinderResult, requirements: string[], searchRunning = false, mode: RequirementMode = 'all') {
  if (searchRunning && ['pending', 'running'].includes(result.aiStatus)) return 'Assessing';
  return readiness(result, requirements, mode);
}

function contactCoverage(result: FinderResult) {
  return [result.phone && 'Phone', result.email && 'Email', result.website && 'Website', result.socialUrl && (pageConfirmed(result) ? 'Facebook confirmed' : 'Facebook needs review')].filter(Boolean) as string[];
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

function displayFinderError(message?: string) {
  if (!message) return 'No results were changed.';
  if (/api key is not configured/i.test(message)) return 'Business search is not connected yet. Ask your workspace administrator to check the Google Places configuration.';
  if (/included[_ ]?type|developers\.google\.com\/maps|google places returned|invalid_argument/i.test(message)) return 'This search used an outdated industry filter. Retry it to use the corrected search method.';
  return message;
}

export function FinderWorkspace({ notify, leads, onImportedLeads, onOpenLead, setPage, finderView, setFinderView, onBreadcrumbChange, defaults }: Props) {
  const { assignableMembers, currentMember, currentRole, defaultOwner } = useWorkspaceMembers();
  const { statusLabel } = useCustomization();
  const [criteria, setCriteria] = useViewState('finder.criteria.v3', { industry: 'Dental clinics', industryType: 'dentist', industryPsicCode: '8620', country: DEFAULT_COUNTRY as string, location: 'City of Cebu', locationCode: '0730600000', locationType: 'City', locationProvince: '', locationRegion: '', count: String(defaults?.leadCount || FINDER_DEFAULT_LEADS), ...({} as { includeFound?: boolean }), radius: String(defaults?.radius || 10) });
  const leadTarget = Math.min(FINDER_MAX_LEADS, Math.max(1, Math.round(Number(criteria.count)) || FINDER_DEFAULT_LEADS));
  const [requirements, setRequirements] = useViewState('finder.requirements.v2', ['Phone', 'Facebook']);
  const [searches, setSearches] = useViewState<FinderSearch[]>('finder.searches', []);
  const [activeSearch, setActiveSearch] = useViewState<FinderSearch | null>('finder.activeSearch', null);
  const [results, setResults] = useViewState<FinderResult[]>('finder.results', []);
  const [area, setArea] = useViewState<FinderArea | undefined>('finder.area.v2', undefined);
  const [mapFitVersion, setMapFitVersion] = useState(0);
  const [industryOpen, setIndustryOpen] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const country = criteria.country || DEFAULT_COUNTRY;
  const inPhilippines = country === DEFAULT_COUNTRY;
  const [locationOptions, setLocationOptions] = useState<Array<{ code: string; name: string; type: string; zipCode: string; province: string; region: string }>>([]);
  const [locationLoading, setLocationLoading] = useState(false);
  const [salesFocus, setSalesFocus] = useViewState<SalesFocus>('finder.salesFocus', 'Website & booking');
  const [requirementMode, setRequirementMode] = useViewState<RequirementMode>('finder.requirementMode', 'all');
  const [manualOpen, setManualOpen] = useState(false);
  const [reviewDirty, setReviewDirty] = useState(false);
  const [discardReview, setDiscardReview] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const closePreview = () => { if (reviewBusy) return; if (reviewDirty) setDiscardReview(true); else setPreview(null); };
  const [focusedId, setFocusedId] = useState<string>();
  const [mobileView, setMobileView] = useState<'list' | 'map'>('list');
  const [selected, setSelected] = useState<string[]>([]);
  const [previewSnapshot, setPreview] = useState<FinderResult | null>(null);
  const preview = results.find(result => result.id === previewSnapshot?.id) || (activeSearch && ['Queued','Running'].includes(activeSearch.status) ? previewSnapshot : null);
  const [retryingAi, setRetryingAi] = useState<string | null>(null);
  const [query, setQuery] = useViewState('finder.query', '');
  const [filter, setFilter] = useViewState('finder.filter.sales.v1', 'All results');
  const [sort, setSort] = useViewState('finder.sort', 'Highest score');
  const [runMenu, setRunMenu] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<FinderSearch | null>(null);
  const { capabilities } = useWorkspaceMembers();
  const canRun = capabilities['finder:run'];
  const canDelete = capabilities['records:delete'];
  const [loading, setLoading] = useViewState('finder.loading', true);
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importSummary, setImportSummary] = useState<{ imported: number; skipped: number } | null>(null);
  const [importForm, setImportForm] = useState({ assignmentMode: 'single' as 'single' | 'round_robin' | 'manual', ownerId: '', assigneeIds: [] as string[], manualAssignments: {} as Record<string, string>, priority: 'Medium', status: 'New', followUpDate: defaultFollowUpDate, channel: 'Recommended', allowPossibleDuplicates: false });
  const [editingSearch, setEditingSearch] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [reviewingEarlySearchId, setReviewingEarlySearchId] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);
  const trackedSearchIds = useRef(new Set<string>());
  const existingIds = useMemo(() => new Set(leads.map(lead => lead.id)), [leads]);
  const canAssignTeam = currentRole === 'owner' || currentRole === 'admin';
  const availableAssignees = useMemo(() => canAssignTeam ? assignableMembers : assignableMembers.filter(member => member.id === currentMember?.id), [assignableMembers, canAssignTeam, currentMember?.id]);

  const defaultOwnerId = defaultOwner?.id || currentMember?.id || availableAssignees[0]?.id || '';
  const roundRobinIds = importForm.assigneeIds.length ? importForm.assigneeIds : defaultOwnerId ? [defaultOwnerId] : [];
  const resolvedManualAssignments = useMemo(() => Object.fromEntries(selected.map((id, index) => [id, importForm.manualAssignments[id] || availableAssignees[index % Math.max(1, availableAssignees.length)]?.id || ''])), [selected, importForm.manualAssignments, availableAssignees]);

  const request = async (url: string, init?: RequestInit) => {
    const response = await fetch(url, init);
    const data = await response.json() as FinderPayload;
    if (!response.ok) throw new Error([data.error || 'Scout could not complete that Finder action.', ...Object.values(data.fields || {}).flat()].join(' '));
    return data;
  };

  const loadSearches = async () => {
    try {
      const data = await request('/api/finder');
      setSearches(data.searches || []);
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
    if (!inPhilippines || !locationOpen || criteria.location.trim().length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLocationLoading(true);
      try {
        const response = await fetch(`/api/finder/locations?q=${encodeURIComponent(criteria.location.trim())}`, { signal: controller.signal });
        const data = await response.json() as { locations?: typeof locationOptions };
        if (response.ok) setLocationOptions(data.locations || []);
      } catch (cause) { if ((cause as Error).name !== 'AbortError') setLocationOptions([]); }
      finally { if (!controller.signal.aborted) setLocationLoading(false); }
    }, 250);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [criteria.location, locationOpen, inPhilippines]);

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
    if (data.updatedLeads?.length) onImportedLeads(data.updatedLeads);
  };

  useEffect(() => {
    if (activeSearch) reviewPreferences.set(activeSearch.id, { query, filter, sort });
  }, [activeSearch?.id, query, filter, sort]);

  useEffect(() => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    if (!activeSearch || (!['Queued', 'Running'].includes(activeSearch.status) && !retryingAi)) return;
    let disposed = false;
    let inFlight = false;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const data = await request(`/api/finder?id=${encodeURIComponent(activeSearch.id)}`);
        if (disposed) return;
        applyPayload(data);
        if (retryingAi && !data.results?.some(result => result.id === retryingAi && ['pending', 'running'].includes(result.aiStatus))) setRetryingAi(null);
      } catch (cause) {
        if (!disposed) setError(cause instanceof Error ? cause.message : 'Live Finder progress is unavailable.');
      } finally { inFlight = false; }
    };
    pollRef.current = window.setInterval(poll, 1400);
    return () => { disposed = true; if (pollRef.current) window.clearInterval(pollRef.current); };
  }, [activeSearch?.id, activeSearch?.status, retryingAi]);

  useEffect(() => {
    if (!activeSearch) return;
    if (['Queued', 'Running'].includes(activeSearch.status)) {
      trackedSearchIds.current.add(activeSearch.id);
      return;
    }
    if (['Complete', 'Partial'].includes(activeSearch.status) && trackedSearchIds.current.delete(activeSearch.id)) {
      const count = Math.max(activeSearch.foundCount, results.length);
      notify(activeSearch.status === 'Complete'
        ? `Search complete — ${count} business${count === 1 ? '' : 'es'} found`
        : `Search stopped with ${count} result${count === 1 ? '' : 's'} ready to review`);
    }
  }, [activeSearch?.id, activeSearch?.status, activeSearch?.foundCount, results.length, notify]);

  const runSearch = async (searchId?: string, selectedArea?: FinderArea, selectedLocation?: string) => {
    if (!searchId && (!criteria.industry.trim() || !criteria.location.trim())) {
      setError('Industry and location are required.');
      return;
    }
    setBusy(true); setStarting(true); setError(''); setImportSummary(null); setSelected([]); setFocusedId(undefined); setPreview(null); setReviewingEarlySearchId(null);
    try {
      const movedArea = Boolean(selectedArea && activeSearch);
      const body = searchId
        ? { action: 'run', searchId }
        : { action: 'run', country: movedArea ? activeSearch!.country : country, industry: movedArea ? activeSearch!.industry : criteria.industry.trim(), industryType: movedArea ? activeSearch!.industryType : criteria.industryType || undefined, industryPsicCode: movedArea ? activeSearch!.industryPsicCode : criteria.industryPsicCode || undefined, location: movedArea ? selectedLocation || activeSearch!.location : criteria.location.trim(), locationCode: movedArea && selectedLocation ? undefined : movedArea ? activeSearch!.locationCode : criteria.locationCode || undefined, locationType: movedArea && selectedLocation ? 'Map-selected area' : movedArea ? activeSearch!.locationType : criteria.locationType || undefined, locationProvince: movedArea && selectedLocation ? undefined : movedArea ? activeSearch!.locationProvince : criteria.locationProvince || undefined, locationRegion: movedArea && selectedLocation ? undefined : movedArea ? activeSearch!.locationRegion : criteria.locationRegion || undefined, includeFound: movedArea ? undefined : criteria.includeFound || undefined, targetCount: movedArea ? activeSearch!.targetCount : leadTarget, salesFocus: movedArea ? activeSearch!.salesFocus : salesFocus, requirementMode: movedArea ? activeSearch!.requirementMode : requirementMode, requirements: movedArea ? activeSearch!.requirements : requirements, area: selectedArea || area };
      const data = await request('/api/finder', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      applyPayload(data);
      setResults(data.results || []);
      if (data.search) {
        setArea(data.search.area);
        setCriteria({ country: data.search.country || DEFAULT_COUNTRY, industry: data.search.industry, industryType: data.search.industryType || '', industryPsicCode: data.search.industryPsicCode || '', location: data.search.location, locationCode: data.search.locationCode || '', locationType: data.search.locationType || '', locationProvince: data.search.locationProvince || '', locationRegion: data.search.locationRegion || '', count: String(data.search.targetCount), radius: String(data.search.area?.radiusKm || 10) });
        setRequirements(data.search.requirements); setSalesFocus(data.search.salesFocus); setRequirementMode(data.search.requirementMode);
      }
      setQuery(''); setFilter('All results'); setSort('Highest score'); setRetryingAi(null);
      setFinderView('New search');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The search could not start.');
    } finally { setBusy(false); setStarting(false); }
  };

  const saveDraft = async (forFacebook = false) => {
    setBusy(true); setError('');
    try {
      const data = await request('/api/finder', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'save', country, industry: criteria.industry.trim(), industryType: criteria.industryType || undefined, industryPsicCode: criteria.industryPsicCode || undefined, location: criteria.location.trim(), locationCode: criteria.locationCode || undefined, locationType: criteria.locationType || undefined, locationProvince: criteria.locationProvince || undefined, locationRegion: criteria.locationRegion || undefined, targetCount: Number(criteria.count), requirements, salesFocus, requirementMode, area }) });
      if (data.search) setSearches((current) => [data.search!, ...current.filter((item) => item.id !== data.search!.id)]);
      if (forFacebook && data.search) { applyPayload(data); setManualOpen(true); } else notify('Search saved');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The search could not be saved.'); }
    finally { setBusy(false); }
  };

  const openSearch = async (search: FinderSearch) => {
    if (search.status === 'Saved' && !search.foundCount) { duplicateSearch(search); return; }
    setFocusedId(undefined); setPreview(null); setArea(search.area); setReviewingEarlySearchId(null);
    setBusy(true); setError(''); setSelected([]); setImportSummary(null);
    try {
      const data = await request(`/api/finder?id=${encodeURIComponent(search.id)}`);
      applyPayload(data);
      const preferences = reviewPreferences.get(search.id);
      setQuery(preferences?.query || ''); setFilter(preferences?.filter || 'All results'); setSort(preferences?.sort || 'Highest score'); setRetryingAi(null);
      setCriteria({ country: search.country || DEFAULT_COUNTRY, industry: search.industry, industryType: search.industryType || '', industryPsicCode: search.industryPsicCode || '', location: search.location, locationCode: search.locationCode || '', locationType: search.locationType || '', locationProvince: search.locationProvince || '', locationRegion: search.locationRegion || '', count: String(search.targetCount), radius: String(search.area?.radiusKm || 10) });
      setRequirements(search.requirements); setSalesFocus(search.salesFocus); setRequirementMode(search.requirementMode);
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
      if (activeSearch?.id === search.id) applyPayload(data);
      await loadSearches();
      setEditingSearch(null);
      notify(action === 'rename' ? 'Search renamed' : action === 'save' ? 'Search saved' : 'Search removed from saved');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The search could not be updated.'); }
  };

  const deleteSearch = async (search: FinderSearch) => {
    setDeleting(null);
    try {
      await request(`/api/finder?id=${encodeURIComponent(search.id)}`, { method: 'DELETE' });
      setSearches((current) => current.filter((item) => item.id !== search.id));
      if (activeSearch?.id === search.id) { setActiveSearch(null); setResults([]); }
      notify('Search deleted');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The search could not be deleted.'); }
  };

  const duplicateSearch = (search: FinderSearch) => {
    setCriteria({ country: search.country || DEFAULT_COUNTRY, industry: search.industry, industryType: search.industryType || '', industryPsicCode: search.industryPsicCode || '', location: search.location, locationCode: search.locationCode || '', locationType: search.locationType || '', locationProvince: search.locationProvince || '', locationRegion: search.locationRegion || '', count: String(search.targetCount), radius: String(search.area?.radiusKm || 10) });
    setSalesFocus(search.salesFocus); setRequirementMode(search.requirementMode); setRequirements(search.requirements.map(item => item === 'Social' ? 'Facebook' : item)); setArea(search.area); setFocusedId(undefined); setPreview(null); setActiveSearch(null); setResults([]); setSelected([]); setReviewingEarlySearchId(null); setFinderView('New search');
    notify('Search copied—adjust it or run it now');
  };

  const importSelected = async () => {
    if (!activeSearch || !selected.length) return;
    setBusy(true); setError('');
    try {
      const data = await request('/api/finder', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'import', searchId: activeSearch.id, resultIds: selected, ...importForm, ownerId: importForm.ownerId || defaultOwnerId, assigneeIds: roundRobinIds, manualAssignments: resolvedManualAssignments }) });
      const imported = data.imported || [];
      onImportedLeads(imported);
      setImportOpen(false); setSelected([]);
      await openSearch(activeSearch);
      setImportSummary({ imported: imported.length, skipped: data.skipped || 0 });
      notify(`${imported.length} lead${imported.length === 1 ? '' : 's'} added to Scout`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Selected businesses could not be imported.'); }
    finally { setBusy(false); }
  };

  const retryAssessment = async (result: FinderResult) => {
    try {
      const data = await request('/api/finder', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'retry-ai', searchId: result.searchId, resultId: result.id }) });
      applyPayload(data); setRetryingAi(result.id); notify('Assessment queued');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Assessment could not be retried.'); }
  };

  const reviewFacebook = async (result: FinderResult, facebookUrl: string, status: FinderResult['facebookStatus'], research: FacebookResearch, reviewVersion: number) => {
    setReviewBusy(true);
    try {
      const data = await request('/api/finder', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'facebook', searchId: result.searchId, resultId: result.id, facebookUrl, status, research, reviewVersion }) });
      applyPayload(data); setRetryingAi(result.id); notify('Facebook review saved');
    } finally { setReviewBusy(false); }
  };
  const addManualProspect = async (values: Parameters<React.ComponentProps<typeof FinderManualProspect>['onAdd']>[0]) => {
    if (!activeSearch) return;
    const data = await request('/api/finder', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'add-prospect', searchId: activeSearch.id, ...values }) });
    applyPayload(data); setManualOpen(false); setReviewDirty(false); setPreview(data.results?.find(result => result.id === data.addedResultId) || null); if (data.addedResultId) setRetryingAi(data.addedResultId); notify('Prospect added for Facebook review');
  };

  const activeRequirements = activeSearch?.requirements || requirements;
  const activeSearchRunning = Boolean(activeSearch && ['Queued', 'Running'].includes(activeSearch.status));
  const activeMode = activeSearch?.requirementMode || requirementMode;
  const activeFocus = activeSearch?.salesFocus || salesFocus;
  const isReady = (result: FinderResult) => !activeSearchRunning && ['Ready for outreach', 'Strong match'].includes(readiness(result, activeRequirements, activeMode));
  const qualified = results.filter(isReady);
  const contactable = results.filter(result => contactChannel(result) !== 'Review').length;
  const needsFacebookReview = results.filter(result => !pageConfirmed(result)).length;
  const duplicates = results.filter(result => result.importedLeadId && existingIds.has(result.importedLeadId) || result.importedLeadId).length;
  const filteredResults = (() => {
    let items = results.filter(result => [result.name, result.city, result.industry, result.opportunity].join(' ').toLowerCase().includes(query.toLowerCase()));
    if (filter === 'Ready for outreach') items = items.filter(isReady);
    if (filter === 'Needs review') items = items.filter(result => !isReady(result));
    if (filter === 'Contactable') items = items.filter(result => contactChannel(result) !== 'Review');
    if (filter === 'Facebook confirmed') items = items.filter(pageConfirmed);
    if (filter === 'Facebook possible') items = items.filter(result => !!result.socialUrl && !pageConfirmed(result));
    if (filter === 'Facebook not discovered') items = items.filter(result => result.facebookStatus === 'not_found');
    if (filter === 'Recent Facebook post, no website found') items = items.filter(result => facebookActivity(result) === 'recent' && !result.website && result.facebookResearch?.websiteStatus === 'not_found');
    if (filter === 'Website not listed') items = items.filter(result => !result.website);
    if (filter === 'Already in Leads') items = items.filter(result => result.importedLeadId);
    return [...items].sort((a, b) => sort === 'Business name' ? a.name.localeCompare(b.name) : sort === 'Highest rating' ? (b.rating || 0) - (a.rating || 0) : sort === 'Most reviewed' ? (b.reviewCount || 0) - (a.reviewCount || 0) : scoreOf(b) - scoreOf(a));
  })();
  const focusedResult = filteredResults.find(result => result.id === focusedId);
  const mapResults = filteredResults;
  const importable = filteredResults.filter(result => !result.importedLeadId);
  const selectedProspects = results.filter(result => selected.includes(result.id) && !result.importedLeadId);
  const selectedNeedsResearch = selectedProspects.filter(result => !isReady(result)).length;
  const possibleDuplicateProspects = selectedProspects.filter(result => result.possibleDuplicates?.length);
  const progressSteps = [
    { label: 'Searching businesses', start: 0, detail: 'Finding businesses inside your selected area' },
    { label: 'Collecting contact details', start: 32, detail: 'Checking phones, websites and public contacts' },
    { label: 'Assessing collected evidence', start: 64, detail: 'Reviewing business facts and discovered links' },
    { label: 'Ranking matches', start: 86, detail: 'Ordering the strongest sales opportunities' },
  ];

  useEffect(() => {
    if (!runMenu) return;
    const dismiss = (event: PointerEvent) => { if (!(event.target as Element).closest?.('.finder-run-menu-wrap')) setRunMenu(null); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setRunMenu(null); };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); };
  }, [runMenu]);

  const historyTable = (items: FinderSearch[]) => <div className="finder-runs-table">
    <div className="finder-runs-head"><span>Search</span><span>Results</span><span>Added</span><span>Last run</span><span>Status</span><span /></div>
    {items.map((search) => <div className="finder-run-row" key={search.id}>
      <div>{editingSearch === search.id ? <input autoFocus value={editingName} onChange={(event) => setEditingName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && editingName.trim()) updateSearch(search, 'rename', editingName.trim()); if (event.key === 'Escape') setEditingSearch(null); }} /> : <><strong>{search.name}</strong><small>{search.industry} · {search.location} · up to {search.targetCount}</small></>}</div>
      <span>{search.foundCount}</span><span>{search.importedCount}</span><span>{apiDate(search.completedAt || search.createdAt)}</span>
      <span><em className={`finder-status status-${search.status.toLowerCase()}`}>{search.status}{['Queued', 'Running'].includes(search.status) ? ` · ${search.progress}%` : ''}</em></span>
      <div className="finder-run-actions">
        {editingSearch === search.id
          ? <button className="finder-run-open" onClick={() => updateSearch(search, 'rename', editingName.trim())} disabled={!editingName.trim()}>Save</button>
          : <button className="finder-run-open" onClick={() => openSearch(search)}>Open</button>}
        <div className="finder-run-menu-wrap">
          <button aria-label={`More actions for ${search.name}`} aria-haspopup="menu" aria-expanded={runMenu === search.id} onClick={() => setRunMenu(current => current === search.id ? null : search.id)}><FiMoreHorizontal /></button>
          {runMenu === search.id && <div className="finder-run-menu" role="menu">
            {canRun && <button role="menuitem" onClick={() => { setRunMenu(null); runSearch(search.id); }}>Run again</button>}
            <button role="menuitem" onClick={() => { setRunMenu(null); duplicateSearch(search); }}>Duplicate</button>
            <button role="menuitem" onClick={() => { setRunMenu(null); setEditingSearch(search.id); setEditingName(search.name); }}>Rename</button>
            <button role="menuitem" onClick={() => { setRunMenu(null); updateSearch(search, search.saved ? 'unsave' : 'save'); }}>{search.saved ? 'Remove from saved' : 'Save search'}</button>
            {canDelete && <button role="menuitem" className="danger-text" onClick={() => { setRunMenu(null); setDeleting(search); }}>Delete</button>}
          </div>}
        </div>
      </div>
    </div>)}
    {!items.length && <div className="finder-empty-state"><FiSearch /><strong>No searches here yet</strong><span>Run or save a search and it will appear here.</span></div>}
    {deleting && <div className="modal-backdrop" onClick={() => setDeleting(null)}>
      <div className="modal team-dialog" role="alertdialog" aria-label="Delete this search?" onClick={event => event.stopPropagation()}>
        <header><h2>Delete this search?</h2></header>
        <div className="team-dialog-body"><p>“{deleting.name}” and its results will be removed. This can’t be undone.</p></div>
        <footer><button className="text-link" onClick={() => setDeleting(null)}>Cancel</button><button className="primary" onClick={() => deleteSearch(deleting)}>Delete search</button></footer>
      </div>
    </div>}
  </div>;

  if (finderView === 'Search history' || finderView === 'Saved searches') {
    const visible = finderView === 'Saved searches' ? searches.filter((search) => search.saved) : searches;
    return <div className="finder-workspace"><header className="finder-page-head"><div><h1>{finderView}</h1></div><button className="primary" onClick={() => { setFinderView('New search'); setActiveSearch(null); setResults([]); setReviewingEarlySearchId(null); }}>New search</button></header>{error && <div className="finder-alert error"><FiAlertTriangle />{error}<button onClick={() => setError('')}><FiX /></button></div>}{loading ? <div className="finder-loading"><Spinner /> Loading searches…</div> : historyTable(visible)}</div>;
  }

  const isRunning = Boolean(activeSearch && ['Queued', 'Running'].includes(activeSearch.status));

  if (!activeSearch) return <div className="finder-workspace finder-setup">
    <header className="finder-page-head"><div><h1>Find businesses</h1></div></header>
    {error && <div className="finder-alert error"><FiAlertTriangle />{error}<button onClick={() => setError('')}><FiX /></button></div>}
    <div className="finder-setup-split"><section className="finder-search-card">
      <div className="finder-brief-form">
        <div className="finder-brief-row"><label htmlFor="finder-industry">Who</label><div className="finder-brief-control finder-combobox"><FiBriefcase /><input id="finder-industry" value={criteria.industry} onFocus={() => setIndustryOpen(true)} onBlur={() => window.setTimeout(() => setIndustryOpen(false), 150)} onChange={(event) => { setCriteria({ ...criteria, industry: event.target.value, industryType: '', industryPsicCode: '' }); setIndustryOpen(true); }} placeholder="Search industries" autoComplete="off" />{industryOpen && <div className="finder-combobox-menu">{finderIndustries.filter(item => `${item.label} ${item.group}`.toLowerCase().includes(criteria.industry.toLowerCase())).slice(0, 10).map(item => <button type="button" key={item.label} onMouseDown={() => { setCriteria({ ...criteria, industry: item.label, industryType: item.googleType || '', industryPsicCode: item.psicCode || '' }); setIndustryOpen(false); }}><strong>{item.label}</strong><small>{item.group}{item.psicCode ? ` · PSIC ${item.psicCode}` : ''}</small></button>)}</div>}</div></div>
        <div className="finder-brief-row finder-country-row"><CustomSelect label="Country" value={country} options={countryOptions} display={countryName} onSearch={() => {}} onChange={(value) => { if (value === country) return; setCriteria({ ...criteria, country: value, location: '', locationCode: '', locationType: '', locationProvince: '', locationRegion: '' }); setArea(undefined); setMapFitVersion(version => version + 1); }} /></div>
        <div className="finder-brief-row"><label htmlFor="finder-location">Where</label><div><div className="finder-brief-control finder-combobox"><FiMapPin /><input id="finder-location" value={criteria.location} onFocus={() => setLocationOpen(true)} onBlur={() => window.setTimeout(() => setLocationOpen(false), 150)} onChange={(event) => { setCriteria({ ...criteria, location: event.target.value, locationCode: '', locationType: '', locationProvince: '', locationRegion: '' }); setArea(undefined); setLocationOpen(true); }} placeholder={inPhilippines ? 'Search Philippine locations' : `City or area in ${countryName(country)}`} autoComplete="off" />{inPhilippines && locationOpen && criteria.location.trim().length >= 2 && <div className="finder-combobox-menu">{locationLoading && <span>Searching locations…</span>}{!locationLoading && locationOptions.map(item => <button type="button" key={item.code} onMouseDown={() => { setCriteria({ ...criteria, location: item.name, locationCode: item.code, locationType: item.type, locationProvince: item.province, locationRegion: item.region }); setArea(undefined); setMapFitVersion(value => value + 1); setLocationOpen(false); }}><strong>{item.name}</strong><small>{[item.type, item.province, item.region].filter(Boolean).join(' · ')} · PSGC {item.code}{item.zipCode ? ` · ${item.zipCode}` : ''}</small></button>)}{!locationLoading && !locationOptions.length && <span>No matching city or municipality</span>}</div>}</div><small className="finder-brief-note">Within {area?.radiusKm || Number(criteria.radius || 10)} km of the selected map center{criteria.locationType === 'Map-selected area' ? ' · chosen from the map' : ''}</small></div></div>
        <details className="finder-more-options"><summary>More options<small>{leadTarget} leads · {requirements.join(', ')} · {salesFocus}</small></summary>
        <div className="finder-brief-row"><span>Lead count</span><div className="finder-count-input"><input type="number" inputMode="numeric" min={1} max={FINDER_MAX_LEADS} aria-label="Lead count" value={criteria.count} onChange={event => setCriteria({ ...criteria, count: event.target.value })} onBlur={() => setCriteria({ ...criteria, count: String(leadTarget) })} /><small>Up to {FINDER_MAX_LEADS}. Bigger searches take longer.</small><label className="finder-found-toggle"><input type="checkbox" checked={!!criteria.includeFound} onChange={event => setCriteria({ ...criteria, includeFound: event.target.checked })} />Include businesses already found</label></div></div>
        <div className="finder-brief-row finder-brief-requirements"><span>Must have</span><div>{['Facebook', 'Phone', 'Website', 'Email'].map((item) => <button type="button" aria-pressed={requirements.includes(item)} className={requirements.includes(item) ? 'active' : ''} onClick={() => setRequirements((current) => current.includes(item) ? current.length === 1 ? current : current.filter((value) => value !== item) : [...current, item])} key={item}>{item === 'Facebook' ? <FiFacebook /> : item === 'Phone' ? <FiPhone /> : item === 'Email' ? <FiMail /> : <FiGlobe />}<span>Has {item.toLowerCase()}</span>{requirements.includes(item) && <FiCheck />}</button>)}</div></div>
        <div className="finder-brief-row"><span>Match</span><div className="finder-match-options" role="group" aria-label="Match contact criteria"><button type="button" aria-pressed={requirementMode === 'all'} onClick={() => setRequirementMode('all')}>All of these</button><button type="button" aria-pressed={requirementMode === 'any'} onClick={() => setRequirementMode('any')}>Any of these</button></div></div><div className="finder-brief-row"><label>Sales focus</label><ScoutSelect ariaLabel="Sales focus" value={salesFocus} options={salesFocuses.map(value => ({ value, label: value }))} onChange={value => setSalesFocus(value as SalesFocus)} /></div>
        </details>
      </div>
      <footer className="finder-brief-actions"><button className="primary" disabled={busy || !canRun} title={canRun ? undefined : 'Your role cannot run Finder searches'} onClick={() => runSearch()}>{starting ? <><Spinner /> Starting search…</> : <><FiSearch /> Find up to {leadTarget} businesses</>}</button><button className="finder-save-link" disabled={busy} onClick={() => saveDraft()}><FiSave /> Save this search</button><button className="finder-save-link" disabled={busy} onClick={() => saveDraft(true)}><FiFacebook /> Add a Facebook prospect</button></footer>
    </section><FinderMap setup location={`${criteria.location ? `${criteria.location}, ` : ''}${countryName(country)}`} area={area} radiusKm={Number(criteria.radius || 10)} fitAreaKey={mapFitVersion} onRadiusChange={(radiusKm) => { setCriteria({ ...criteria, radius: String(radiusKm) }); if (area) setArea({ ...area, radiusKm }); }} onArea={(nextArea, details) => { setArea(nextArea); if (details?.locationLabel) setCriteria({ ...criteria, location: details.locationLabel, locationCode: '', locationType: 'Map-selected area', locationProvince: '', locationRegion: '' }); }} busy={busy} /></div>
    <section className="finder-recent"><div className="finder-section-title"><div><h2>Recent searches</h2></div><button onClick={() => setFinderView('Search history')}>View all <FiChevronRight /></button></div>{loading ? <div className="finder-loading"><Spinner /> Loading recent searches…</div> : historyTable(searches.slice(0, 4))}</section>
  </div>;

  const searchProgress = Math.max(0, Math.min(100, activeSearch.progress || 0));
  const activeProgressStep = progressSteps.reduce((current, step, index) => searchProgress >= step.start ? index : current, 0);
  const friendlyStage = progressSteps[activeProgressStep]?.label || 'Finding businesses';
  const foundCount = Math.max(activeSearch.foundCount, results.length);
  const contactDetailsFound = results.filter((result) => result.phone || result.email || result.website).length;
  const facebookMatches = results.filter((result) => Boolean(result.socialUrl) || ['confirmed', 'possible'].includes(result.facebookStatus)).length;
  const verifiedCount = results.filter((result) => ['complete', 'cached', 'skipped', 'failed'].includes(result.aiStatus)).length;
  const reviewingEarly = isRunning && reviewingEarlySearchId === activeSearch.id;

  if (isRunning && !reviewingEarly) return <div className="finder-workspace finder-searching-workspace">
    <header className="finder-page-head"><div><h1>{activeSearch.industry} in {placeLabel(activeSearch.location, activeSearch.country)}</h1><p>You can leave this page while Scout continues the search in the background.</p></div></header>
    {error && <div className="finder-alert error"><FiAlertTriangle />{error}<button onClick={() => setError('')}><FiX /></button></div>}
    <div className="finder-running-split"><FinderMap location={activeSearch.location} area={activeSearch.area} busy /><section className="finder-progress-card" aria-live="polite"><div className="finder-progress-heading"><div><span className="finder-progress-pulse"><Spinner /></span><span><small>Search in progress</small><strong>{friendlyStage}</strong></span></div><strong>{searchProgress}%</strong></div><div className="finder-progress-track" role="progressbar" aria-label="Search progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={searchProgress}><i style={{ width: `${searchProgress}%` }} /></div><div className="finder-progress-metrics"><div><strong>{foundCount}</strong><span>Businesses found</span></div><div><strong>{contactDetailsFound}</strong><span>With contact details</span></div><div><strong>{facebookMatches}</strong><span>Facebook links discovered</span></div><div><strong>{verifiedCount}</strong><span>Ready to review</span></div></div><div className="finder-stage-list">{progressSteps.map((step, index) => { const done = index < activeProgressStep; const current = index === activeProgressStep; return <div className={done ? 'done' : current ? 'current' : ''} key={step.label}><i>{done ? <FiCheck /> : current ? <Spinner /> : <FiClock />}</i><span><strong>{step.label}</strong><small>{step.detail}</small></span></div>; })}</div><div className="finder-progress-footer"><div><FiClock /><span><strong>{elapsedBetween(activeSearch.startedAt, activeSearch.updatedAt)}</strong><small>{foundCount ? `${foundCount} result${foundCount === 1 ? '' : 's'} available so far` : 'The first matches will appear here shortly'}</small></span></div><div><button className="secondary" disabled={busy} onClick={cancelSearch}>Cancel search</button><button className="primary" disabled={!results.length} onClick={() => setReviewingEarlySearchId(activeSearch.id)}>{results.length ? `Review ${results.length} early result${results.length === 1 ? '' : 's'}` : 'Waiting for results'}</button></div></div></section></div>
  </div>;

  if ((activeSearch.status === 'Failed' || activeSearch.status === 'Cancelled') && !results.length) return <div className="finder-workspace"><header className="finder-page-head"><div><h1>{activeSearch.name}</h1><p>The search criteria are preserved, so you can retry or adjust them.</p></div></header><section className="finder-stop-card"><FiAlertTriangle /><h2>{activeSearch.status === 'Failed' ? 'Search could not finish' : 'Search cancelled'}</h2><p>{displayFinderError(activeSearch.error)}</p><div><button className="secondary" onClick={() => duplicateSearch(activeSearch)}>Edit criteria</button><button className="primary" onClick={() => runSearch(activeSearch.id)}><FiRefreshCw /> Retry search</button></div></section></div>;

  return <div className="finder-workspace finder-results-workspace">{manualOpen && <FinderManualProspect location={activeSearch.location} onClose={() => setManualOpen(false)} onAdd={addManualProspect} />}{discardReview && <ProfileDialog title="Discard unsaved Facebook review?" onClose={() => setDiscardReview(false)}><p className="finder-dialog-copy">Your latest observations have not been saved.</p><footer><button onClick={() => setDiscardReview(false)}>Keep editing</button><button className="primary" onClick={() => { setDiscardReview(false); setReviewDirty(false); setPreview(null); }}>Discard changes</button></footer></ProfileDialog>}
    <header className="finder-page-head compact"><div><h1>{activeSearch.industry} in {placeLabel(activeSearch.location, activeSearch.country)}</h1><div className="finder-context-chips"><span>{activeSearch.targetCount} requested</span><span>{activeFocus}</span><span>{activeMode === 'all' ? 'All' : 'Any'}: {activeRequirements.join(' + ') || 'No contact criteria'}</span><span>{isRunning ? friendlyStage : activeSearch.status === 'Saved' ? 'Manual prospect list' : apiDate(activeSearch.completedAt)}</span></div></div><div className="finder-result-actions"><button className="secondary" disabled={isRunning} onClick={() => setManualOpen(true)}><FiFacebook /> Add Facebook prospect</button><button className="secondary" onClick={() => duplicateSearch(activeSearch)}><FiEdit3 /> Edit search</button><button className="secondary" onClick={() => updateSearch(activeSearch, activeSearch.saved ? 'unsave' : 'save')}><FiSave /> {activeSearch.saved ? 'Saved' : 'Save search'}</button><button className="primary" onClick={() => { setActiveSearch(null); setResults([]); setSelected([]); setReviewingEarlySearchId(null); }}>New search</button></div></header>
    {isRunning && <section className="finder-early-progress" aria-live="polite"><div className="finder-early-progress-main"><Spinner /><span><strong>{friendlyStage}</strong><small>{foundCount} found · {verifiedCount} ready · {elapsedBetween(activeSearch.startedAt, activeSearch.updatedAt)}</small></span></div><div className="finder-early-track" role="progressbar" aria-label="Search progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={searchProgress}><i style={{ width: `${searchProgress}%` }} /></div><strong>{searchProgress}%</strong><button onClick={() => setReviewingEarlySearchId(null)}>View progress</button><button className="secondary" disabled={busy} onClick={cancelSearch}>Cancel</button></section>}
    {activeSearch.status === 'Complete' && <FinderCoverageNote search={activeSearch} />}
    {activeSearch.status === 'Partial' && <div className="finder-alert warning"><FiAlertTriangle /><span><strong>Partial results available.</strong> {displayFinderError(activeSearch.error)}</span>{canRun && <button onClick={() => runSearch(activeSearch.id)}>Resume</button>}</div>}
    {importSummary && <div className="finder-alert success"><FiCheck /><span><strong>{importSummary.imported} imported.</strong>{importSummary.skipped ? ` ${importSummary.skipped} duplicate${importSummary.skipped === 1 ? '' : 's'} skipped.` : ' Follow-up tasks were created automatically.'}</span><button onClick={() => setPage('Leads')}>View Leads</button></div>}
    {error && <div className="finder-alert error"><FiAlertTriangle />{error}<button onClick={() => setError('')}><FiX /></button></div>}
    <p className="finder-result-summary">{results.length} found · {qualified.length} ready for outreach · {contactable} contactable · {needsFacebookReview} need Facebook review · {duplicates} already in Leads</p>
    <div className="finder-results-toolbar"><div className="finder-result-search"><FiSearch /><input aria-label="Search these results" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search these results" /></div><ScoutSelect ariaLabel="Filter results" value={filter} options={resultFilters.map(item => ({ value: item, label: item }))} onChange={setFilter} /><ScoutSelect ariaLabel="Sort results" value={sort} options={resultSorts.map(item => ({ value: item, label: item }))} onChange={setSort} /><span>{filteredResults.length} result{filteredResults.length === 1 ? '' : 's'}</span></div>
    <div className="finder-mobile-toggle" aria-label="Result view"><button aria-pressed={mobileView === 'list'} onClick={() => setMobileView('list')}>List</button><button aria-pressed={mobileView === 'map'} onClick={() => setMobileView('map')}>Map</button></div>
    <div className={`finder-review-split mobile-${mobileView}`}>
      <section className="finder-business-list" aria-label="Business results">
        <label className="finder-select-all"><input type="checkbox" checked={Boolean(importable.length) && importable.every(item => selected.includes(item.id))} onChange={() => setSelected(importable.every(item => selected.includes(item.id)) ? selected.filter(id => !importable.some(item => item.id === id)) : [...new Set([...selected, ...importable.map(item => item.id)])])} />Select all available businesses<span>{selected.length} selected</span></label>
        {filteredResults.map(result => { const existing = Boolean(result.importedLeadId); return <article key={result.id} id={`finder-business-${result.id}`} className={`finder-business-card ${focusedId === result.id ? 'focused' : ''} ${selected.includes(result.id) ? 'selected' : ''}`}>
          <input type="checkbox" aria-label={`Select ${result.name}`} disabled={existing} checked={selected.includes(result.id)} onChange={() => setSelected(current => current.includes(result.id) ? current.filter(id => id !== result.id) : [...current, result.id])} />
          <div><button className="finder-business-title" aria-pressed={focusedId === result.id} onClick={() => setFocusedId(result.id)}>{result.name}</button><p><FiMapPin />{result.address || result.city || 'Location unavailable'}</p>
          {!hasCoordinates(result) && <small>{result.provider === 'Sales review' ? 'Area checked by sales · no map coordinates' : 'Map location unavailable'}</small>}
          <div className="finder-business-facts">{result.rating != null && <span><FiStar />{result.rating.toFixed(1)} · {result.reviewCount || 0} reviews</span>}{result.distanceKm != null && <span><FiMapPin />{result.distanceKm.toFixed(1)} km from center</span>}<span>{scoreOf(result)} fit · {qualificationLabel(result, activeRequirements, isRunning, activeMode)}</span></div>
          <div className="finder-sales-decision"><span>Next: {isReady(result) ? outreachPlan(result, activeFocus).taskType : 'Research'}</span>{result.socialUrl && <span>{facebookActivity(result) === 'recent' ? `Recent post observed · ${shortDate(result.facebookResearch.lastPostAt)}` : facebookActivity(result) === 'older' ? 'Older post observed' : 'Posting activity not checked'}</span>}</div><div className="finder-business-coverage">{contactCoverage(result).map(item => <span key={item}>{item}</span>)}{existing && <span className="existing">Already in Leads</span>}</div>
          <footer><span>{result.opportunity}</span><button onClick={() => { setFocusedId(result.id); setReviewDirty(false); setPreview(result); }}>View details <FiChevronRight /></button></footer></div>
        </article>; })}
        {!filteredResults.length && <div className="finder-empty-state"><FiSearch /><strong>{results.length ? 'No matching results' : 'No businesses found'}</strong><span>{results.length ? 'Try clearing the filters.' : 'Try another area or adjust the search requirements.'}</span><button onClick={() => { if (results.length) { setQuery(''); setFilter('All results'); } else duplicateSearch(activeSearch); }}>{results.length ? 'Clear filters' : 'Edit search'}</button></div>}
      </section>
      <div className="finder-results-map-panel"><FinderMap location={activeSearch.location} area={activeSearch.area} fitAreaKey={activeSearch.id} results={mapResults} selected={selected} focusedId={focusedResult?.id} busy={busy || Boolean(isRunning)} onFocus={id => { setFocusedId(id); document.getElementById(`finder-business-${id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }} onArea={(nextArea, details) => runSearch(undefined, nextArea, details?.locationLabel)} />
        {focusedResult && <div className="finder-map-business-preview"><button className="finder-map-preview-close" aria-label="Close business preview" onClick={() => setFocusedId(undefined)}><FiX /></button><strong>{focusedResult.name}</strong><p>{focusedResult.address || focusedResult.city}</p><span>{scoreOf(focusedResult)} fit · {focusedResult.phone || 'Phone not published'}</span><div><button className="secondary" onClick={() => { setReviewDirty(false); setPreview(focusedResult); }}>View details</button>{focusedResult.importedLeadId ? <span>Already in Leads</span> : <button className="primary" onClick={() => setSelected(current => current.includes(focusedResult.id) ? current.filter(id => id !== focusedResult.id) : [...current, focusedResult.id])}>{selected.includes(focusedResult.id) ? 'Deselect business' : 'Select business'}</button>}</div></div>}
      </div>
    </div>
    {selected.length > 0 && <div className="finder-selection-bar"><div><strong>{selected.length} selected</strong><span>{selectedNeedsResearch ? `${selectedNeedsResearch} need research before outreach.` : 'Contact follow-ups will use the recommended channel.'}</span></div><button onClick={() => setSelected([])}>Clear</button><button className="primary" onClick={() => { setImportForm(current => ({ ...current, allowPossibleDuplicates: false })); setImportOpen(true); }}>Add selected to Leads <FiChevronRight /></button></div>}
    {preview && <FinderDrawer title={`${preview.name} assessment`} onClose={closePreview}><aside className="finder-insight-drawer" onClick={(event) => event.stopPropagation()}><header><div><h2>{preview.name}</h2><p>{preview.industry} · {preview.city}</p></div><button disabled={reviewBusy} onClick={closePreview} aria-label="Close"><FiX /></button></header><dl className="finder-drawer-score"><div><dt>Fit score</dt><dd>{scoreOf(preview)} · {qualificationLabel(preview, activeRequirements, isRunning, activeMode)}</dd></div><div><dt>Confidence</dt><dd>{confidenceOf(preview)} · {preview.aiStatus === 'cached' ? 'Previously assessed' : preview.aiStatus === 'complete' ? 'Saved assessment · ' + apiDate(preview.aiAnalyzedAt) : ['pending', 'running'].includes(preview.aiStatus) ? 'Assessment in progress' : 'Basic assessment'}</dd></div><div><dt>Opportunity</dt><dd>{preview.opportunity}{preview.aiClassification ? ` · ${preview.aiClassification}` : ''}</dd></div></dl><section><h3>Business details</h3><div className="finder-detail-grid"><p><span><FiPhone /> Phone</span><strong>{preview.phone || 'Not published'}</strong></p><p><span><FiMail /> Email</span><strong>{preview.email || 'Not published'}</strong></p><p><span><FiGlobe /> Website</span>{preview.website ? <a href={preview.website} target="_blank" rel="noreferrer">Open website <FiExternalLink /></a> : <strong>Not listed · needs review</strong>}</p><p><span><FiStar /> Google rating</span><strong>{preview.rating ? `${preview.rating.toFixed(1)} · ${(preview.reviewCount || 0).toLocaleString()} reviews` : 'Not available'}</strong></p></div></section><FinderFacebookReview key={preview.id} result={preview} onDirty={setReviewDirty} onSave={(url, status, research, version) => reviewFacebook(preview, url, status, research, version)} /><section className="finder-outreach-plan"><h3>First contact</h3><strong>{isReady(preview) ? outreachPlan(preview, activeFocus).channel : 'Research first'}</strong><p>{isReady(preview) ? outreachPlan(preview, activeFocus).reason : readiness(preview, activeRequirements, activeMode)}</p><blockquote>{outreachPlan(preview, activeFocus).draft}</blockquote><small>Suggested draft. Review it before contacting the business.</small></section><section className="finder-assessment-block"><h3>Scout assessment</h3><p>{preview.aiExplanation || preview.scoreReason}</p><div className="finder-assessment-tags"><span>{preview.aiIcpMatch || 'rule'} ICP match</span><span>{confidenceOf(preview)} confidence</span><span>{preview.businessStatus?.replaceAll('_', ' ').toLowerCase() || 'status unknown'}</span></div><div className="finder-signal-columns"><div><h4><FiCheck /> Opportunity signals</h4>{(preview.aiOpportunitySignals || []).length ? <ul>{preview.aiOpportunitySignals.map((signal) => <li key={signal}>{signal}</li>)}</ul> : <p>No additional signals recorded.</p>}</div><div><h4><FiAlertTriangle /> Concerns</h4>{(preview.aiConcerns || []).length ? <ul>{preview.aiConcerns.map((concern) => <li key={concern}>{concern}</li>)}</ul> : <p>No additional concerns recorded; unrecorded details remain unknown.</p>}</div></div>{preview.aiRecommendedAction && <div className="finder-next-action"><span>Recommended next action</span><strong>{preview.aiRecommendedAction}</strong></div>}{preview.aiStatus === 'failed' && <div className="finder-alert error"><span>{preview.aiError || 'Assessment unavailable.'}</span><button onClick={() => retryAssessment(preview)}>Retry assessment</button></div>}</section><section><h3>Evidence and provenance</h3><div className="finder-evidence-list">{preview.provenance.map((item, index) => <a href={item.sourceUrl} target="_blank" rel="noreferrer" key={`${item.field}-${index}`}><i>{item.field === 'facebook' ? <FiFacebook /> : item.provider === 'Google Places' ? <FiMapPin /> : <FiGlobe />}</i><span><strong>{item.field === 'business' ? 'Business listing' : `${item.field[0].toUpperCase()}${item.field.slice(1)} source`}</strong><small>{item.provider} · retrieved {shortDate(item.retrievedAt)}</small></span><FiExternalLink /></a>)}</div></section><footer>{preview.importedLeadId ? <button className="primary" disabled={reviewDirty || reviewBusy} onClick={() => preview.importedLeadId && onOpenLead ? onOpenLead(preview.importedLeadId) : setPage('Leads')}>View in Leads</button> : <button className="primary" disabled={reviewDirty || reviewBusy || isRunning} onClick={() => { setSelected([preview.id]); setPreview(null); setImportForm(current => ({ ...current, allowPossibleDuplicates: false })); setImportOpen(true); }}>Add to Leads</button>}</footer></aside></FinderDrawer>}
    {importOpen && <ProfileDialog className="finder-sales-dialog" title={`Add ${selected.length} business${selected.length === 1 ? '' : 'es'} to Leads`} busy={busy} onClose={() => setImportOpen(false)}><div className="finder-import-dialog"><div className="modal-body">{error && <p role="alert" className="finder-review-error">{error}</p>}{selectedNeedsResearch > 0 && <p>{selectedNeedsResearch} prospect{selectedNeedsResearch === 1 ? '' : 's'} need research. Recommended creates a research task for them.</p>}
        {canAssignTeam && <div className="finder-assignment-modes"><button className={importForm.assignmentMode === 'single' ? 'active' : ''} onClick={() => setImportForm({ ...importForm, assignmentMode: 'single' })}>Single owner</button><button className={importForm.assignmentMode === 'round_robin' ? 'active' : ''} onClick={() => setImportForm({ ...importForm, assignmentMode: 'round_robin' })}>Round robin</button><button className={importForm.assignmentMode === 'manual' ? 'active' : ''} onClick={() => setImportForm({ ...importForm, assignmentMode: 'manual' })}>Manual</button></div>}
        <div className="finder-import-grid">
          {importForm.assignmentMode === 'single' && <label>Owner<ScoutSelect ariaLabel="Import owner" value={importForm.ownerId || defaultOwnerId} onChange={ownerId => setImportForm({...importForm,ownerId})} options={availableAssignees.map(member => ({value:member.id,label:member.name}))} /></label>}
          {importForm.assignmentMode === 'round_robin' && <fieldset className="finder-assignee-list"><legend>Rotate between</legend>{availableAssignees.map(member => <label key={member.id}><input type="checkbox" checked={roundRobinIds.includes(member.id)} onChange={() => setImportForm({ ...importForm, assigneeIds: roundRobinIds.includes(member.id) ? roundRobinIds.filter(id => id !== member.id) : [...roundRobinIds, member.id] })} /> {member.name}</label>)}</fieldset>}
          {importForm.assignmentMode === 'manual' && <div className="finder-manual-assignments">{selected.map(resultId => <label key={resultId}><span>{results.find(result => result.id === resultId)?.name || 'Selected business'}</span><ScoutSelect ariaLabel={`Owner for ${results.find(result => result.id === resultId)?.name}`} value={resolvedManualAssignments[resultId]} onChange={ownerId => setImportForm({...importForm,manualAssignments:{...importForm.manualAssignments,[resultId]:ownerId}})} options={availableAssignees.map(member=>({value:member.id,label:member.name}))} /></label>)}</div>}
          <label>Priority<ScoutSelect ariaLabel="Import priority" value={importForm.priority} onChange={priority => setImportForm({...importForm,priority})} options={['High','Medium','Low'].map(value=>({value,label:value}))} /></label>
          <label>Lead status<ScoutSelect ariaLabel="Imported lead status" value={importForm.status} onChange={status => setImportForm({...importForm,status})} options={['New','Contacted','Interested'].map(value=>({value,label:statusLabel(value)}))} /></label>
          <label>First follow-up<input type="date" value={importForm.followUpDate} onChange={(event) => setImportForm({ ...importForm, followUpDate: event.target.value })} /></label>
        </div>
        {!availableAssignees.length && <div className="finder-alert error">Add an active member before importing leads.</div>}
        <label className="finder-import-channel">First contact<ScoutSelect ariaLabel="Import contact channel" value={importForm.channel} options={['Recommended', 'Facebook', 'Phone', 'Email', 'Research'].map(value => ({value, label: value === 'Recommended' ? 'Recommended for each business' : value === 'Research' ? 'Research first' : value}))} onChange={channel => setImportForm({...importForm, channel})} /></label><div className="finder-handoff-preview">{selectedProspects.map(result => <div key={result.id}><strong>{result.name}</strong><span>{importForm.channel === 'Recommended' ? isReady(result) ? outreachPlan(result, activeFocus).taskType : 'Research' : importForm.channel === 'Research' ? 'Research' : importForm.channel === 'Facebook' ? 'Facebook message' : importForm.channel}</span></div>)}</div>{possibleDuplicateProspects.length > 0 && <div className="finder-duplicate-review"><strong>Possible existing businesses</strong>{possibleDuplicateProspects.map(result => <p key={result.id}>{result.name}: {result.possibleDuplicates!.map(lead => [lead.city,lead.address].filter(Boolean).join(' · ')).join('; ')}</p>)}<label className="finder-checkbox-label"><input type="checkbox" checked={importForm.allowPossibleDuplicates} onChange={event => setImportForm({...importForm,allowPossibleDuplicates:event.target.checked})} />I checked these are separate businesses or branches.</label></div>}<p className="finder-import-note">Matching source records are skipped. Businesses with the same name need a branch check.</p>
      </div>
      <footer><button disabled={busy} onClick={() => setImportOpen(false)}>Cancel</button><button className="primary" disabled={busy || isRunning || (possibleDuplicateProspects.length > 0 && !importForm.allowPossibleDuplicates) || !availableAssignees.length || (importForm.assignmentMode === 'round_robin' && !roundRobinIds.length)} onClick={importSelected}>{busy ? <><Spinner /> Importing…</> : `Add ${selected.length} to Leads`}</button></footer>
    </div></ProfileDialog>}
  </div>;
}
