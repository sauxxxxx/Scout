import { calibrateAssessment, createGeminiProvider, finderAiInputHash, geminiCostMicroUsd, parseAssessment, type FinderAiAssessment, type FinderAiInput, type FinderAiStatus } from '@/lib/finder-ai';

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
  id: string;
  name: string;
  industry: string;
  location: string;
  targetCount: number;
  requirements: string[];
  provider: string;
  status: FinderStatus;
  progress: number;
  stage: string;
  foundCount: number;
  importedCount: number;
  saved: boolean;
  retryCount: number;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type FinderResultRecord = {
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
    id: String(row.id), name: String(row.name), industry: String(row.industry), location: String(row.location),
    targetCount: Number(row.target_count), requirements: parseArray(row.requirements_json).map(String), provider: String(row.provider),
    status: String(row.status) as FinderStatus, progress: Number(row.progress), stage: String(row.stage), foundCount: Number(row.found_count),
    importedCount: Number(row.imported_count), saved: Boolean(row.saved), retryCount: Number(row.retry_count),
    error: row.error ? String(row.error) : undefined, startedAt: row.started_at ? String(row.started_at) : undefined,
    completedAt: row.completed_at ? String(row.completed_at) : undefined, createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

export function mapFinderResult(row: Record<string, unknown>): FinderResultRecord {
  return {
    id: String(row.id), searchId: String(row.search_id), provider: String(row.provider), providerRecordId: String(row.provider_record_id),
    name: String(row.name), industry: String(row.industry), address: String(row.address), city: String(row.city), phone: String(row.phone),
    email: String(row.email), website: String(row.website), socialUrl: String(row.social_url), sourceUrl: String(row.source_url),
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

async function websiteEvidence(website: string) {
  if (!website || !publicWebsite(website)) return { email: '', socialUrl: '', summary: '' };
  try {
    const response = await fetch(website, {
      headers: { accept: 'text/html', 'user-agent': 'ScoutFinder/1.0 (+business-contact-discovery)' },
      redirect: 'follow', signal: AbortSignal.timeout(3500),
    });
    if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) return { email: '', socialUrl: '', summary: '' };
    const html = (await response.text()).slice(0, 350_000);
    const email = decodeURIComponent(html.match(/mailto:([^?'"\s<>]+)/i)?.[1] || '').replace(/&amp;/gi, '&');
    const socialUrl = html.match(/https?:\/\/(?:www\.)?(?:linkedin\.com|facebook\.com|instagram\.com)\/[^'"\s<>]+/i)?.[0]?.replace(/&amp;/gi, '&') || '';
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '';
    const description = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i)?.[1] || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i)?.[1] || '';
    const visible = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&(?:nbsp|amp|quot|#39);/gi, ' ').replace(/\s+/g, ' ').trim();
    const summary = [title, description, visible].filter(Boolean).join(' · ').slice(0, 2400);
    return { email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '', socialUrl, summary };
  } catch {
    return { email: '', socialUrl: '', summary: '' };
  }
}

export function assessPlace(place: GooglePlace, evidence = { email: '', socialUrl: '', summary: '' }) {
  const website = place.websiteUri || '';
  const phone = place.internationalPhoneNumber || place.nationalPhoneNumber || '';
  let score = 54;
  const reasons: string[] = [];
  if (place.businessStatus === 'OPERATIONAL') { score += 6; reasons.push('currently operational'); }
  if (phone) { score += 8; reasons.push('published business phone'); }
  if (website) { score += 6; reasons.push('website available'); } else { score += 20; reasons.push('no website found'); }
  if (evidence.email) { score += 6; reasons.push('public email found'); }
  if ((place.rating || 0) >= 4.4) { score += 4; reasons.push('strong customer rating'); }
  if ((place.userRatingCount || 0) >= 25) score += 3;
  const opportunity = !website ? 'Website launch' : (place.userRatingCount || 0) < 20 ? 'Local visibility' : 'Conversion review';
  return { score: Math.min(98, score), scoreReason: reasons.length ? reasons.join(', ') : 'Public business listing matched the search', opportunity };
}

function matchesRequirements(result: { phone: string; website: string; email: string; socialUrl: string }, requirements: string[]) {
  return requirements.every(requirement => requirement === 'Phone' ? Boolean(result.phone)
    : requirement === 'Website' ? Boolean(result.website)
      : requirement === 'Email' ? Boolean(result.email)
        : requirement === 'Social' ? Boolean(result.socialUrl) : true);
}

const currentMonth = () => new Date().toISOString().slice(0, 7);
const budgetMicroUsd = (config: FinderRuntimeConfig) => Math.max(0, Math.round((config.aiMonthlyBudgetUsd ?? 2) * 1_000_000));
const reservationMicroUsd = 5_000;

function aiInput(result: FinderResultRecord, search: FinderSearchRecord): FinderAiInput {
  return {
    name: result.name, industry: result.industry, location: result.city, address: result.address, phone: result.phone,
    email: result.email, website: result.website, socialUrl: result.socialUrl, businessStatus: result.businessStatus,
    rating: result.rating, reviewCount: result.reviewCount, websiteSummary: result.websiteSummary,
    searchIndustry: search.industry, searchLocation: search.location, ruleScore: result.ruleScore, ruleReason: result.ruleScoreReason,
    evidence: result.provenance.map((item, index) => ({ id: `evidence-${index + 1}`, field: item.field, provider: item.provider, sourceUrl: item.sourceUrl })),
  };
}

async function applyAssessment(db: D1Database, workspaceId: string, resultId: string, assessment: FinderAiAssessment, model: string, status: 'complete' | 'cached', inputHash: string, promptTokens: number, outputTokens: number, cost: number) {
  await db.prepare(`UPDATE finder_results SET score=?,score_reason=?,ai_status=?,ai_model=?,ai_classification=?,ai_icp_match=?,ai_score=?,ai_confidence=?,ai_explanation=?,ai_opportunity_signals_json=?,ai_concerns_json=?,ai_recommended_action=?,ai_evidence_refs_json=?,ai_input_hash=?,ai_prompt_tokens=?,ai_output_tokens=?,ai_estimated_cost_microusd=?,ai_error=NULL,ai_analyzed_at=CURRENT_TIMESTAMP,ai_attempts=ai_attempts+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?`)
    .bind(assessment.fitScore, assessment.explanation, status, model, assessment.classification, assessment.icpMatch, assessment.fitScore, assessment.confidence, assessment.explanation, JSON.stringify(assessment.opportunitySignals), JSON.stringify(assessment.concerns), assessment.recommendedNextAction, JSON.stringify(assessment.evidenceReferences), inputHash, promptTokens, outputTokens, cost, resultId, workspaceId).run();
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
    await applyAssessment(db, workspaceId, resultId, calibrateAssessment(input, cachedAssessment), model, 'cached', inputHash, Number(cached.prompt_tokens || 0), Number(cached.output_tokens || 0), 0);
    return;
  }
  const provider = createGeminiProvider(config.geminiApiKey, model);
  if (!provider) {
    await db.prepare("UPDATE finder_results SET ai_status='skipped',ai_model=?,ai_error='Gemini API key is not configured; rule-based assessment is active.',ai_input_hash=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=? AND ai_status NOT IN ('complete','cached')").bind(model, inputHash, resultId, workspaceId).run();
    return;
  }
  const claim = await db.prepare("UPDATE finder_results SET ai_status='running',ai_model=?,ai_input_hash=?,ai_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=? AND ai_status IN ('pending','failed')").bind(model, inputHash, resultId, workspaceId).run();
  if (!claim.meta.changes) return;
  const requestId = `${workspaceId}:${resultId}:${inputHash}:${model}`;
  const reservation = await db.prepare(`INSERT INTO finder_ai_usage (id,workspace_id,month,search_id,result_id,input_hash,model,request_id,status,reserved_microusd)
    SELECT ?,?,?,?,?,?,?,?,'reserved',? WHERE COALESCE((SELECT SUM(CASE WHEN status='committed' THEN actual_microusd WHEN status='reserved' THEN reserved_microusd ELSE 0 END) FROM finder_ai_usage WHERE workspace_id=? AND month=?),0)+?<=?
    ON CONFLICT(request_id) DO NOTHING`).bind(crypto.randomUUID(), workspaceId, currentMonth(), searchId, resultId, inputHash, model, requestId, reservationMicroUsd, workspaceId, currentMonth(), reservationMicroUsd, budgetMicroUsd(config)).run();
  if (!reservation.meta.changes) {
    const prior = await db.prepare('SELECT status FROM finder_ai_usage WHERE request_id=?').bind(requestId).first<{ status: string }>();
    if (!prior) await db.prepare("UPDATE finder_results SET ai_status='budget_limited',ai_model=?,ai_error='Monthly AI budget reached; rule-based assessment is active.',ai_input_hash=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?").bind(model, inputHash, resultId, workspaceId).run();
    else await db.prepare("UPDATE finder_results SET ai_status='failed',ai_error='A prior AI request is already recorded. Retry after reviewing its status.',updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=? AND ai_status='running'").bind(resultId, workspaceId).run();
    return;
  }
  try {
    const response = await provider.assess(input); const cost = geminiCostMicroUsd(response.promptTokens, response.outputTokens);
    const assessment = calibrateAssessment(input, response.assessment);
    await db.prepare(`INSERT INTO finder_ai_cache (workspace_id,input_hash,model,assessment_json,prompt_tokens,output_tokens,estimated_cost_microusd) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(workspace_id,input_hash,model) DO UPDATE SET assessment_json=excluded.assessment_json,prompt_tokens=excluded.prompt_tokens,output_tokens=excluded.output_tokens,estimated_cost_microusd=excluded.estimated_cost_microusd,updated_at=CURRENT_TIMESTAMP`)
      .bind(workspaceId, inputHash, model, JSON.stringify(response.assessment), response.promptTokens, response.outputTokens, cost).run();
    await applyAssessment(db, workspaceId, resultId, assessment, model, 'complete', inputHash, response.promptTokens, response.outputTokens, cost);
    await db.prepare("UPDATE finder_ai_usage SET status='committed',actual_microusd=?,prompt_tokens=?,output_tokens=?,updated_at=CURRENT_TIMESTAMP WHERE request_id=? AND status='reserved'").bind(cost, response.promptTokens, response.outputTokens, requestId).run();
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 400) : 'AI assessment failed.';
    await db.batch([
      db.prepare("UPDATE finder_results SET ai_status='failed',ai_model=?,ai_error=?,ai_input_hash=?,ai_attempts=ai_attempts+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?").bind(model, message, inputHash, resultId, workspaceId),
      db.prepare("UPDATE finder_ai_usage SET status='failed',reserved_microusd=0,updated_at=CURRENT_TIMESTAMP WHERE request_id=? AND status='reserved'").bind(requestId),
    ]);
  }
}

async function processFinderAiSearch(db: D1Database, workspaceId: string, searchId: string, config: FinderRuntimeConfig) {
  const maxCandidates = Math.max(0, Math.min(60, Math.floor(config.aiMaxCandidates ?? 20)));
  await db.prepare("UPDATE finder_searches SET progress=82,stage='Applying initial filters',updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=? AND status='Running'").bind(searchId, workspaceId).run();
  const rows = await db.prepare("SELECT id FROM finder_results WHERE search_id=? AND workspace_id=? AND imported_lead_id IS NULL AND ai_status IN ('pending','failed') ORDER BY rule_score DESC,name LIMIT ?").bind(searchId, workspaceId, maxCandidates).all<{ id: string }>();
  await db.prepare("UPDATE finder_results SET ai_status='skipped',ai_error='Not selected for AI assessment; rule-based score is active.',updated_at=CURRENT_TIMESTAMP WHERE search_id=? AND workspace_id=? AND ai_status='pending' AND id NOT IN (SELECT id FROM finder_results WHERE search_id=? AND workspace_id=? ORDER BY rule_score DESC,name LIMIT ?)").bind(searchId, workspaceId, searchId, workspaceId, maxCandidates).run();
  await db.prepare("UPDATE finder_searches SET progress=88,stage='Analyzing best matches',updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=? AND status='Running'").bind(searchId, workspaceId).run();
  for (const row of rows.results) {
    const status = await db.prepare('SELECT status FROM finder_searches WHERE id=? AND workspace_id=?').bind(searchId, workspaceId).first<{ status: string }>();
    if (status?.status === 'Cancelled') return;
    await processFinderAiResult(db, workspaceId, searchId, row.id, config);
  }
}

export async function processFinderJob(db: D1Database, workspaceId: string, searchId: string, configOrKey: FinderRuntimeConfig | string = {}) {
  const config: FinderRuntimeConfig = typeof configOrKey === 'string' ? { googlePlacesApiKey: configOrKey } : configOrKey;
  const jobRow = await db.prepare('SELECT * FROM finder_searches WHERE id=? AND workspace_id=?').bind(searchId, workspaceId).first<Record<string, unknown>>();
  if (!jobRow || String(jobRow.status) !== 'Queued') return;
  const job = mapFinderSearch(jobRow);
  const claim = await db.prepare("UPDATE finder_searches SET status='Running',progress=8,stage='Searching Google Places',error=NULL,started_at=COALESCE(started_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=? AND status='Queued'").bind(searchId, workspaceId).run();
  if (!claim.meta.changes) return;
  if (!config.googlePlacesApiKey) {
    await db.prepare("UPDATE finder_searches SET status='Failed',stage='Connection required',error='Google Places API key is not configured.',updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?").bind(searchId, workspaceId).run();
    return;
  }
  const requestedFields = ['places.id', 'places.displayName', 'places.formattedAddress', 'places.addressComponents', 'places.googleMapsUri', 'places.primaryTypeDisplayName', 'places.businessStatus', 'places.rating', 'places.userRatingCount', 'nextPageToken'];
  if (job.requirements.includes('Phone')) requestedFields.push('places.internationalPhoneNumber', 'places.nationalPhoneNumber');
  if (job.requirements.some(value => ['Website', 'Email', 'Social'].includes(value))) requestedFields.push('places.websiteUri');
  let pageToken: string | undefined;
  let accepted = 0;
  let page = 0;
  try {
    do {
      const current = await db.prepare('SELECT status FROM finder_searches WHERE id=? AND workspace_id=?').bind(searchId, workspaceId).first<{ status: string }>();
      if (current?.status === 'Cancelled') return;
      const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': config.googlePlacesApiKey, 'X-Goog-FieldMask': requestedFields.join(',') },
        body: JSON.stringify({ textQuery: `${job.industry} in ${job.location}`, pageSize: Math.min(20, job.targetCount - accepted), ...(pageToken ? { pageToken } : {}) }),
      });
      const data = await response.json() as GooglePlacesResponse;
      if (!response.ok) throw new Error(data.error?.message || `Google Places returned ${response.status}.`);
      const places = data.places || [];
      const shouldInspectWebsites = job.requirements.includes('Email') || job.requirements.includes('Social');
      const enriched = await Promise.all(places.map(async place => ({ place, evidence: shouldInspectWebsites || Boolean(place.websiteUri) ? await websiteEvidence(place.websiteUri || '') : { email: '', socialUrl: '', summary: '' } })));
      const fetchedAt = new Date().toISOString();
      const prepared = enriched.map(({ place, evidence }) => {
        const name = place.displayName?.text?.trim() || '';
        const sourceUrl = place.googleMapsUri || '';
        const website = place.websiteUri || '';
        const phone = place.internationalPhoneNumber || place.nationalPhoneNumber || '';
        const assessment = assessPlace(place, evidence);
        const provenance: FinderResultRecord['provenance'] = [
          { field: 'business', provider: 'Google Places', sourceUrl, retrievedAt: fetchedAt },
          ...(phone ? [{ field: 'phone', provider: 'Google Places', sourceUrl, retrievedAt: fetchedAt }] : []),
          ...(website ? [{ field: 'website', provider: 'Google Places', sourceUrl, retrievedAt: fetchedAt }] : []),
          ...(evidence.email ? [{ field: 'email', provider: 'Company website', sourceUrl: website, retrievedAt: fetchedAt }] : []),
          ...(evidence.socialUrl ? [{ field: 'social', provider: 'Company website', sourceUrl: website, retrievedAt: fetchedAt }] : []),
        ];
        return {
          provider: 'Google Places', providerRecordId: place.id || crypto.randomUUID(), name,
          industry: place.primaryTypeDisplayName?.text || job.industry, address: place.formattedAddress || '', city: cityFromPlace(place, job.location),
          phone, email: evidence.email, website, socialUrl: evidence.socialUrl, sourceUrl, businessStatus: place.businessStatus,
          rating: place.rating, reviewCount: place.userRatingCount, ...assessment, websiteSummary: evidence.summary, provenance, fetchedAt, verifiedAt: fetchedAt,
        };
      }).filter(result => result.name && result.sourceUrl && matchesRequirements(result, job.requirements)).slice(0, Math.max(0, job.targetCount - accepted));
      if (prepared.length) {
        await db.batch(prepared.map(result => db.prepare(`INSERT INTO finder_results (id,workspace_id,search_id,provider,provider_record_id,name,industry,address,city,phone,email,website,social_url,source_url,business_status,rating,review_count,score,score_reason,opportunity,provenance_json,website_summary,rule_score,rule_score_reason,ai_status,fetched_at,verified_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?) ON CONFLICT(search_id,provider,provider_record_id) DO UPDATE SET name=excluded.name,industry=excluded.industry,address=excluded.address,city=excluded.city,phone=excluded.phone,email=excluded.email,website=excluded.website,social_url=excluded.social_url,source_url=excluded.source_url,business_status=excluded.business_status,rating=excluded.rating,review_count=excluded.review_count,score=excluded.score,score_reason=excluded.score_reason,opportunity=excluded.opportunity,provenance_json=excluded.provenance_json,website_summary=excluded.website_summary,rule_score=excluded.rule_score,rule_score_reason=excluded.rule_score_reason,ai_status=CASE WHEN finder_results.ai_input_hash IS NULL THEN 'pending' ELSE finder_results.ai_status END,fetched_at=excluded.fetched_at,verified_at=excluded.verified_at,updated_at=CURRENT_TIMESTAMP`)
          .bind(crypto.randomUUID(), workspaceId, searchId, result.provider, result.providerRecordId, result.name, result.industry, result.address, result.city, result.phone, result.email, result.website, result.socialUrl, result.sourceUrl, result.businessStatus || null, result.rating ?? null, result.reviewCount ?? null, result.score, result.scoreReason, result.opportunity, JSON.stringify(result.provenance), result.websiteSummary, result.score, result.scoreReason, result.fetchedAt, result.verifiedAt)));
      }
      const total = await db.prepare('SELECT COUNT(*) total FROM finder_results WHERE search_id=? AND workspace_id=?').bind(searchId, workspaceId).first<{ total: number }>();
      accepted = Number(total?.total || 0);
      page += 1;
      const progress = Math.min(92, 20 + page * 24);
      await db.prepare("UPDATE finder_searches SET found_count=?,progress=?,stage='Verifying and saving results',updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?").bind(accepted, progress, searchId, workspaceId).run();
      pageToken = data.nextPageToken;
    } while (pageToken && accepted < job.targetCount && page < 3);
    await processFinderAiSearch(db, workspaceId, searchId, config);
    await db.prepare("UPDATE finder_searches SET status='Complete',progress=100,stage='Complete',found_count=?,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=? AND status='Running'").bind(accepted, searchId, workspaceId).run();
  } catch (error) {
    const total = await db.prepare('SELECT COUNT(*) total FROM finder_results WHERE search_id=? AND workspace_id=?').bind(searchId, workspaceId).first<{ total: number }>();
    const found = Number(total?.total || 0);
    await db.prepare("UPDATE finder_searches SET status=?,progress=?,stage=?,found_count=?,retry_count=retry_count+1,error=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?")
      .bind(found ? 'Partial' : 'Failed', found ? 100 : 0, found ? 'Partial results available' : 'Search failed', found, error instanceof Error ? error.message.slice(0, 500) : 'Search failed.', searchId, workspaceId).run();
  }
}

export async function processFinderMessage(db: D1Database, message: FinderJobMessage, config: FinderRuntimeConfig) {
  if (message.kind === 'search') return processFinderJob(db, message.workspaceId, message.searchId, config);
  return processFinderAiResult(db, message.workspaceId, message.searchId, message.resultId, config);
}

export async function finderAiUsage(db: D1Database, workspaceId: string, monthlyBudgetUsd = 2) {
  const row = await db.prepare(`SELECT COUNT(*) requests,COALESCE(SUM(prompt_tokens),0) prompt_tokens,COALESCE(SUM(output_tokens),0) output_tokens,COALESCE(SUM(actual_microusd),0) actual_microusd FROM finder_ai_usage WHERE workspace_id=? AND month=? AND status='committed'`).bind(workspaceId, currentMonth()).first<Record<string, unknown>>();
  return { requests: Number(row?.requests || 0), promptTokens: Number(row?.prompt_tokens || 0), outputTokens: Number(row?.output_tokens || 0), estimatedUsd: Number(row?.actual_microusd || 0) / 1_000_000, budgetUsd: monthlyBudgetUsd };
}
