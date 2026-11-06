import { env, waitUntil } from 'cloudflare:workers';
import { DEFAULT_COUNTRY } from '@/lib/countries';
import { authenticateRequest, type ScoutSession } from '@/lib/auth';
import { mapFinderResult, mapFinderSearch, processFinderMessage, type FinderJobMessage } from '@/lib/finder-store';
import { finderRuntimeConfig, type FinderEnv } from '@/lib/finder-runtime';
import { publicFinderResult } from '@/lib/finder-public';
import { existingFinderLeads, findDuplicate, possibleDuplicates, importFinderResults } from '@/lib/finder-import';
import { saveFinderReview } from '@/lib/finder-review';
import { normalizedIdentity, normalizeFacebookPageUrl, salesOpportunity } from '@/lib/finder-sales';
import { assessPlace } from '@/lib/finder-store';
import { mapLead } from '@/lib/workspace-store';
import { guardFinderSearch, seesOnlyOwnRecords } from '@/lib/record-scope';
import { recordAudit } from '@/lib/audit';
import { allowRequest, tooManyRequests } from '@/lib/rate-limit';
import { finderAiRetrySchema, finderFacebookSchema, finderManualProspectSchema, finderImportSchema, finderSearchSchema, validationError } from '@/lib/validation';

export const dynamic = 'force-dynamic';

const runtimeEnv = () => env as unknown as FinderEnv;
const runtimeConfig = () => finderRuntimeConfig(runtimeEnv());

const ownName = (session: ScoutSession) => (seesOnlyOwnRecords(session) ? session.user.name : undefined);

async function dispatchFinderJob(db: D1Database, message: FinderJobMessage) {
  const queue = runtimeEnv().FINDER_QUEUE;
  if (queue) {
    try { await queue.send(message); return; } catch { /* Fall through to the local development path. */ }
  }
  waitUntil(processFinderMessage(db, message, runtimeConfig()));
}

async function finderPayload(db: D1Database, workspaceId: string, id: string, ownOnly?: string) {
  const [searchRow, resultRows] = await db.batch([
    db.prepare('SELECT * FROM finder_searches WHERE id=? AND workspace_id=?').bind(id, workspaceId),
    db.prepare('SELECT * FROM finder_results WHERE search_id=? AND workspace_id=? ORDER BY score DESC,name').bind(id, workspaceId),
  ]);
  const row = searchRow.results[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  const existing = await existingFinderLeads(db, workspaceId);
  const updatedLeads = await db.prepare(`SELECT l.* FROM leads l WHERE l.workspace_id=? AND l.id IN (SELECT imported_lead_id FROM finder_results WHERE search_id=? AND workspace_id=?)${ownOnly ? ' AND l.owner=?' : ''}`).bind(...(ownOnly ? [workspaceId, id, workspaceId, ownOnly] : [workspaceId, id, workspaceId])).all<Record<string,unknown>>();
  return { updatedLeads: updatedLeads.results.map(mapLead), search: mapFinderSearch(row), results: (resultRows.results as Record<string, unknown>[]).map(item => { const prospect = mapFinderResult(item); return { ...publicFinderResult(prospect), opportunity: salesOpportunity(prospect,mapFinderSearch(row).salesFocus), importedLeadId: prospect.importedLeadId || findDuplicate(prospect, existing)?.id, possibleDuplicates: possibleDuplicates(prospect, existing).map(lead => ({ id: lead.id, name: lead.name, city: lead.city, address: lead.address })) }; }) };
}

export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;
  const id = new URL(request.url).searchParams.get('id');
  if (id) {
    const hidden = await guardFinderSearch(auth, id);
    if (hidden) return hidden;
    await auth.db.batch([
      auth.db.prepare("UPDATE finder_results SET ai_status='failed',ai_error='AI assessment was interrupted and can be retried.',updated_at=CURRENT_TIMESTAMP WHERE search_id=? AND workspace_id=? AND ai_status='running' AND updated_at < datetime('now','-2 minutes')").bind(id, auth.session.workspace.id),
      auth.db.prepare("UPDATE finder_ai_usage SET status='failed',reserved_microusd=0,updated_at=CURRENT_TIMESTAMP WHERE search_id=? AND workspace_id=? AND status='reserved' AND updated_at < datetime('now','-2 minutes')").bind(id, auth.session.workspace.id),
    ]);
    const payload = await finderPayload(auth.db, auth.session.workspace.id, id, ownName(auth.session));
    if (!payload) return Response.json({ error: 'Finder search not found.' }, { status: 404 });
    if (payload.search.status === 'Running' && Date.now() - new Date(payload.search.updatedAt.replace(' ', 'T') + 'Z').getTime() > 90_000) {
      await auth.db.prepare("UPDATE finder_searches SET status='Queued',stage='Resuming',updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=? AND status='Running'").bind(id, auth.session.workspace.id).run();
      payload.search.status = 'Queued';
      payload.search.stage = 'Resuming';
    }
    if (payload.search.status === 'Queued' && auth.session.capabilities['finder:run']) await dispatchFinderJob(auth.db, { kind: 'search', workspaceId: auth.session.workspace.id, searchId: id });
    return Response.json(payload);
  }
  const own = seesOnlyOwnRecords(auth.session);
  const rows = await auth.db.prepare(`SELECT * FROM finder_searches WHERE workspace_id=?${own ? ' AND created_by=?' : ''} ORDER BY created_at DESC LIMIT 100`).bind(...(own ? [auth.session.workspace.id, auth.session.user.id] : [auth.session.workspace.id])).all<Record<string, unknown>>();
  return Response.json({ searches: rows.results.map(mapFinderSearch) });
}

async function importResults(request: Request, body: unknown) {
  const auth = await authenticateRequest(request, 'records:write'); if (!auth.ok) return auth.response;
  const parsed = finderImportSchema.safeParse(body); if (!parsed.success) return validationError(parsed.error);
  const hidden = await guardFinderSearch(auth, parsed.data.searchId); if (hidden) return hidden;
  try { const data = await importFinderResults(auth.db, auth.session.workspace.id, { ...auth.session.user, role: auth.session.role }, parsed.data); return Response.json(data, { status: 'status' in data ? data.status : 200 }); }
  catch (error) { console.error('Finder import failed', error); return Response.json({ error: 'Import could not finish. Refresh the results and retry; saved prospects will be skipped safely.' }, { status: 409 }); }
}

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: 'Invalid JSON body.' }, { status: 400 }); }
  if ((body as { action?: string })?.action === 'import') return importResults(request, body);
  const action = (body as { action?: string })?.action;
  const auth = await authenticateRequest(request, action === 'save' ? 'records:write' : action === 'facebook' || action === 'add-prospect' ? 'records:write' : 'finder:run');
  if (!auth.ok) return auth.response;
  const hidden = await guardFinderSearch(auth, (body as { searchId?: string })?.searchId);
  if (hidden) return hidden;
  if ((body as { action?: string })?.action === 'retry-ai') {
    const retry = finderAiRetrySchema.safeParse(body);
    if (!retry.success) return validationError(retry.error);
    const result = await auth.db.prepare("UPDATE finder_results SET ai_status='pending',ai_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND search_id=? AND workspace_id=? AND ai_status='failed'").bind(retry.data.resultId, retry.data.searchId, auth.session.workspace.id).run();
    if (!result.meta.changes) return Response.json({ error: 'Only failed AI assessments can be retried.' }, { status: 409 });
    await dispatchFinderJob(auth.db, { kind: 'ai', workspaceId: auth.session.workspace.id, searchId: retry.data.searchId, resultId: retry.data.resultId });
    return Response.json(await finderPayload(auth.db, auth.session.workspace.id, retry.data.searchId, ownName(auth.session)), { status: 202 });
  }
  if ((body as { action?: string })?.action === 'facebook') {
    const parsed = finderFacebookSchema.safeParse(body); if (!parsed.success) return validationError(parsed.error);
    const result = await saveFinderReview(auth.db, auth.session.workspace.id, auth.session.user.name, parsed.data);
    if ('error' in result) return Response.json(result, { status: result.status });
    await dispatchFinderJob(auth.db, { kind: 'ai', workspaceId: auth.session.workspace.id, searchId: parsed.data.searchId, resultId: parsed.data.resultId });
    const lead = await auth.db.prepare('SELECT l.* FROM leads l JOIN finder_results r ON r.imported_lead_id=l.id WHERE r.id=? AND r.workspace_id=? AND l.workspace_id=?').bind(parsed.data.resultId, auth.session.workspace.id, auth.session.workspace.id).first<Record<string, unknown>>();
    return Response.json({ ...await finderPayload(auth.db, auth.session.workspace.id, parsed.data.searchId, ownName(auth.session)), updatedLeads: lead ? [mapLead(lead)] : [] });
  }
  if ((body as { action?: string })?.action === 'add-prospect') {
    const parsed = finderManualProspectSchema.safeParse(body); if (!parsed.success) return validationError(parsed.error);
    const value = parsed.data;
    const searchRow = await auth.db.prepare('SELECT * FROM finder_searches WHERE id=? AND workspace_id=?').bind(value.searchId, auth.session.workspace.id).first<Record<string, unknown>>();
    if (!searchRow) return Response.json({ error: 'Search not found.' }, { status: 404 });
    const search = mapFinderSearch(searchRow); const facebook = normalizeFacebookPageUrl(value.facebookUrl);
    const identity = `${facebook}|${normalizedIdentity(value.name)}|${normalizedIdentity(value.city)}|${normalizedIdentity(value.address)}`;
    const already = await auth.db.prepare('SELECT id FROM finder_results WHERE search_id=? AND workspace_id=? AND provider=? AND provider_record_id=?').bind(search.id, auth.session.workspace.id, 'Sales review', identity).first();
    if (already) return Response.json({ error: 'This Facebook prospect is already in the search.' }, { status: 409 });
    const assessment = assessPlace({ websiteUri: value.website, internationalPhoneNumber: value.phone }, { email: value.email, socialUrl: facebook, summary: '' }, search.salesFocus);
    const id = crypto.randomUUID(); const now = new Date().toISOString();
    const provenance = [{ field: 'facebook', provider: 'Sales-submitted page', sourceUrl: facebook, retrievedAt: now }, { field: 'location', provider: 'Sales area review', sourceUrl: facebook, retrievedAt: now }];
    await auth.db.prepare(`INSERT INTO finder_results (id,workspace_id,search_id,provider,provider_record_id,name,industry,address,city,phone,email,website,social_url,source_url,score,score_reason,rule_score,rule_score_reason,opportunity,provenance_json,fetched_at,verified_at,facebook_status,ai_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'possible','pending')`).bind(id, auth.session.workspace.id, search.id, 'Sales review', identity, value.name, search.industry, value.address, value.city, value.phone, value.email, value.website, facebook, facebook, assessment.score, assessment.scoreReason, assessment.score, assessment.scoreReason, assessment.opportunity, JSON.stringify(provenance), now, now).run();
    await auth.db.prepare('UPDATE finder_searches SET found_count=(SELECT COUNT(*) FROM finder_results WHERE search_id=? AND workspace_id=?),updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?').bind(search.id, auth.session.workspace.id, search.id, auth.session.workspace.id).run();
    await dispatchFinderJob(auth.db, { kind: 'ai', workspaceId: auth.session.workspace.id, searchId: search.id, resultId: id });
    return Response.json({ ...await finderPayload(auth.db, auth.session.workspace.id, search.id, ownName(auth.session)), addedResultId: id }, { status: 201 });
  }
  if (action === 'run' && !await allowRequest(auth.db, `finder:${auth.session.user.id}`, 30, 3600)) return tooManyRequests(600);
  const parsed = finderSearchSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);
  const input = parsed.data;
  let id = input.searchId;
  if (id) {
    const existing = await auth.db.prepare('SELECT id FROM finder_searches WHERE id=? AND workspace_id=?').bind(id, auth.session.workspace.id).first<{ id: string }>();
    if (!existing) return Response.json({ error: 'Finder search not found.' }, { status: 404 });
    await auth.db.batch([
      auth.db.prepare("UPDATE finder_results SET ai_status=CASE WHEN imported_lead_id IS NULL THEN 'pending' ELSE ai_status END,ai_error=NULL,ai_input_hash=CASE WHEN imported_lead_id IS NULL THEN NULL ELSE ai_input_hash END,updated_at=CURRENT_TIMESTAMP WHERE search_id=? AND workspace_id=?").bind(id, auth.session.workspace.id),
      auth.db.prepare("UPDATE finder_searches SET status='Queued',progress=2,stage='Queued',error=NULL,started_at=NULL,completed_at=NULL,search_state_json=NULL,coverage=NULL,hidden_found_count=0,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?").bind(id, auth.session.workspace.id),
    ]);
  } else {
    id = crypto.randomUUID();
    const status = input.action === 'save' ? 'Saved' : 'Queued';
    const name = `${input.location} ${input.industry}`.trim();
    await auth.db.prepare(`INSERT INTO finder_searches (id,workspace_id,created_by,name,industry,industry_type,industry_psic_code,location,location_code,location_type,location_province,location_region,target_count,requirements_json,status,progress,stage,saved,map_area_json,map_bounds_json,sales_focus,requirement_mode,country)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id, auth.session.workspace.id, auth.session.user.id, name, input.industry, input.industryType || null, input.industryPsicCode || null, input.location, input.locationCode || null, input.locationType || null, input.locationProvince || null, input.locationRegion || null, input.targetCount, JSON.stringify((input.requirements || []).map(item => item === 'Social' ? 'Facebook' : item)), status, status === 'Queued' ? 2 : 0, status === 'Queued' ? 'Queued' : 'Ready', input.action === 'save' ? 1 : 0, input.area ? JSON.stringify(input.area) : null, input.bounds ? JSON.stringify(input.bounds) : null, input.salesFocus, input.requirementMode, input.country || DEFAULT_COUNTRY).run();
  }
  if (input.includeFound) await auth.db.prepare('UPDATE finder_searches SET include_found=1 WHERE id=? AND workspace_id=?').bind(id, auth.session.workspace.id).run();
  const payload = await finderPayload(auth.db, auth.session.workspace.id, id, ownName(auth.session));
  if (input.action === 'run') await dispatchFinderJob(auth.db, { kind: 'search', workspaceId: auth.session.workspace.id, searchId: id });
  return Response.json(payload, { status: input.action === 'run' ? 202 : 201 });
}

export async function PATCH(request: Request) {
  const auth = await authenticateRequest(request, 'records:write');
  if (!auth.ok) return auth.response;
  let body: { id?: string; action?: string; name?: string };
  try { body = await request.json() as typeof body; } catch { return Response.json({ error: 'Invalid JSON body.' }, { status: 400 }); }
  if (!body.id || !['cancel', 'save', 'unsave', 'rename'].includes(body.action || '')) return Response.json({ error: 'A valid Finder search action is required.' }, { status: 400 });
  const hidden = await guardFinderSearch(auth, body.id);
  if (hidden) return hidden;
  let result;
  if (body.action === 'cancel') {
    result = await auth.db.prepare("UPDATE finder_searches SET status='Cancelled',stage='Cancelled',updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=? AND status IN ('Queued','Running')").bind(body.id, auth.session.workspace.id).run();
    if (!result.meta.changes) return Response.json({ error: 'This search can no longer be cancelled.' }, { status: 409 });
  } else if (body.action === 'rename') {
    const name = body.name?.trim();
    if (!name || name.length < 2 || name.length > 160) return Response.json({ error: 'Search name must be between 2 and 160 characters.' }, { status: 422 });
    result = await auth.db.prepare('UPDATE finder_searches SET name=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?').bind(name, body.id, auth.session.workspace.id).run();
  } else {
    result = await auth.db.prepare('UPDATE finder_searches SET saved=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?').bind(body.action === 'save' ? 1 : 0, body.id, auth.session.workspace.id).run();
  }
  if (!result.meta.changes) return Response.json({ error: 'Finder search not found.' }, { status: 404 });
  return Response.json(await finderPayload(auth.db, auth.session.workspace.id, body.id, ownName(auth.session)));
}

export async function DELETE(request: Request) {
  const auth = await authenticateRequest(request, 'records:delete');
  if (!auth.ok) return auth.response;
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return Response.json({ error: 'Finder search ID is required.' }, { status: 400 });
  const hidden = await guardFinderSearch(auth, id);
  if (hidden) return hidden;
  const linked = await auth.db.prepare('SELECT COUNT(*) total FROM finder_results WHERE search_id=? AND workspace_id=? AND imported_lead_id IS NOT NULL').bind(id, auth.session.workspace.id).first<{ total: number }>();
  if (Number(linked?.total || 0)) return Response.json({ error: 'Searches with imported records are retained for provenance.' }, { status: 409 });
  await auth.db.batch([
    auth.db.prepare('DELETE FROM finder_results WHERE search_id=? AND workspace_id=?').bind(id, auth.session.workspace.id),
    auth.db.prepare('DELETE FROM finder_searches WHERE id=? AND workspace_id=?').bind(id, auth.session.workspace.id),
  ]);
  await recordAudit(auth, 'search.deleted', id);
  return Response.json({ deleted: id });
}
