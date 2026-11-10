import { finderCandidateTarget, finderRequestLimit, finishCell, growBox, isRootCell, readSearchState, restrictToBox } from '@/lib/finder-cells';
import { DEFAULT_COUNTRY, placeLabel, placesRegion } from '@/lib/countries';
import { calibrateAssessment, createGeminiProvider, finderAiInputHash, geminiCostMicroUsd, parseAssessment, type FinderAiAssessment, type FinderAiInput, type FinderAiStatus } from '@/lib/finder-ai';

import { areaFromBounds, distanceKm, isWithinArea, parseFinderArea, parseFinderBounds, placesSearchArea, type FinderArea, type FinderBounds } from '@/lib/finder-map';
import { validGooglePlaceType } from '@/lib/finder-industries';
import { contactPageUrls, extractContacts, type ContactChannels } from '@/lib/website-contacts';
import { matchesContactRequirements, normalizeFacebookPageUrl, readFacebookResearch, salesOpportunity, type FacebookResearch, type RequirementMode, type SalesFocus } from '@/lib/finder-sales';

export type FinderStatus = 'Saved' | 'Queued' | 'Running' | 'Complete' | 'Partial' | 'Failed' | 'Cancelled';

export type FinderJobMessage = { kind: 'search'; workspaceId: string; searchId: string } | { kind: 'ai'; workspaceId: string; searchId: string; resultId: string };

export type FinderRuntimeConfig = {
  googlePlacesApiKey?: string;
  geminiApiKey?: string;
  geminiModel?: string;
  aiMonthlyBudgetUsd?: number;
  aiMaxCandidates?: number;
};

export type FinderSearchRecord = {
  area?: FinderArea;
  bounds?: FinderBounds;
  id: string;
  name: string;
  industry: string;
  industryType?: string;
  industryPsicCode?: string;
  location: string;
  country: string;
  locationCode?: string;
  locationType?: string;
  locationProvince?: string;
  locationRegion?: string;
  targetCount: number;
  requirements: string[];
  requirementMode: RequirementMode;
  salesFocus: SalesFocus;
  provider: string;
  status: FinderStatus;
  progress: number;
  stage: string;
  foundCount: number;
  importedCount: number;
  saved: boolean;
  retryCount: number;
  hiddenFoundCount: number;
  coverage?: 'target' | 'limit' | 'complete';
  includeFound: boolean;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type FinderResultRecord = {
  channels: ContactChannels;
  latitude?: number;
  longitude?: number;
  distanceKm?: number;
  facebookStatus: 'confirmed' | 'possible' | 'not_found';
  facebookVerifiedAt?: string;
  facebookResearch: FacebookResearch;
  reviewVersion: number;
  id: string;
  searchId: string;
  provider: string;
  providerRecordId: string;
  name: string;
  industry: string;
  address: string;
  city: string;
  phone: string;
  email: string;
  website: string;
  socialUrl: string;
  sourceUrl: string;
  businessStatus?: string;
  rating?: number;
  reviewCount?: number;
  score: number;
  scoreReason: string;
  opportunity: string;
  provenance: Array<{ field: string; provider: string; sourceUrl: string; retrievedAt: string }>;
  fetchedAt: string;
  verifiedAt: string;
  importedLeadId?: string;
  websiteSummary: string;
  ruleScore: number;
  ruleScoreReason: string;
  aiStatus: FinderAiStatus;
  aiModel?: string;
  aiClassification?: string;
  aiIcpMatch?: string;
  aiScore?: number;
  aiConfidence?: string;
  aiExplanation?: string;
  aiOpportunitySignals: string[];
  aiConcerns: string[];
  aiRecommendedAction?: string;
  aiEvidenceReferences: string[];
  aiPromptTokens: number;
  aiOutputTokens: number;
  aiEstimatedCostUsd: number;
  aiError?: string;
  aiAnalyzedAt?: string;
};

type GooglePlace = {
  location?: { latitude?: number; longitude?: number };
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  addressComponents?: Array<{ longText?: string; types?: string[] }>;
  internationalPhoneNumber?: string;
  nationalPhoneNumber?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  primaryTypeDisplayName?: { text?: string };
  businessStatus?: string;
  rating?: number;
  userRatingCount?: number;
};

type GooglePlacesResponse = {
  places?: GooglePlace[];
  nextPageToken?: string;
  error?: { message?: string };
};

function rejectedIncludedType(message?: string) {
  return Boolean(message && /invalid.*included[_ ]?type|included[_ ]?type.*(?:invalid|supported)/i.test(message));
}

export function finderPlacesErrorMessage(status: number) {
  if (status === 429) return 'Business search is temporarily busy. Please retry in a moment.';
  if (status === 401 || status === 403) return 'The business search connection needs attention. Ask your workspace administrator to check the Google Places configuration.';
  return 'The business directory could not complete this search. Please retry or adjust the search criteria.';
}

function parseArray(value: unknown) {
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function mapFinderSearch(row: Record<string, unknown>): FinderSearchRecord {
  return {
    area: parseFinderArea(row.map_area_json) || areaFromBounds(parseFinderBounds(row.map_bounds_json)),
    bounds: parseFinderBounds(row.map_bounds_json),
    id: String(row.id), name: String(row.name), industry: String(row.industry), location: String(row.location), country: String(row.country || DEFAULT_COUNTRY),
    industryType: row.industry_type ? String(row.industry_type) : undefined, industryPsicCode: row.industry_psic_code ? String(row.industry_psic_code) : undefined,
    locationCode: row.location_code ? String(row.location_code) : undefined, locationType: row.location_type ? String(row.location_type) : undefined,
    locationProvince: row.location_province ? String(row.location_province) : undefined, locationRegion: row.location_region ? String(row.location_region) : undefined,
    targetCount: Number(row.target_count), requirements: parseArray(row.requirements_json).map(String), provider: String(row.provider),
    requirementMode: row.requirement_mode === 'any' ? 'any' : 'all', salesFocus: ['Website & booking', 'Digital marketing', 'General outreach'].includes(String(row.sales_focus)) ? String(row.sales_focus) as SalesFocus : 'Website & booking',
    status: String(row.status) as FinderStatus, progress: Number(row.progress), stage: String(row.stage), foundCount: Number(row.found_count),
    importedCount: Number(row.imported_count), saved: Boolean(row.saved), retryCount: Number(row.retry_count),
    hiddenFoundCount: Number(row.hidden_found_count || 0), coverage: row.coverage ? row.coverage as FinderSearchRecord['coverage'] : undefined, includeFound: Boolean(row.include_found),
    error: row.error ? String(row.error) : undefined, startedAt: row.started_at ? String(row.started_at) : undefined,
    completedAt: row.completed_at ? String(row.completed_at) : undefined, createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function readChannels(value: unknown): ContactChannels {
  try { const parsed = JSON.parse(String(value || '{}')) as ContactChannels; return parsed && typeof parsed === 'object' ? parsed : {}; } catch { return {}; }
}

export function mapFinderResult(row: Record<string, unknown>): FinderResultRecord {
  return {
    latitude: row.latitude == null ? undefined : Number(row.latitude), longitude: row.longitude == null ? undefined : Number(row.longitude),
    distanceKm: row.distance_km == null ? undefined : Number(row.distance_km),
    facebookStatus: String(row.facebook_status || (row.social_url ? 'possible' : 'not_found')) as FinderResultRecord['facebookStatus'],
    facebookVerifiedAt: row.facebook_verified_at ? String(row.facebook_verified_at) : undefined,
    facebookResearch: readFacebookResearch(row.facebook_research_json), reviewVersion: Number(row.review_version || 0),
    id: String(row.id), searchId: String(row.search_id), provider: String(row.provider), providerRecordId: String(row.provider_record_id),
    name: String(row.name), industry: String(row.industry), address: String(row.address), city: String(row.city), phone: String(row.phone),
    email: String(row.email), website: String(row.website), socialUrl: String(row.social_url), sourceUrl: String(row.source_url), channels: readChannels(row.channels_json),
    businessStatus: row.business_status ? String(row.business_status) : undefined, rating: row.rating == null ? undefined : Number(row.rating),
    reviewCount: row.review_count == null ? undefined : Number(row.review_count), score: Number(row.score), scoreReason: String(row.score_reason),
    opportunity: String(row.opportunity), provenance: parseArray(row.provenance_json) as FinderResultRecord['provenance'],
    fetchedAt: String(row.fetched_at), verifiedAt: String(row.verified_at), importedLeadId: row.imported_lead_id ? String(row.imported_lead_id) : undefined,
    websiteSummary: String(row.website_summary || ''), ruleScore: Number(row.rule_score ?? row.score), ruleScoreReason: String(row.rule_score_reason || row.score_reason),
    aiStatus: String(row.ai_status || 'pending') as FinderAiStatus, aiModel: row.ai_model ? String(row.ai_model) : undefined,
    aiClassification: row.ai_classification ? String(row.ai_classification) : undefined, aiIcpMatch: row.ai_icp_match ? String(row.ai_icp_match) : undefined,
    aiScore: row.ai_score == null ? undefined : Number(row.ai_score), aiConfidence: row.ai_confidence ? String(row.ai_confidence) : undefined,
    aiExplanation: row.ai_explanation ? String(row.ai_explanation) : undefined,
    aiOpportunitySignals: parseArray(row.ai_opportunity_signals_json).map(String), aiConcerns: parseArray(row.ai_concerns_json).map(String),
    aiRecommendedAction: row.ai_recommended_action ? String(row.ai_recommended_action) : undefined,
    aiEvidenceReferences: parseArray(row.ai_evidence_refs_json).map(String), aiPromptTokens: Number(row.ai_prompt_tokens || 0), aiOutputTokens: Number(row.ai_output_tokens || 0),
    aiEstimatedCostUsd: Number(row.ai_estimated_cost_microusd || 0) / 1_000_000, aiError: row.ai_error ? String(row.ai_error) : undefined,
    aiAnalyzedAt: row.ai_analyzed_at ? String(row.ai_analyzed_at) : undefined,
  };
}

function cityFromPlace(place: GooglePlace, fallback: string) {
  const preferred = ['locality', 'postal_town', 'administrative_area_level_2', 'administrative_area_level_1'];
  for (const type of preferred) {
    const component = place.addressComponents?.find(value => value.types?.includes(type));
    if (component?.longText) return component.longText;
  }
  return fallback;
}

function publicWebsite(url: string) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    if (hostname === 'localhost' || hostname.endsWith('.local') || hostname === '0.0.0.0' || hostname === '::1') return false;
    if (/^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

const facebookUrl = normalizeFacebookPageUrl;

type WebsiteEvidence = { email: string; socialUrl: string; summary: string; phone?: string; channels?: ContactChannels };
const emptyEvidence = (): WebsiteEvidence => ({ email: '', socialUrl: '', summary: '' });

async function websiteEvidence(website: string): Promise<WebsiteEvidence> {
  if (!website || !publicWebsite(website)) return emptyEvidence();
  try {
    let root = new URL(website);
    const sameHost = (url: URL) => url.hostname.replace(/^www\./i, '') === root.hostname.replace(/^www\./i, '') && url.port === root.port;
    const fetchPage = async (url: string, kind: 'html' | 'xml' = 'html') => {
      const signal = AbortSignal.timeout(4000);
      for (let redirects = 0; redirects <= 3; redirects++) {
        if (!publicWebsite(url) || !sameHost(new URL(url))) return '';
        const response = await fetch(url, { headers: { accept: 'text/html', 'user-agent': 'ScoutFinder/1.0 (+business-contact-discovery)' }, redirect: 'manual', signal });
        if ([301,302,303,307,308].includes(response.status)) {
          const location = response.headers.get('location'); await response.body?.cancel(); if (!location) return ''; url = new URL(location,url).href; continue;
        }
        if (!response.ok || !response.headers.get('content-type')?.includes(kind)) { await response.body?.cancel(); return ''; }
        const reader = response.body?.getReader(); if (!reader) return '';
        const decoder = new TextDecoder(); let text = ''; let size = 0;
        try { while (size < 300_000) { const {done,value} = await reader.read(); if (done) break; const chunk=value.subarray(0,300_000-size); size+=chunk.length; text+=decoder.decode(chunk,{stream:true}); } text+=decoder.decode(); }
        finally { await reader.cancel(); }
        if (kind === 'html') root = new URL(url);
        return text;
      }
      return '';
    };
    const homepage = await fetchPage(root.href);
    if (!homepage) return emptyEvidence();
    // The sitemap costs one more request, so it is only read when the homepage links no contact-type page.
    const linksContactPage = /<a\b[^>]*href=["'][^"']*(?:contact|about|location|branch)[^"']*["']/i.test(homepage);
    const sitemap = linksContactPage ? '' : await fetchPage(new URL('/sitemap.xml', root).href, 'xml');
    const extraPages = await Promise.all(contactPageUrls(homepage, sitemap, root).map(url => fetchPage(url)));
    const contacts = extractContacts([homepage, ...extraPages], root.href);
    const html = [homepage, ...extraPages].filter(Boolean).join('\n');
    const title = homepage.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '';
    const description = homepage.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i)?.[1] || homepage.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i)?.[1] || '';
    const visible = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&(?:nbsp|amp|quot|#39);/gi, ' ').replace(/\s+/g, ' ').trim();
    const summary = [title, description, visible].filter(Boolean).join(' · ').slice(0, 2400);
    return { email: contacts.email, socialUrl: contacts.socialUrl, summary, phone: contacts.phone, channels: contacts.channels };
  } catch {
    return { email: '', socialUrl: '', summary: '' };
  }
}

export function assessPlace(place: GooglePlace, evidence = { email: '', socialUrl: '', summary: '' }, focus: SalesFocus = 'Website & booking', research?: FacebookResearch, facebookStatus = 'possible') {
  const directFacebook = facebookUrl(place.websiteUri || '');
  const website = directFacebook ? '' : place.websiteUri || '';
  const phone = place.internationalPhoneNumber || place.nationalPhoneNumber || '';
  let score = 56;
  const reasons: string[] = [];
  if (place.businessStatus === 'OPERATIONAL') { score += 8; reasons.push('listed as operational'); }
  if (phone) { score += 8; reasons.push('published business phone'); }
  if (website) { score += 4; reasons.push('website listed'); } else { reasons.push(research?.websiteStatus === 'not_found' ? 'no website found in reviewed sources' : 'website presence needs verification'); }
  if (evidence.email) { score += 6; reasons.push('public email found'); }
  if (directFacebook || evidence.socialUrl) { score += facebookStatus === 'confirmed' ? 8 : 2; reasons.push(facebookStatus === 'confirmed' ? 'Facebook page confirmed by sales review' : 'Facebook link needs review'); }
  if (facebookStatus === 'confirmed' && research?.messenger === 'available') { score += 8; reasons.push('Facebook messaging reviewed'); }
  if (facebookStatus === 'confirmed' && research?.identityChecks.includes('name') && research.identityChecks.length >= 2 && (research.services || research.customerSignals)) { score += 6; reasons.push('sales observations recorded'); }
  if (focus === 'Website & booking' && research?.websiteStatus === 'not_found' && facebookStatus === 'confirmed') { score += 8; reasons.push('website opportunity requires a needs conversation'); }
  if ((place.rating || 0) >= 4.4) { score += 2; reasons.push('positive Google rating; buying intent unknown'); }
  if ((place.userRatingCount || 0) >= 25) score += 2;
  if (place.businessStatus && place.businessStatus !== 'OPERATIONAL') score = Math.min(score, 45);
  const opportunity = salesOpportunity({ name: '', phone, email: evidence.email, website, socialUrl: directFacebook || evidence.socialUrl, facebookStatus, facebookResearch: research }, focus);
  return { score: Math.min(92, score), scoreReason: reasons.length ? reasons.join(', ') : 'Business details need review', opportunity };
}

export const matchesRequirements = matchesContactRequirements;

const currentMonth = () => new Date().toISOString().slice(0, 7);
const budgetMicroUsd = (config: FinderRuntimeConfig) => Math.max(0, Math.round((config.aiMonthlyBudgetUsd ?? 2) * 1_000_000));
const reservationMicroUsd = 5_000;

function aiInput(result: FinderResultRecord, search: FinderSearchRecord): FinderAiInput {
  return {
    name: result.name, industry: result.industry, location: result.city, address: result.address, phone: result.phone,
    email: result.email, website: result.website, socialUrl: result.socialUrl, businessStatus: result.businessStatus,
    rating: result.rating, reviewCount: result.reviewCount, websiteSummary: result.websiteSummary,
    searchIndustry: search.industry, searchLocation: search.location, ruleScore: result.ruleScore, ruleReason: result.ruleScoreReason,
    salesFocus: search.salesFocus, facebookStatus: result.facebookStatus, facebookResearch: result.facebookResearch,
    evidence: result.provenance.map((item, index) => ({ id: `evidence-${index + 1}`, field: item.field, provider: item.provider, sourceUrl: item.sourceUrl })),
  };
}

async function applyAssessment(db: D1Database, workspaceId: string, resultId: string, assessment: FinderAiAssessment, model: string, status: 'complete' | 'cached', inputHash: string, promptTokens: number, outputTokens: number, cost: number, reviewVersion: number) {
  const updated = await db.prepare(`UPDATE finder_results SET score=?,score_reason=?,ai_status=?,ai_model=?,ai_classification=?,ai_icp_match=?,ai_score=?,ai_confidence=?,ai_explanation=?,ai_opportunity_signals_json=?,ai_concerns_json=?,ai_recommended_action=?,ai_evidence_refs_json=?,ai_input_hash=?,ai_prompt_tokens=?,ai_output_tokens=?,ai_estimated_cost_microusd=?,ai_error=NULL,ai_analyzed_at=CURRENT_TIMESTAMP,ai_attempts=ai_attempts+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=? AND review_version=?`)
    .bind(assessment.fitScore, assessment.explanation, status, model, assessment.classification, assessment.icpMatch, assessment.fitScore, assessment.confidence, assessment.explanation, JSON.stringify(assessment.opportunitySignals), JSON.stringify(assessment.concerns), assessment.recommendedNextAction, JSON.stringify(assessment.evidenceReferences), inputHash, promptTokens, outputTokens, cost, resultId, workspaceId, reviewVersion).run();
  if (updated.meta.changes) {
    await db.prepare('UPDATE leads SET score=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE workspace_id=? AND id=(SELECT imported_lead_id FROM finder_results WHERE id=? AND workspace_id=?)').bind(assessment.fitScore, workspaceId, resultId, workspaceId).run();
    await db.prepare('UPDATE opportunity_finder_assessments SET assessment_json=json_patch(assessment_json,?),updated_at=CURRENT_TIMESTAMP WHERE workspace_id=? AND finder_result_id=?').bind(JSON.stringify(assessment), workspaceId, resultId).run();
  }
}

async function processFinderAiResult(db: D1Database, workspaceId: string, searchId: string, resultId: string, config: FinderRuntimeConfig) {
  const [searchRow, resultRow] = await Promise.all([
    db.prepare('SELECT * FROM finder_searches WHERE id=? AND workspace_id=?').bind(searchId, workspaceId).first<Record<string, unknown>>(),
    db.prepare('SELECT * FROM finder_results WHERE id=? AND search_id=? AND workspace_id=?').bind(resultId, searchId, workspaceId).first<Record<string, unknown>>(),
  ]);
  if (!searchRow || !resultRow || !['pending', 'failed'].includes(String(resultRow.ai_status || 'pending'))) return;
  const search = mapFinderSearch(searchRow); const result = mapFinderResult(resultRow); const model = config.geminiModel || 'gemini-3.1-flash-lite';
  const input = aiInput(result, search); const inputHash = await finderAiInputHash(input);
  const cached = await db.prepare('SELECT * FROM finder_ai_cache WHERE workspace_id=? AND input_hash=? AND model=?').bind(workspaceId, inputHash, model).first<Record<string, unknown>>();
  const cachedAssessment = cached && parseAssessment(cached.assessment_json);
  if (cachedAssessment) {
    await applyAssessment(db, workspaceId, resultId, calibrateAssessment(input, cachedAssessment), model, 'cached', inputHash, Number(cached.prompt_tokens || 0), Number(cached.output_tokens || 0), 0, result.reviewVersion);
    return;
  }
  const provider = createGeminiProvider(config.geminiApiKey, model);
  if (!provider) {
    await db.prepare("UPDATE finder_results SET ai_status='skipped',ai_model=?,ai_error='Gemini API key is not configured; rule-based assessment is active.',ai_input_hash=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=? AND ai_status NOT IN ('complete','cached') AND review_version=?").bind(model, inputHash, resultId, workspaceId,result.reviewVersion).run();
    return;
  }
  const claim = await db.prepare("UPDATE finder_results SET ai_status='running',ai_model=?,ai_input_hash=?,ai_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=? AND ai_status IN ('pending','failed') AND review_version=?").bind(model, inputHash, resultId, workspaceId, result.reviewVersion).run();
  if (!claim.meta.changes) return;
  const requestId = `${workspaceId}:${resultId}:${inputHash}:${model}`;
  const reservation = await db.prepare(`INSERT INTO finder_ai_usage (id,workspace_id,month,search_id,result_id,input_hash,model,request_id,status,reserved_microusd)
    SELECT ?,?,?,?,?,?,?,?,'reserved',? WHERE COALESCE((SELECT SUM(CASE WHEN status='committed' THEN actual_microusd WHEN status='reserved' THEN reserved_microusd ELSE 0 END) FROM finder_ai_usage WHERE workspace_id=? AND month=?),0)+?<=?
    ON CONFLICT(request_id) DO NOTHING`).bind(crypto.randomUUID(), workspaceId, currentMonth(), searchId, resultId, inputHash, model, requestId, reservationMicroUsd, workspaceId, currentMonth(), reservationMicroUsd, budgetMicroUsd(config)).run();
  let reserved = Boolean(reservation.meta.changes);
  if (!reserved) {
    const prior = await db.prepare('SELECT status FROM finder_ai_usage WHERE request_id=?').bind(requestId).first<{ status: string }>();
    if (prior?.status === 'failed') {
      const reclaimed = await db.prepare(`UPDATE finder_ai_usage SET status='reserved',reserved_microusd=?,actual_microusd=0,prompt_tokens=0,output_tokens=0,updated_at=CURRENT_TIMESTAMP
        WHERE request_id=? AND status='failed' AND COALESCE((SELECT SUM(CASE WHEN status='committed' THEN actual_microusd WHEN status='reserved' THEN reserved_microusd ELSE 0 END) FROM finder_ai_usage WHERE workspace_id=? AND month=?),0)+?<=?`)
        .bind(reservationMicroUsd, requestId, workspaceId, currentMonth(), reservationMicroUsd, budgetMicroUsd(config)).run();
      reserved = Boolean(reclaimed.meta.changes);
    }
    if (!reserved) {
      if (!prior || prior.status === 'failed') await db.prepare("UPDATE finder_results SET ai_status='budget_limited',ai_model=?,ai_error='Monthly AI budget reached; rule-based assessment is active.',ai_input_hash=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=? AND review_version=?").bind(model, inputHash, resultId, workspaceId,result.reviewVersion).run();
      else if (prior.status === 'committed') await db.prepare("UPDATE finder_results SET ai_status='failed',ai_error='The previous AI assessment was charged but its cached response is unavailable. No second charge was made.',updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=? AND ai_status='running' AND review_version=?").bind(resultId, workspaceId,result.reviewVersion).run();
      else await db.prepare("UPDATE finder_results SET ai_status='failed',ai_error='An AI assessment is already in progress. Retry if it does not finish shortly.',updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=? AND ai_status='running' AND review_version=?").bind(resultId, workspaceId,result.reviewVersion).run();
      return;
    }
  }
  try {
    const response = await provider.assess(input); const cost = geminiCostMicroUsd(response.promptTokens, response.outputTokens);
    const assessment = calibrateAssessment(input, response.assessment);
    await db.prepare(`INSERT INTO finder_ai_cache (workspace_id,input_hash,model,assessment_json,prompt_tokens,output_tokens,estimated_cost_microusd) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(workspace_id,input_hash,model) DO UPDATE SET assessment_json=excluded.assessment_json,prompt_tokens=excluded.prompt_tokens,output_tokens=excluded.output_tokens,estimated_cost_microusd=excluded.estimated_cost_microusd,updated_at=CURRENT_TIMESTAMP`)
      .bind(workspaceId, inputHash, model, JSON.stringify(response.assessment), response.promptTokens, response.outputTokens, cost).run();
    await applyAssessment(db, workspaceId, resultId, assessment, model, 'complete', inputHash, response.promptTokens, response.outputTokens, cost, result.reviewVersion);
    await db.prepare("UPDATE finder_ai_usage SET status='committed',actual_microusd=?,prompt_tokens=?,output_tokens=?,updated_at=CURRENT_TIMESTAMP WHERE request_id=? AND status='reserved'").bind(cost, response.promptTokens, response.outputTokens, requestId).run();
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 400) : 'AI assessment failed.';
    await db.batch([
      db.prepare("UPDATE finder_results SET ai_status='failed',ai_model=?,ai_error=?,ai_input_hash=?,ai_attempts=ai_attempts+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=? AND review_version=?").bind(model, message, inputHash, resultId, workspaceId, result.reviewVersion),
      db.prepare("UPDATE finder_ai_usage SET status='failed',reserved_microusd=0,updated_at=CURRENT_TIMESTAMP WHERE request_id=? AND status='reserved'").bind(requestId),
    ]);
  }
}

async function processFinderAiSearch(db: D1Database, workspaceId: string, searchId: string, config: FinderRuntimeConfig) {
  const maxCandidates = Math.max(0, Math.min(60, Math.floor(config.aiMaxCandidates ?? 20)));
  await db.prepare("UPDATE finder_searches SET progress=MAX(progress,82),stage='Assessing collected evidence',updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=? AND status='Running'").bind(searchId, workspaceId).run();
  const rows = await db.prepare("SELECT id FROM finder_results WHERE search_id=? AND workspace_id=? AND imported_lead_id IS NULL AND ai_status IN ('pending','failed') ORDER BY rule_score DESC,name LIMIT ?").bind(searchId, workspaceId, maxCandidates).all<{ id: string }>();
  await db.prepare("UPDATE finder_results SET ai_status='skipped',ai_error='Not selected for AI assessment; rule-based score is active.',updated_at=CURRENT_TIMESTAMP WHERE search_id=? AND workspace_id=? AND ai_status='pending' AND id NOT IN (SELECT id FROM finder_results WHERE search_id=? AND workspace_id=? ORDER BY rule_score DESC,name LIMIT ?)").bind(searchId, workspaceId, searchId, workspaceId, maxCandidates).run();
  await db.prepare("UPDATE finder_searches SET progress=MAX(progress,88),stage='Ranking matches',updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=? AND status='Running'").bind(searchId, workspaceId).run();
  for (const row of rows.results) {
    const status = await db.prepare('SELECT status FROM finder_searches WHERE id=? AND workspace_id=?').bind(searchId, workspaceId).first<{ status: string }>();
    if (status?.status === 'Cancelled') return;
    await processFinderAiResult(db, workspaceId, searchId, row.id, config);
  }
}

const REQUESTS_PER_RUN = 6;
const FOUND_MEMORY_DAYS = 90;

/** Businesses this workspace has already been shown, and any already saved as leads. */
async function foundPlaceIds(db: D1Database, workspaceId: string) {
  const rows = await db.prepare(`SELECT provider_record_id id FROM finder_seen_places WHERE workspace_id=?1 AND provider='Google Places' AND last_seen_at>=datetime('now','-${FOUND_MEMORY_DAYS} days')
    UNION SELECT finder_record_id FROM leads WHERE workspace_id=?1 AND finder_provider='Google Places' AND finder_record_id IS NOT NULL`).bind(workspaceId).all<{ id: string }>();
  return new Set(rows.results.map(row => row.id));
}

/** Kept apart from results so that deleting a search doesn't bring its businesses back. Only what a rep was shown counts. */
async function rememberFoundPlaces(db: D1Database, workspaceId: string, searchId: string) {
  await db.prepare(`INSERT INTO finder_seen_places (workspace_id,provider,provider_record_id) SELECT workspace_id,provider,provider_record_id FROM finder_results WHERE workspace_id=? AND search_id=? AND provider='Google Places'
    ON CONFLICT(workspace_id,provider,provider_record_id) DO UPDATE SET last_seen_at=CURRENT_TIMESTAMP`).bind(workspaceId, searchId).run();
}

export async function processFinderJob(db: D1Database, workspaceId: string, searchId: string, configOrKey: FinderRuntimeConfig | string = {}, requeue?: (next: FinderJobMessage) => Promise<unknown>) {
  const config: FinderRuntimeConfig = typeof configOrKey === 'string' ? { googlePlacesApiKey: configOrKey } : configOrKey;
  const jobRow = await db.prepare('SELECT * FROM finder_searches WHERE id=? AND workspace_id=?').bind(searchId, workspaceId).first<Record<string, unknown>>();
  if (!jobRow || String(jobRow.status) !== 'Queued') return;
  const job = mapFinderSearch(jobRow);
  const candidateTarget = finderCandidateTarget(job.targetCount);
  const requestLimit = finderRequestLimit(job.targetCount);
  const searchArea = job.area || areaFromBounds(job.bounds);
  const claim = await db.prepare("UPDATE finder_searches SET status='Running',progress=MAX(progress,8),stage='Searching businesses',error=NULL,started_at=COALESCE(started_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=? AND status='Queued'").bind(searchId, workspaceId).run();
  if (!claim.meta.changes) return;
  if (!config.googlePlacesApiKey) {
    await db.prepare("UPDATE finder_searches SET status='Failed',stage='Connection required',error='Google Places API key is not configured.',updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?").bind(searchId, workspaceId).run();
    return;
  }
  const requestedFields = ['places.location', 'places.internationalPhoneNumber', 'places.nationalPhoneNumber', 'places.websiteUri', 'places.id', 'places.displayName', 'places.formattedAddress', 'places.addressComponents', 'places.googleMapsUri', 'places.primaryTypeDisplayName', 'places.businessStatus', 'places.rating', 'places.userRatingCount', 'nextPageToken'];
  const state = readSearchState(jobRow.search_state_json);
  const requestsAtStart = state.requests;
  const found = job.includeFound ? new Set<string>() : await foundPlaceIds(db, workspaceId);
  const hidden = new Set(state.hidden);
  const counted = await db.prepare('SELECT COUNT(*) total FROM finder_results WHERE search_id=? AND workspace_id=?').bind(searchId, workspaceId).first<{ total: number }>();
  let accepted = Number(counted?.total || 0);
  try {
    while (state.cells.length && accepted < candidateTarget && state.requests < requestLimit) {
      const current = await db.prepare('SELECT status FROM finder_searches WHERE id=? AND workspace_id=?').bind(searchId, workspaceId).first<{ status: string }>();
      if (current?.status === 'Cancelled') return;
      // Long searches continue in a fresh run, so one job can't hit the platform's limit on outgoing requests.
      if (requeue && state.requests - requestsAtStart >= REQUESTS_PER_RUN) {
        state.hidden = [...hidden];
        await db.prepare("UPDATE finder_searches SET status='Queued',search_state_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=? AND status='Running'").bind(JSON.stringify(state), searchId, workspaceId).run();
        await requeue({ kind: 'search', workspaceId, searchId });
        return;
      }
      const cell = state.cells[0];
      const includedType = validGooglePlaceType(job.industryType);
      const requestBody: Record<string, unknown> = {
        textQuery: searchArea ? job.industry : `${job.industry} in ${placeLabel(job.location, job.country)}`,
        ...placesRegion(job.country),
        ...(isRootCell(cell) ? placesSearchArea(searchArea) : restrictToBox(cell)),
        ...(includedType ? { includedType, strictTypeFiltering: true } : {}),
        pageSize: 20,
        ...(state.pageToken ? { pageToken: state.pageToken } : {}),
      };
      const requestPlaces = async () => {
        const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': config.googlePlacesApiKey!, 'X-Goog-FieldMask': requestedFields.join(',') },
          body: JSON.stringify(requestBody),
        });
        return { response, data: await response.json() as GooglePlacesResponse };
      };
      let { response, data } = await requestPlaces();
      if (!response.ok && includedType && rejectedIncludedType(data.error?.message)) {
        delete requestBody.includedType;
        delete requestBody.strictTypeFiltering;
        ({ response, data } = await requestPlaces());
      }
      if (!response.ok) {
        console.error('Google Places search failed', { status: response.status, message: data.error?.message });
        throw new Error(finderPlacesErrorMessage(response.status));
      }
      const places = data.places || [];
      state.requests += 1;
      state.cellPlaces = (state.cellPlaces || 0) + places.length;
      growBox(state, places.map(place => ({ latitude: place.location?.latitude, longitude: place.location?.longitude })));
      for (const place of places) if (place.id && found.has(place.id)) hidden.add(place.id);
      const newPlaces = places.filter(place => !place.id || !found.has(place.id));
      const shouldInspectWebsites = job.requirements.some(item => ['Email', 'Social', 'Facebook'].includes(item));
      const enriched = await Promise.all(newPlaces.map(async place => {
        const directFacebook = facebookUrl(place.websiteUri || '');
        const evidence = directFacebook ? { email: '', socialUrl: directFacebook, summary: '' }
          : shouldInspectWebsites || Boolean(place.websiteUri) ? await websiteEvidence(place.websiteUri || '') : { email: '', socialUrl: '', summary: '' };
        return { place, evidence, directFacebook };
      }));
      const fetchedAt = new Date().toISOString();
      const prepared = enriched.map(({ place, evidence, directFacebook }) => {
        const name = place.displayName?.text?.trim() || '';
        const sourceUrl = place.googleMapsUri || '';
        const website = directFacebook ? '' : place.websiteUri || '';
        const googlePhone = place.internationalPhoneNumber || place.nationalPhoneNumber || '';
        const phone = googlePhone || evidence.phone || '';
        const channels = evidence.channels || {};
        const assessment = assessPlace(place, evidence, job.salesFocus);
        const provenance: FinderResultRecord['provenance'] = [
          { field: 'business', provider: 'Google Places', sourceUrl, retrievedAt: fetchedAt },
          ...(phone ? [{ field: 'phone', provider: googlePhone ? 'Google Places' : 'Company website', sourceUrl: googlePhone ? sourceUrl : website, retrievedAt: fetchedAt }] : []),
          ...(Object.keys(channels).length ? [{ field: 'messaging', provider: 'Company website', sourceUrl: website, retrievedAt: fetchedAt }] : []),
          ...(website ? [{ field: 'website', provider: 'Google Places', sourceUrl, retrievedAt: fetchedAt }] : []),
          ...(evidence.email ? [{ field: 'email', provider: 'Company website', sourceUrl: website, retrievedAt: fetchedAt }] : []),
          ...(evidence.socialUrl ? [{ field: 'facebook', provider: directFacebook ? 'Google Places' : 'Company website', sourceUrl: evidence.socialUrl, retrievedAt: fetchedAt }] : []),
        ];
        const latitude = place.location?.latitude;
        const longitude = place.location?.longitude;
        const resultDistanceKm = searchArea && Number.isFinite(latitude) && Number.isFinite(longitude)
          ? distanceKm(searchArea.latitude, searchArea.longitude, latitude!, longitude!) : undefined;
        return {
          latitude, longitude, distanceKm: resultDistanceKm,
          provider: 'Google Places', providerRecordId: place.id || crypto.randomUUID(), name,
          industry: place.primaryTypeDisplayName?.text || job.industry, address: place.formattedAddress || '', city: cityFromPlace(place, job.location),
          phone, email: evidence.email, website, socialUrl: evidence.socialUrl, channels, sourceUrl, businessStatus: place.businessStatus,
          rating: place.rating, reviewCount: place.userRatingCount, ...assessment, websiteSummary: evidence.summary, provenance, fetchedAt, verifiedAt: fetchedAt,
          facebookStatus: evidence.socialUrl ? 'possible' : 'not_found',
        };
      }).filter(result => result.name && result.sourceUrl && result.businessStatus !== 'CLOSED_PERMANENTLY' && isWithinArea(result, searchArea)).sort((a, b) => {
        const fields = (result: typeof a) => job.requirements.filter(field => field === 'Phone' ? result.phone : field === 'Email' ? result.email : field === 'Website' ? result.website : result.socialUrl).length;
        return fields(b) - fields(a) || b.score - a.score;
      }).slice(0, Math.max(0, candidateTarget - accepted));
      if (prepared.length) {
        await db.batch(prepared.map(result => db.prepare(`INSERT INTO finder_results (id,workspace_id,search_id,provider,provider_record_id,name,industry,address,city,phone,email,website,social_url,source_url,business_status,rating,review_count,score,score_reason,opportunity,provenance_json,website_summary,rule_score,rule_score_reason,ai_status,fetched_at,verified_at,latitude,longitude,distance_km,facebook_status,channels_json)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?,?,?,?,?,?) ON CONFLICT(search_id,provider,provider_record_id) DO UPDATE SET channels_json=excluded.channels_json,latitude=excluded.latitude,longitude=excluded.longitude,distance_km=excluded.distance_km,name=excluded.name,industry=excluded.industry,address=excluded.address,city=excluded.city,phone=excluded.phone,email=excluded.email,website=excluded.website,social_url=CASE WHEN finder_results.review_version>0 THEN finder_results.social_url ELSE excluded.social_url END,facebook_status=CASE WHEN finder_results.review_version>0 THEN finder_results.facebook_status ELSE excluded.facebook_status END,source_url=excluded.source_url,business_status=excluded.business_status,rating=excluded.rating,review_count=excluded.review_count,score=CASE WHEN finder_results.review_version>0 THEN finder_results.score ELSE excluded.score END,score_reason=CASE WHEN finder_results.review_version>0 THEN finder_results.score_reason ELSE excluded.score_reason END,opportunity=CASE WHEN finder_results.review_version>0 THEN finder_results.opportunity ELSE excluded.opportunity END,provenance_json=CASE WHEN finder_results.review_version>0 THEN finder_results.provenance_json ELSE excluded.provenance_json END,website_summary=excluded.website_summary,rule_score=CASE WHEN finder_results.review_version>0 THEN finder_results.rule_score ELSE excluded.rule_score END,rule_score_reason=CASE WHEN finder_results.review_version>0 THEN finder_results.rule_score_reason ELSE excluded.rule_score_reason END,ai_status=CASE WHEN finder_results.ai_input_hash IS NULL THEN 'pending' ELSE finder_results.ai_status END,fetched_at=excluded.fetched_at,verified_at=excluded.verified_at,updated_at=CURRENT_TIMESTAMP`)
          .bind(crypto.randomUUID(), workspaceId, searchId, result.provider, result.providerRecordId, result.name, result.industry, result.address, result.city, result.phone, result.email, result.website, result.socialUrl, result.sourceUrl, result.businessStatus || null, result.rating ?? null, result.reviewCount ?? null, result.score, result.scoreReason, result.opportunity, JSON.stringify(result.provenance), result.websiteSummary, result.score, result.scoreReason, result.fetchedAt, result.verifiedAt, result.latitude ?? null, result.longitude ?? null, result.distanceKm ?? null, result.facebookStatus, JSON.stringify(result.channels))));
      }
      const total = await db.prepare('SELECT COUNT(*) total FROM finder_results WHERE search_id=? AND workspace_id=?').bind(searchId, workspaceId).first<{ total: number }>();
      accepted = Number(total?.total || 0);
      state.pageToken = data.nextPageToken;
      if (!state.pageToken) finishCell(state, searchArea);
      state.hidden = [...hidden];
      const progress = Math.min(92, 20 + Math.round(accepted / candidateTarget * 70));
      await db.prepare("UPDATE finder_searches SET found_count=?,progress=MAX(progress,?),stage='Verifying contact info',search_state_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?").bind(accepted, progress, JSON.stringify(state), searchId, workspaceId).run();
    }
    const coverage = accepted >= candidateTarget ? 'target' : state.cells.length ? 'limit' : 'complete';
    await processFinderAiSearch(db, workspaceId, searchId, config);
    const finalRows = await db.prepare('SELECT * FROM finder_results WHERE search_id=? AND workspace_id=?').bind(searchId, workspaceId).all<Record<string, unknown>>();
    const ranked = finalRows.results.map(mapFinderResult).sort((a, b) => {
      const coverage = (result: FinderResultRecord) => job.requirements.filter(field => field === 'Phone' ? result.phone : field === 'Email' ? result.email : field === 'Website' ? result.website : result.socialUrl).length;
      const matched = (result: FinderResultRecord) => job.requirementMode === 'all' ? coverage(result) === job.requirements.length : coverage(result) > 0;
      return Number(!!b.importedLeadId) - Number(!!a.importedLeadId) || Number(matched(b)) - Number(matched(a)) || b.score - a.score;
    });
    const remove = ranked.slice(job.targetCount).filter(result => !result.importedLeadId && result.provider === 'Google Places' && !result.facebookVerifiedAt);
    if (remove.length) await db.batch(remove.map(result => db.prepare('DELETE FROM finder_results WHERE id=? AND workspace_id=? AND imported_lead_id IS NULL').bind(result.id, workspaceId)));
    accepted = ranked.length - remove.length;
    await rememberFoundPlaces(db, workspaceId, searchId);
    await db.prepare("UPDATE finder_searches SET status='Complete',progress=100,stage='Complete',found_count=?,hidden_found_count=?,coverage=?,search_state_json=NULL,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=? AND status='Running'").bind(accepted, hidden.size, coverage, searchId, workspaceId).run();
  } catch (error) {
    const total = await db.prepare('SELECT COUNT(*) total FROM finder_results WHERE search_id=? AND workspace_id=?').bind(searchId, workspaceId).first<{ total: number }>();
    const partial = Number(total?.total || 0);
    await rememberFoundPlaces(db, workspaceId, searchId);
    const message = error instanceof Error && /^(Business search|The business)/.test(error.message)
      ? error.message : finderPlacesErrorMessage(500);
    await db.prepare("UPDATE finder_searches SET status=?,progress=?,stage=?,found_count=?,retry_count=retry_count+1,error=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?")
      .bind(partial ? 'Partial' : 'Failed', partial ? 100 : 0, partial ? 'Partial results available' : 'Search failed', partial, message, searchId, workspaceId).run();
  }
}

export async function processFinderMessage(db: D1Database, message: FinderJobMessage, config: FinderRuntimeConfig, requeue?: (next: FinderJobMessage) => Promise<unknown>) {
  if (message.kind === 'search') return processFinderJob(db, message.workspaceId, message.searchId, config, requeue);
  return processFinderAiResult(db, message.workspaceId, message.searchId, message.resultId, config);
}

export async function finderAiUsage(db: D1Database, workspaceId: string, monthlyBudgetUsd = 2) {
  const row = await db.prepare(`SELECT COUNT(*) requests,COALESCE(SUM(prompt_tokens),0) prompt_tokens,COALESCE(SUM(output_tokens),0) output_tokens,COALESCE(SUM(actual_microusd),0) actual_microusd FROM finder_ai_usage WHERE workspace_id=? AND month=? AND status='committed'`).bind(workspaceId, currentMonth()).first<Record<string, unknown>>();
  return { requests: Number(row?.requests || 0), promptTokens: Number(row?.prompt_tokens || 0), outputTokens: Number(row?.output_tokens || 0), estimatedUsd: Number(row?.actual_microusd || 0) / 1_000_000, budgetUsd: monthlyBudgetUsd };
}
