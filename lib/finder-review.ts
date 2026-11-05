import { assessPlace, mapFinderResult, mapFinderSearch } from '@/lib/finder-store';
import { normalizeFacebookPageUrl, outreachPlan, readFacebookResearch, readiness, type FacebookResearch } from '@/lib/finder-sales';
import { existingFinderLeads, findDuplicate } from '@/lib/finder-import';
import { finderFacebookSchema } from '@/lib/validation';

export async function saveFinderReview(db: D1Database, workspaceId: string, reviewer: string, input: ReturnType<typeof finderFacebookSchema.parse>) {
  const row = await db.prepare('SELECT * FROM finder_results WHERE id=? AND search_id=? AND workspace_id=?').bind(input.resultId, input.searchId, workspaceId).first<Record<string, unknown>>();
  const searchRow = await db.prepare('SELECT * FROM finder_searches WHERE id=? AND workspace_id=?').bind(input.searchId, workspaceId).first<Record<string, unknown>>();
  if (!row || !searchRow) return { error: 'Business not found.', status: 404 };
  const current = mapFinderResult(row), search = mapFinderSearch(searchRow);
  if (input.reviewVersion !== undefined && input.reviewVersion !== current.reviewVersion) return { error: 'This review changed elsewhere. Reopen the business and try again.', status: 409 };
  const facebookUrl = input.status === 'not_found' ? '' : normalizeFacebookPageUrl(input.facebookUrl);
  current.importedLeadId ||= findDuplicate(current, await existingFinderLeads(db, workspaceId))?.id;
  const reviewedAt = new Date().toISOString();
  const research: FacebookResearch = { ...(input.status === 'not_found' ? readFacebookResearch({}) : input.research || readFacebookResearch({})), reviewedAt, reviewedBy: reviewer };
  const assessment = assessPlace({ websiteUri: current.website, internationalPhoneNumber: current.phone, businessStatus: current.businessStatus, rating: current.rating, userRatingCount: current.reviewCount }, { email: current.email, socialUrl: facebookUrl, summary: current.websiteSummary }, search.salesFocus, research, input.status);
  const provenance = current.provenance.filter(item => !['Sales review', 'Sales post review'].includes(item.provider));
  if (facebookUrl) provenance.push({ field: 'facebook', provider: 'Sales review', sourceUrl: facebookUrl, retrievedAt: reviewedAt });
  if (research.postUrl) provenance.push({ field: 'facebook activity', provider: 'Sales post review', sourceUrl: research.postUrl, retrievedAt: reviewedAt });
  const changed = await db.prepare(`UPDATE finder_results SET imported_lead_id=COALESCE(imported_lead_id,?),social_url=?,facebook_status=?,facebook_verified_at=?,facebook_research_json=?,provenance_json=?,review_version=review_version+1,
    score=?,score_reason=?,rule_score=?,rule_score_reason=?,opportunity=?,ai_status='pending',ai_model=NULL,ai_classification=NULL,ai_score=NULL,ai_icp_match=NULL,ai_confidence=NULL,ai_explanation=NULL,ai_opportunity_signals_json='[]',ai_concerns_json='[]',ai_recommended_action=NULL,ai_evidence_refs_json='[]',ai_input_hash=NULL,ai_error=NULL,ai_analyzed_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND search_id=? AND workspace_id=? AND review_version=?`)
    .bind(current.importedLeadId || null, facebookUrl, input.status, reviewedAt, JSON.stringify(research), JSON.stringify(provenance), assessment.score, assessment.scoreReason, assessment.score, assessment.scoreReason, assessment.opportunity, input.resultId, input.searchId, workspaceId, current.reviewVersion).run();
  if (!changed.meta.changes) return { error: 'This review changed elsewhere. Reopen the business and try again.', status: 409 };
  const prospect = { ...current, socialUrl: facebookUrl, facebookStatus: input.status, facebookVerifiedAt: reviewedAt, facebookResearch: research, ruleScore: assessment.score, score: assessment.score, aiScore: undefined, aiStatus: 'pending' };
  if (current.importedLeadId) {
    const plan = outreachPlan(prospect, search.salesFocus);
    const ready = ['Ready for outreach', 'Strong match'].includes(readiness(prospect, search.requirements, search.requirementMode));
    await db.batch([
      db.prepare('UPDATE companies SET facebook_url=?,facebook_status=?,facebook_reviewed_at=?,facebook_research_json=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE workspace_id=? AND id=(SELECT company_id FROM leads WHERE id=? AND workspace_id=?)').bind(facebookUrl || null, input.status, reviewedAt, JSON.stringify(research), workspaceId, current.importedLeadId, workspaceId),
      db.prepare('UPDATE leads SET score=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?').bind(assessment.score, current.importedLeadId, workspaceId),
      db.prepare('UPDATE opportunity_finder_assessments SET assessment_json=?,provenance_json=?,updated_at=CURRENT_TIMESTAMP WHERE finder_result_id=? AND workspace_id=?').bind(JSON.stringify({ fitScore: assessment.score, confidence: 'rules', explanation: assessment.scoreReason, recommendedNextAction: plan.reason, salesFocus: search.salesFocus, facebookResearch: research }), JSON.stringify(provenance), current.id, workspaceId),
      ...(ready ? [db.prepare("UPDATE tasks SET type=?,title=?,notes=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE workspace_id=? AND lead_id=? AND type='Research' AND title='Review prospect and contact details' AND status IN ('Open','Scheduled')").bind(plan.taskType, plan.title, `Sales focus: ${search.salesFocus}. ${plan.reason}\nFacebook: ${facebookUrl}\nDraft to review (not sent): ${plan.draft}\nResearch: ${JSON.stringify(research)}`.slice(0, 2000), workspaceId, current.importedLeadId), db.prepare("UPDATE leads SET next=(SELECT title || ' · ' || due FROM tasks WHERE workspace_id=? AND lead_id=? AND status IN ('Open','Scheduled') ORDER BY due_at LIMIT 1),version=version+1 WHERE workspace_id=? AND id=? AND EXISTS(SELECT 1 FROM tasks WHERE workspace_id=? AND lead_id=? AND status IN ('Open','Scheduled'))").bind(workspaceId,current.importedLeadId,workspaceId,current.importedLeadId,workspaceId,current.importedLeadId)] : []),
    ]);
  }
  return { ok: true };
}
