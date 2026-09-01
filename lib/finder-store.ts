export type FinderStatus = 'Saved' | 'Queued' | 'Running' | 'Complete' | 'Partial' | 'Failed' | 'Cancelled';

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
  if (!website || !publicWebsite(website)) return { email: '', socialUrl: '' };
  try {
    const response = await fetch(website, {
      headers: { accept: 'text/html', 'user-agent': 'ScoutFinder/1.0 (+business-contact-discovery)' },
      redirect: 'follow', signal: AbortSignal.timeout(3500),
    });
    if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) return { email: '', socialUrl: '' };
    const html = (await response.text()).slice(0, 350_000);
    const email = decodeURIComponent(html.match(/mailto:([^?'"\s<>]+)/i)?.[1] || '').replace(/&amp;/gi, '&');
    const socialUrl = html.match(/https?:\/\/(?:www\.)?(?:linkedin\.com|facebook\.com|instagram\.com)\/[^'"\s<>]+/i)?.[0]?.replace(/&amp;/gi, '&') || '';
    return { email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '', socialUrl };
  } catch {
    return { email: '', socialUrl: '' };
  }
}

export function assessPlace(place: GooglePlace, evidence = { email: '', socialUrl: '' }) {
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

function matchesRequirements(result: Omit<FinderResultRecord, 'id' | 'searchId'>, requirements: string[]) {
  return requirements.every(requirement => requirement === 'Phone' ? Boolean(result.phone)
    : requirement === 'Website' ? Boolean(result.website)
      : requirement === 'Email' ? Boolean(result.email)
        : requirement === 'Social' ? Boolean(result.socialUrl) : true);
}

export async function processFinderJob(db: D1Database, workspaceId: string, searchId: string, apiKey?: string) {
  const jobRow = await db.prepare('SELECT * FROM finder_searches WHERE id=? AND workspace_id=?').bind(searchId, workspaceId).first<Record<string, unknown>>();
  if (!jobRow || String(jobRow.status) !== 'Queued') return;
  const job = mapFinderSearch(jobRow);
  const claim = await db.prepare("UPDATE finder_searches SET status='Running',progress=8,stage='Searching Google Places',error=NULL,started_at=COALESCE(started_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=? AND status='Queued'").bind(searchId, workspaceId).run();
  if (!claim.meta.changes) return;
  if (!apiKey) {
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
        headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': requestedFields.join(',') },
        body: JSON.stringify({ textQuery: `${job.industry} in ${job.location}`, pageSize: Math.min(20, job.targetCount - accepted), ...(pageToken ? { pageToken } : {}) }),
      });
      const data = await response.json() as GooglePlacesResponse;
      if (!response.ok) throw new Error(data.error?.message || `Google Places returned ${response.status}.`);
      const places = data.places || [];
      const shouldInspectWebsites = job.requirements.includes('Email') || job.requirements.includes('Social');
      const enriched = await Promise.all(places.map(async place => ({ place, evidence: shouldInspectWebsites ? await websiteEvidence(place.websiteUri || '') : { email: '', socialUrl: '' } })));
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
          rating: place.rating, reviewCount: place.userRatingCount, ...assessment, provenance, fetchedAt, verifiedAt: fetchedAt,
        };
      }).filter(result => result.name && result.sourceUrl && matchesRequirements(result, job.requirements)).slice(0, Math.max(0, job.targetCount - accepted));
      if (prepared.length) {
        await db.batch(prepared.map(result => db.prepare(`INSERT INTO finder_results (id,workspace_id,search_id,provider,provider_record_id,name,industry,address,city,phone,email,website,social_url,source_url,business_status,rating,review_count,score,score_reason,opportunity,provenance_json,fetched_at,verified_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(search_id,provider,provider_record_id) DO UPDATE SET name=excluded.name,industry=excluded.industry,address=excluded.address,city=excluded.city,phone=excluded.phone,email=excluded.email,website=excluded.website,social_url=excluded.social_url,source_url=excluded.source_url,business_status=excluded.business_status,rating=excluded.rating,review_count=excluded.review_count,score=excluded.score,score_reason=excluded.score_reason,opportunity=excluded.opportunity,provenance_json=excluded.provenance_json,fetched_at=excluded.fetched_at,verified_at=excluded.verified_at,updated_at=CURRENT_TIMESTAMP`)
          .bind(crypto.randomUUID(), workspaceId, searchId, result.provider, result.providerRecordId, result.name, result.industry, result.address, result.city, result.phone, result.email, result.website, result.socialUrl, result.sourceUrl, result.businessStatus || null, result.rating ?? null, result.reviewCount ?? null, result.score, result.scoreReason, result.opportunity, JSON.stringify(result.provenance), result.fetchedAt, result.verifiedAt)));
      }
      const total = await db.prepare('SELECT COUNT(*) total FROM finder_results WHERE search_id=? AND workspace_id=?').bind(searchId, workspaceId).first<{ total: number }>();
      accepted = Number(total?.total || 0);
      page += 1;
      const progress = Math.min(92, 20 + page * 24);
      await db.prepare("UPDATE finder_searches SET found_count=?,progress=?,stage='Verifying and saving results',updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?").bind(accepted, progress, searchId, workspaceId).run();
      pageToken = data.nextPageToken;
    } while (pageToken && accepted < job.targetCount && page < 3);
    await db.prepare("UPDATE finder_searches SET status='Complete',progress=100,stage='Complete',found_count=?,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?").bind(accepted, searchId, workspaceId).run();
  } catch (error) {
    const total = await db.prepare('SELECT COUNT(*) total FROM finder_results WHERE search_id=? AND workspace_id=?').bind(searchId, workspaceId).first<{ total: number }>();
    const found = Number(total?.total || 0);
    await db.prepare("UPDATE finder_searches SET status=?,progress=?,stage=?,found_count=?,retry_count=retry_count+1,error=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?")
      .bind(found ? 'Partial' : 'Failed', found ? 100 : 0, found ? 'Partial results available' : 'Search failed', found, error instanceof Error ? error.message.slice(0, 500) : 'Search failed.', searchId, workspaceId).run();
  }
}
