import { env, waitUntil } from 'cloudflare:workers';
import { authenticateRequest } from '@/lib/auth';
import { finderAiUsage, mapFinderResult, mapFinderSearch, processFinderMessage, type FinderJobMessage } from '@/lib/finder-store';
import { finderRuntimeConfig, type FinderEnv } from '@/lib/finder-runtime';
import { syncLeadCoreCrm } from '@/lib/foundation-store';
import { mapLead } from '@/lib/workspace-store';
import { finderAiRetrySchema, finderImportSchema, finderSearchSchema, validationError } from '@/lib/validation';

export const dynamic = 'force-dynamic';

const runtimeEnv = () => env as unknown as FinderEnv;
const runtimeConfig = () => finderRuntimeConfig(runtimeEnv());

async function dispatchFinderJob(db: D1Database, message: FinderJobMessage) {
  const queue = runtimeEnv().FINDER_QUEUE;
  if (queue) {
    try { await queue.send(message); return; } catch { /* Fall through to the local development path. */ }
  }
  waitUntil(processFinderMessage(db, message, runtimeConfig()));
}

async function finderPayload(db: D1Database, workspaceId: string, id: string) {
  const [searchRow, resultRows] = await db.batch([
    db.prepare('SELECT * FROM finder_searches WHERE id=? AND workspace_id=?').bind(id, workspaceId),
    db.prepare('SELECT * FROM finder_results WHERE search_id=? AND workspace_id=? ORDER BY score DESC,name').bind(id, workspaceId),
  ]);
  const row = searchRow.results[0] as Record<string, unknown> | undefined;
  return row ? { search: mapFinderSearch(row), results: (resultRows.results as Record<string, unknown>[]).map(mapFinderResult), aiUsage: await finderAiUsage(db, workspaceId, runtimeConfig().aiMonthlyBudgetUsd) } : null;
}

export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;
  const id = new URL(request.url).searchParams.get('id');
  if (id) {
    await auth.db.batch([
      auth.db.prepare("UPDATE finder_results SET ai_status='failed',ai_error='AI assessment was interrupted and can be retried.',updated_at=CURRENT_TIMESTAMP WHERE search_id=? AND workspace_id=? AND ai_status='running' AND updated_at < datetime('now','-2 minutes')").bind(id, auth.session.workspace.id),
      auth.db.prepare("UPDATE finder_ai_usage SET status='failed',reserved_microusd=0,updated_at=CURRENT_TIMESTAMP WHERE search_id=? AND workspace_id=? AND status='reserved' AND updated_at < datetime('now','-2 minutes')").bind(id, auth.session.workspace.id),
    ]);
    const payload = await finderPayload(auth.db, auth.session.workspace.id, id);
    if (!payload) return Response.json({ error: 'Finder search not found.' }, { status: 404 });
    if (payload.search.status === 'Running' && Date.now() - new Date(payload.search.updatedAt.replace(' ', 'T') + 'Z').getTime() > 90_000) {
      await auth.db.prepare("UPDATE finder_searches SET status='Queued',stage='Resuming',updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=? AND status='Running'").bind(id, auth.session.workspace.id).run();
      payload.search.status = 'Queued';
      payload.search.stage = 'Resuming';
    }
    if (payload.search.status === 'Queued') await dispatchFinderJob(auth.db, { kind: 'search', workspaceId: auth.session.workspace.id, searchId: id });
    return Response.json(payload);
  }
  const rows = await auth.db.prepare('SELECT * FROM finder_searches WHERE workspace_id=? ORDER BY created_at DESC LIMIT 100').bind(auth.session.workspace.id).all<Record<string, unknown>>();
  return Response.json({ searches: rows.results.map(mapFinderSearch), aiUsage: await finderAiUsage(auth.db, auth.session.workspace.id, runtimeConfig().aiMonthlyBudgetUsd) });
}

async function importResults(request: Request, body: unknown) {
  const auth = await authenticateRequest(request, 'records:write');
  if (!auth.ok) return auth.response;
  const parsed = finderImportSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);
  const input = parsed.data;
  const requestedAssignees = input.assignmentMode === 'single' ? [input.ownerId!] : input.assignmentMode === 'round_robin' ? input.assigneeIds! : Object.values(input.manualAssignments!);
  const uniqueAssignees = [...new Set(requestedAssignees)];
  const memberPlaceholders = uniqueAssignees.map(() => '?').join(',');
  const memberRows = await auth.db.prepare(`SELECT u.id,u.name FROM workspace_memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? AND u.id IN (${memberPlaceholders}) AND u.status='active' AND m.role IN ('owner','admin','member')`)
    .bind(auth.session.workspace.id, ...uniqueAssignees).all<{ id: string; name: string }>();
  if (memberRows.results.length !== uniqueAssignees.length) return Response.json({ error: 'One or more selected assignees are not active workspace members.' }, { status: 422 });
  const memberById = new Map(memberRows.results.map(member => [member.id, member]));
  const placeholders = input.resultIds.map(() => '?').join(',');
  const resultRows = await auth.db.prepare(`SELECT * FROM finder_results WHERE workspace_id=? AND search_id=? AND id IN (${placeholders}) ORDER BY score DESC`)
    .bind(auth.session.workspace.id, input.searchId, ...input.resultIds).all<Record<string, unknown>>();
  if (!resultRows.results.length) return Response.json({ error: 'No importable Finder results were selected.' }, { status: 404 });
  let nextTaskId = Number((await auth.db.prepare('SELECT COALESCE(MAX(id),0)+1 next_id FROM tasks').first<{ next_id: number }>())?.next_id || 1);
  let nextActivityId = Number((await auth.db.prepare('SELECT COALESCE(MAX(id),0)+1 next_id FROM activities').first<{ next_id: number }>())?.next_id || 1);
  const imported: ReturnType<typeof mapLead>[] = [];
  const assignmentCounts = new Map<string, number>();
  for (const [resultIndex, row] of resultRows.results.entries()) {
    const result = mapFinderResult(row);
    const assigneeId = input.assignmentMode === 'single' ? input.ownerId! : input.assignmentMode === 'round_robin' ? input.assigneeIds![resultIndex % input.assigneeIds!.length] : input.manualAssignments![result.id];
    const owner = memberById.get(assigneeId)!.name;
    const duplicate = await auth.db.prepare('SELECT id FROM leads WHERE workspace_id=? AND lower(name)=lower(?) LIMIT 1').bind(auth.session.workspace.id, result.name).first<{ id: string }>();
    if (duplicate) {
      await auth.db.prepare('UPDATE finder_results SET imported_lead_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?').bind(duplicate.id, result.id, auth.session.workspace.id).run();
      continue;
    }
    let company = await auth.db.prepare('SELECT id FROM companies WHERE workspace_id=? AND lower(name)=lower(?) LIMIT 1').bind(auth.session.workspace.id, result.name).first<{ id: string }>();
    if (!company) {
      company = { id: crypto.randomUUID() };
      await auth.db.prepare('INSERT INTO companies (id,workspace_id,name,industry,city,phone,email,website,owner) VALUES (?,?,?,?,?,?,?,?,?)')
        .bind(company.id, auth.session.workspace.id, result.name, result.industry, result.city, result.phone, result.email, result.website || null, owner).run();
    }
    let contactId: string | null = null;
    if (result.phone || result.email) {
      contactId = crypto.randomUUID();
      await auth.db.prepare('INSERT INTO contacts (id,workspace_id,company_id,name,email,phone,is_primary) VALUES (?,?,?,?,?,?,1)')
        .bind(contactId, auth.session.workspace.id, company.id, 'Public business contact', result.email, result.phone).run();
    }
    const leadId = crypto.randomUUID();
    const next = `Initial follow-up · ${input.followUpDate}`;
    await auth.db.prepare(`INSERT INTO leads (id,workspace_id,company_id,primary_contact_id,version,name,industry,city,status,score,owner,last,next,phone,email,contact,priority,opportunity,archived,created_at,updated_at)
      VALUES (?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`)
      .bind(leadId, auth.session.workspace.id, company.id, contactId, result.name, result.industry, result.city, input.status, result.score, owner, 'Imported from Finder', next, result.phone, result.email, contactId ? 'Public business contact' : '', input.priority, result.opportunity).run();
    await syncLeadCoreCrm(auth.db, auth.session.workspace.id, leadId);
    const opportunity = await auth.db.prepare('SELECT id FROM opportunities WHERE workspace_id=? AND lead_id=? LIMIT 1').bind(auth.session.workspace.id, leadId).first<{ id: string }>();
    if (opportunity && ['complete', 'cached'].includes(result.aiStatus)) {
      const assessment = { classification: result.aiClassification, icpMatch: result.aiIcpMatch, fitScore: result.aiScore, confidence: result.aiConfidence, explanation: result.aiExplanation, opportunitySignals: result.aiOpportunitySignals, concerns: result.aiConcerns, recommendedNextAction: result.aiRecommendedAction, evidenceReferences: result.aiEvidenceReferences, model: result.aiModel, analyzedAt: result.aiAnalyzedAt };
      await auth.db.prepare(`INSERT INTO opportunity_finder_assessments (id,workspace_id,opportunity_id,finder_result_id,assessment_json,provenance_json) VALUES (?,?,?,?,?,?)
        ON CONFLICT(finder_result_id) DO UPDATE SET opportunity_id=excluded.opportunity_id,assessment_json=excluded.assessment_json,provenance_json=excluded.provenance_json,updated_at=CURRENT_TIMESTAMP`)
        .bind(crypto.randomUUID(), auth.session.workspace.id, opportunity.id, result.id, JSON.stringify(assessment), JSON.stringify(result.provenance)).run();
    }
    await auth.db.prepare(`INSERT INTO tasks (uid,workspace_id,id,title,lead,lead_id,company_id,contact_id,owner,priority,due,due_at,time,type,notes,status,reminder,recurrence,version,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`)
      .bind(crypto.randomUUID(), auth.session.workspace.id, nextTaskId++, 'Initial follow-up', result.name, leadId, company.id, contactId, owner, input.priority, input.followUpDate, input.followUpDate, '09:00', 'Call', `Imported from ${result.provider}.`, 'Scheduled', '15 minutes before', 'None').run();
    await auth.db.prepare(`INSERT INTO activities (uid,workspace_id,id,lead,lead_id,company_id,contact_id,type,detail,time,owner,status,occurred_at,outcome,version,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`)
      .bind(crypto.randomUUID(), auth.session.workspace.id, nextActivityId++, result.name, leadId, company.id, contactId, 'Finder import', `Imported from ${result.provider} · ${result.sourceUrl}`, 'Just now', owner, 'Completed', new Date().toISOString(), 'Imported').run();
    await auth.db.prepare('UPDATE finder_results SET imported_lead_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?').bind(leadId, result.id, auth.session.workspace.id).run();
    const saved = await auth.db.prepare('SELECT * FROM leads WHERE id=? AND workspace_id=?').bind(leadId, auth.session.workspace.id).first<Record<string, unknown>>();
    if (saved) { imported.push(mapLead(saved)); assignmentCounts.set(assigneeId, (assignmentCounts.get(assigneeId) || 0) + 1); }
  }
  const count = await auth.db.prepare('SELECT COUNT(*) total FROM finder_results WHERE search_id=? AND workspace_id=? AND imported_lead_id IS NOT NULL').bind(input.searchId, auth.session.workspace.id).first<{ total: number }>();
  await auth.db.prepare('UPDATE finder_searches SET imported_count=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?').bind(Number(count?.total || 0), input.searchId, auth.session.workspace.id).run();
  return Response.json({ imported, skipped: resultRows.results.length - imported.length, assignments: [...assignmentCounts].map(([userId, count]) => ({ userId, name: memberById.get(userId)?.name, count })) });
}

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: 'Invalid JSON body.' }, { status: 400 }); }
  if ((body as { action?: string })?.action === 'import') return importResults(request, body);
  const auth = await authenticateRequest(request, 'records:write');
  if (!auth.ok) return auth.response;
  if ((body as { action?: string })?.action === 'retry-ai') {
    const retry = finderAiRetrySchema.safeParse(body);
    if (!retry.success) return validationError(retry.error);
    const result = await auth.db.prepare("UPDATE finder_results SET ai_status='pending',ai_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND search_id=? AND workspace_id=? AND ai_status='failed'").bind(retry.data.resultId, retry.data.searchId, auth.session.workspace.id).run();
    if (!result.meta.changes) return Response.json({ error: 'Only failed AI assessments can be retried.' }, { status: 409 });
    await auth.db.prepare("DELETE FROM finder_ai_usage WHERE result_id=? AND workspace_id=? AND status='failed'").bind(retry.data.resultId, auth.session.workspace.id).run();
    await dispatchFinderJob(auth.db, { kind: 'ai', workspaceId: auth.session.workspace.id, searchId: retry.data.searchId, resultId: retry.data.resultId });
    return Response.json(await finderPayload(auth.db, auth.session.workspace.id, retry.data.searchId), { status: 202 });
  }
  const parsed = finderSearchSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);
  const input = parsed.data;
  let id = input.searchId;
  if (id) {
    const existing = await auth.db.prepare('SELECT id FROM finder_searches WHERE id=? AND workspace_id=?').bind(id, auth.session.workspace.id).first<{ id: string }>();
    if (!existing) return Response.json({ error: 'Finder search not found.' }, { status: 404 });
    await auth.db.batch([
      auth.db.prepare("UPDATE finder_results SET ai_status=CASE WHEN imported_lead_id IS NULL THEN 'pending' ELSE ai_status END,ai_error=NULL,ai_input_hash=CASE WHEN imported_lead_id IS NULL THEN NULL ELSE ai_input_hash END,updated_at=CURRENT_TIMESTAMP WHERE search_id=? AND workspace_id=?").bind(id, auth.session.workspace.id),
      auth.db.prepare("UPDATE finder_searches SET status='Queued',progress=2,stage='Queued',error=NULL,started_at=NULL,completed_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?").bind(id, auth.session.workspace.id),
    ]);
  } else {
    id = crypto.randomUUID();
    const status = input.action === 'save' ? 'Saved' : 'Queued';
    const name = `${input.location} ${input.industry}`.trim();
    await auth.db.prepare(`INSERT INTO finder_searches (id,workspace_id,created_by,name,industry,location,target_count,requirements_json,status,progress,stage,saved)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id, auth.session.workspace.id, auth.session.user.id, name, input.industry, input.location, input.targetCount, JSON.stringify(input.requirements || []), status, status === 'Queued' ? 2 : 0, status === 'Queued' ? 'Queued' : 'Ready', input.action === 'save' ? 1 : 0).run();
  }
  const payload = await finderPayload(auth.db, auth.session.workspace.id, id);
  if (input.action === 'run') await dispatchFinderJob(auth.db, { kind: 'search', workspaceId: auth.session.workspace.id, searchId: id });
  return Response.json(payload, { status: input.action === 'run' ? 202 : 201 });
}

export async function PATCH(request: Request) {
  const auth = await authenticateRequest(request, 'records:write');
  if (!auth.ok) return auth.response;
  let body: { id?: string; action?: string; name?: string };
  try { body = await request.json() as typeof body; } catch { return Response.json({ error: 'Invalid JSON body.' }, { status: 400 }); }
  if (!body.id || !['cancel', 'save', 'unsave', 'rename'].includes(body.action || '')) return Response.json({ error: 'A valid Finder search action is required.' }, { status: 400 });
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
  return Response.json(await finderPayload(auth.db, auth.session.workspace.id, body.id));
}

export async function DELETE(request: Request) {
  const auth = await authenticateRequest(request, 'records:write');
  if (!auth.ok) return auth.response;
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return Response.json({ error: 'Finder search ID is required.' }, { status: 400 });
  const linked = await auth.db.prepare('SELECT COUNT(*) total FROM finder_results WHERE search_id=? AND workspace_id=? AND imported_lead_id IS NOT NULL').bind(id, auth.session.workspace.id).first<{ total: number }>();
  if (Number(linked?.total || 0)) return Response.json({ error: 'Searches with imported records are retained for provenance.' }, { status: 409 });
  await auth.db.batch([
    auth.db.prepare('DELETE FROM finder_results WHERE search_id=? AND workspace_id=?').bind(id, auth.session.workspace.id),
    auth.db.prepare('DELETE FROM finder_searches WHERE id=? AND workspace_id=?').bind(id, auth.session.workspace.id),
  ]);
  return Response.json({ deleted: id });
}
