import { mapFinderResult, mapFinderSearch } from '@/lib/finder-store';
import { contactChannel, normalizedIdentity, outreachPlan, prospectScore, readiness, salesOpportunity, sameProspect, type SalesProspect } from '@/lib/finder-sales';
import { finderImportSchema } from '@/lib/validation';
import { channelList } from '@/lib/contact-channels';
import { phoneKey } from '@/lib/phone';
import { mapLead } from '@/lib/workspace-store';

/** Every lead with the Finder record it came from. One indexed pass, since Finder polls this while a search runs. */
export async function existingFinderLeads(db: D1Database, workspaceId: string) {
  const rows = await db.prepare(`SELECT l.id,COALESCE(r.name,l.name) name,l.city,l.phone,l.email,COALESCE(l.finder_provider,r.provider) finder_provider,
    COALESCE(l.finder_record_id,r.provider_record_id) finder_record_id,COALESCE(NULLIF(l.business_address,''),r.address) business_address
    FROM leads l
    LEFT JOIN (SELECT imported_lead_id,MIN(rowid) rid FROM finder_results WHERE workspace_id=? AND imported_lead_id IS NOT NULL GROUP BY imported_lead_id) f ON f.imported_lead_id=l.id
    LEFT JOIN finder_results r ON r.rowid=f.rid
    WHERE l.workspace_id=?`).bind(workspaceId, workspaceId).all<Record<string, unknown>>();
  return rows.results.map(row => ({ id: String(row.id), name: String(row.name), city: String(row.city || ''), address: String(row.business_address || ''), provider: String(row.finder_provider || ''), providerRecordId: String(row.finder_record_id || ''), phone: String(row.phone || ''), email: String(row.email || ''), website: '', socialUrl: '' }));
}

type ExistingLead = Awaited<ReturnType<typeof existingFinderLeads>>[number];
type LeadIndex = { byRecord: Map<string, number>; byNameCity: Map<string, number[]>; byPhone: Map<string, number[]> };
const leadIndexes = new WeakMap<ExistingLead[], LeadIndex>();
const recordKey = (provider: string, id: string) => `${provider}::${id}`;
const nameCityKey = (lead: { name?: string; city?: string }) => `${normalizedIdentity(lead.name)}::${normalizedIdentity(lead.city)}`;

/** Built once per lead list, so matching a search's results costs one lookup each rather than a pass over every lead. */
function leadIndex(leads: ExistingLead[]) {
  let index = leadIndexes.get(leads);
  if (index) return index;
  index = { byRecord: new Map(), byNameCity: new Map(), byPhone: new Map() };
  leads.forEach((lead, position) => {
    if (lead.provider && lead.providerRecordId && !index!.byRecord.has(recordKey(lead.provider, lead.providerRecordId))) index!.byRecord.set(recordKey(lead.provider, lead.providerRecordId), position);
    const key = nameCityKey(lead);
    const bucket = index!.byNameCity.get(key);
    if (bucket) bucket.push(position); else index!.byNameCity.set(key, [position]);
    const phone = phoneKey(lead.phone);
    if (phone) { const same = index!.byPhone.get(phone); if (same) same.push(position); else index!.byPhone.set(phone, [position]); }
  });
  leadIndexes.set(leads, index);
  return index;
}

export function findDuplicate(prospect: SalesProspect, leads: ExistingLead[]) {
  const index = leadIndex(leads);
  const byRecord = prospect.provider && prospect.providerRecordId ? index.byRecord.get(recordKey(prospect.provider, prospect.providerRecordId)) : undefined;
  const byAddress = (index.byNameCity.get(nameCityKey(prospect)) || []).find(position => sameProspect(prospect, leads[position]));
  const first = [byRecord, byAddress].filter((position): position is number => position !== undefined).sort((x, y) => x - y)[0];
  return first === undefined ? undefined : leads[first];
}
/** Same name in the same city, or the same phone number: likely the same business, but branches can share both, so a rep confirms. */
export function possibleDuplicates(prospect: SalesProspect, leads: ExistingLead[]) {
  const index = leadIndex(leads);
  const phone = phoneKey(prospect.phone);
  const positions = [...new Set([...(index.byNameCity.get(nameCityKey(prospect)) || []), ...(phone ? index.byPhone.get(phone) || [] : [])])].sort((a, b) => a - b);
  return positions.map(position => leads[position]).filter(lead => !sameProspect(prospect, lead));
}

export async function importFinderResults(db: D1Database, workspaceId: string, actor: { id: string; name: string; role: string }, input: ReturnType<typeof finderImportSchema.parse>) {
  const searchRow = await db.prepare('SELECT * FROM finder_searches WHERE id=? AND workspace_id=?').bind(input.searchId, workspaceId).first<Record<string, unknown>>();
  if (!searchRow) return { error: 'Search not found.', status: 404 };
  const search = mapFinderSearch(searchRow);
  if (['Queued','Running'].includes(search.status)) return {error:'Wait for the search to finish before importing.',status:409};
  const requested = input.assignmentMode === 'single' ? [input.ownerId!] : input.assignmentMode === 'round_robin' ? input.assigneeIds! : Object.values(input.manualAssignments!);
  const assignees = [...new Set(requested)];
  if (!['owner', 'admin'].includes(actor.role) && assignees.some(id => id !== actor.id)) return { error: 'You can only assign prospects to yourself.', status: 403 };
  const users = await db.prepare(`SELECT u.id,u.name FROM workspace_memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? AND u.id IN (${assignees.map(() => '?').join(',')}) AND u.status='active' AND m.role IN ('owner','admin','member') AND m.in_sales=1`).bind(workspaceId, ...assignees).all<{ id: string; name: string }>();
  if (users.results.length !== assignees.length) return { error: 'Choose active workspace assignees.', status: 422 };
  const userById = new Map(users.results.map(user => [user.id, user.name]));
  const rows = await db.prepare(`SELECT * FROM finder_results WHERE workspace_id=? AND search_id=? AND id IN (${input.resultIds.map(() => '?').join(',')}) ORDER BY score DESC`).bind(workspaceId, search.id, ...input.resultIds).all<Record<string, unknown>>();
  if (rows.results.length !== new Set(input.resultIds).size) return { error: 'One or more selected businesses are unavailable.', status: 404 };
  const results = rows.results.map(row => { const result = mapFinderResult(row); return {...result,opportunity:salesOpportunity(result,search.salesFocus)}; });
  const existing = await existingFinderLeads(db, workspaceId);
  if (!input.allowPossibleDuplicates && results.some(result => !findDuplicate(result, existing) && !result.importedLeadId && possibleDuplicates(result, existing).length)) return { error: 'Review the possible existing businesses and confirm they are separate branches before importing.', status: 409 };
  for (const result of results) {
    if (input.channel === 'Facebook' && contactChannel(result) !== 'Facebook') return { error: `Confirm the Facebook page and messaging availability for ${result.name}.`, status: 422 };
    if (input.channel === 'Phone' && !result.phone || input.channel === 'Email' && !result.email) return { error: `${result.name} does not have the selected contact channel.`, status: 422 };
  }
  let taskId = Number((await db.prepare('SELECT COALESCE(MAX(id),0)+1 next_id FROM tasks').first<{ next_id: number }>())?.next_id || 1);
  let activityId = Number((await db.prepare('SELECT COALESCE(MAX(id),0)+1 next_id FROM activities').first<{ next_id: number }>())?.next_id || 1);
  const imported: ReturnType<typeof mapLead>[] = [];
  let skipped = 0;
  const counts = new Map<string, number>();
  for (const [index, result] of results.entries()) {
    const duplicate = result.importedLeadId || findDuplicate(result, existing)?.id;
    if (duplicate) { await db.prepare('UPDATE finder_results SET imported_lead_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?').bind(duplicate, result.id, workspaceId).run(); skipped++; continue; }
    const userId = input.assignmentMode === 'single' ? input.ownerId! : input.assignmentMode === 'round_robin' ? input.assigneeIds![index % input.assigneeIds!.length] : input.manualAssignments![result.id];
    const owner = userById.get(userId)!;
    const companyMatch = await db.prepare('SELECT id FROM companies WHERE workspace_id=? AND finder_provider=? AND finder_record_id=?').bind(workspaceId, result.provider, result.providerRecordId).first<{ id: string }>();
    const companyId = companyMatch?.id || crypto.randomUUID(); const leadId = crypto.randomUUID(); const contactId = crypto.randomUUID();
    let companyName = result.name;
    const leadName = await db.prepare('SELECT id FROM leads WHERE workspace_id=? AND lower(name)=lower(?)').bind(workspaceId, result.name).first() ? `${result.name.slice(0,70)} · ${result.city.slice(0,30)} · ${(result.address || leadId.slice(0,6)).slice(0,45)}` : result.name;
    const opportunityId = readyForOpportunity(result, search) ? crypto.randomUUID() : null;
    if (!companyMatch && await db.prepare('SELECT id FROM companies WHERE workspace_id=? AND lower(name)=lower(?)').bind(workspaceId, companyName).first()) companyName = `${result.name.slice(0, 85)} · ${(result.address || result.city).slice(0, 55)} · ${leadId.slice(0, 6)}`;
    const ready = ['Ready for outreach', 'Strong match'].includes(readiness(result, search.requirements, search.requirementMode));
    const suggested = outreachPlan(result, search.salesFocus);
    const chosen = input.channel === 'Recommended' ? ready ? suggested.channel : 'Review' : input.channel === 'Research' ? 'Review' : input.channel;
    const type = chosen === 'Facebook' ? 'Facebook message' : chosen === 'Phone' ? 'Call' : chosen === 'Email' ? 'Email' : 'Research';
    const title = chosen === 'Review' ? 'Review prospect and contact details' : `Initial ${chosen === 'Facebook' ? 'Facebook' : chosen.toLowerCase()} follow-up`;
    const notes = `Sales focus: ${search.salesFocus}. ${readiness(result, search.requirements, search.requirementMode)}. ${suggested.reason}\n${chosen === 'Review' ? 'Verify the missing criteria before contacting this business.' : `Draft to review (not sent): ${suggested.draft}`}\nSource: ${result.sourceUrl}\n${result.socialUrl ? `Facebook: ${result.socialUrl}\n` : ''}${channelList(result.channels).map(item => `${item.label}: ${item.url}\n`).join('')}Research: ${JSON.stringify(result.facebookResearch)}`.slice(0, 2000);
    const statements = [];
    if (!companyMatch) statements.push(db.prepare('INSERT INTO companies (id,workspace_id,name,industry,city,phone,email,website,facebook_url,facebook_status,facebook_reviewed_at,facebook_research_json,owner,finder_provider,finder_record_id,business_address) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(companyId, workspaceId, companyName, result.industry, result.city, result.phone, result.email, result.website || null, result.socialUrl || null, result.facebookStatus, result.facebookVerifiedAt || null, JSON.stringify(result.facebookResearch), owner, result.provider, result.providerRecordId, result.address));
    else statements.push(db.prepare('UPDATE companies SET facebook_url=?,facebook_status=?,facebook_reviewed_at=?,facebook_research_json=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?').bind(result.socialUrl || null, result.facebookStatus, result.facebookVerifiedAt || null, JSON.stringify(result.facebookResearch), companyId, workspaceId));
    statements.push(db.prepare('INSERT INTO contacts (id,workspace_id,company_id,name,email,phone,is_primary) VALUES (?,?,?,?,?,?,1)').bind(contactId, workspaceId, companyId, 'Business contact', result.email, result.phone));
    statements.push(db.prepare('INSERT INTO leads (country,id,workspace_id,company_id,primary_contact_id,version,name,industry,city,status,score,owner,last,next,phone,email,contact,priority,opportunity,finder_provider,finder_record_id,business_address) VALUES (?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(search.country, leadId, workspaceId, companyId, contactId, leadName, result.industry, result.city, input.status, prospectScore(result), owner, 'Imported from Finder', `${title} · ${input.followUpDate}`, result.phone, result.email, 'Business contact', input.priority, ready ? result.opportunity : '', result.provider, result.providerRecordId, result.address));
    if (ready) {

      statements.push(db.prepare('INSERT INTO opportunities (id,workspace_id,company_id,lead_id,primary_contact_id,name,stage,value,probability,owner,priority) VALUES (?,?,?,?,?,?,?,0,?,?,?)').bind(opportunityId, workspaceId, companyId, leadId, contactId, result.opportunity, input.status, input.status === 'Interested' ? 40 : input.status === 'Contacted' ? 25 : 10, owner, input.priority));
      statements.push(db.prepare('INSERT INTO opportunity_finder_assessments (id,workspace_id,opportunity_id,finder_result_id,assessment_json,provenance_json) VALUES (?,?,?,?,?,?) ON CONFLICT(finder_result_id) DO UPDATE SET opportunity_id=excluded.opportunity_id,assessment_json=excluded.assessment_json,provenance_json=excluded.provenance_json,updated_at=CURRENT_TIMESTAMP').bind(crypto.randomUUID(), workspaceId, opportunityId, result.id, JSON.stringify({ classification: result.aiClassification, icpMatch: result.aiIcpMatch, fitScore: result.aiScore ?? result.ruleScore, confidence: result.aiConfidence || 'rules', explanation: result.aiExplanation || result.ruleScoreReason, recommendedNextAction: suggested.reason, salesFocus: search.salesFocus, facebookResearch: result.facebookResearch }), JSON.stringify(result.provenance)));
    }
    statements.push(db.prepare('INSERT INTO tasks (uid,workspace_id,id,title,lead,lead_id,company_id,contact_id,opportunity_id,owner,priority,due,due_at,time,type,notes,status,reminder,recurrence,version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,\'Scheduled\',\'15 minutes before\',\'None\',1)').bind(crypto.randomUUID(), workspaceId, taskId++, title, leadName, leadId, companyId, contactId, opportunityId, owner, input.priority, input.followUpDate, input.followUpDate, '09:00', type, notes));
    statements.push(db.prepare('INSERT INTO activities (uid,workspace_id,id,lead,lead_id,company_id,contact_id,type,detail,time,owner,status,occurred_at,outcome,version) VALUES (?,?,?,?,?,?,?,\'Finder import\',?,\'Just now\',?,\'Completed\',?,\'Imported\',1)').bind(crypto.randomUUID(), workspaceId, activityId++, leadName, leadId, companyId, contactId, `Imported from ${result.provider} · ${result.sourceUrl}`.slice(0, 2000), owner, new Date().toISOString()));
    statements.push(db.prepare('UPDATE finder_results SET imported_lead_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=? AND imported_lead_id IS NULL').bind(leadId, result.id, workspaceId));
    await db.batch(statements);
    existing.push({ id: leadId, name: result.name, city: result.city, address: result.address, provider: result.provider, providerRecordId: result.providerRecordId, phone: result.phone, email: result.email, website: '', socialUrl: '' });
    const saved = await db.prepare('SELECT * FROM leads WHERE id=? AND workspace_id=?').bind(leadId, workspaceId).first<Record<string, unknown>>();
    if (saved) imported.push(mapLead(saved)); counts.set(userId, (counts.get(userId) || 0) + 1);
  }
  await db.prepare('UPDATE finder_searches SET imported_count=(SELECT COUNT(*) FROM finder_results WHERE search_id=? AND workspace_id=? AND imported_lead_id IS NOT NULL),updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?').bind(search.id, workspaceId, search.id, workspaceId).run();
  return { imported, skipped, assignments: [...counts].map(([userId, count]) => ({ userId, name: userById.get(userId), count })) };
}

function readyForOpportunity(result: Parameters<typeof readiness>[0],search:ReturnType<typeof mapFinderSearch>){return ['Ready for outreach','Strong match'].includes(readiness(result,search.requirements,search.requirementMode))}
