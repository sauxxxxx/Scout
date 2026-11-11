import { addCounts, emptyCounts, activityField, firstProposals, type DayReport, type Report, type ReportCounts, type ReportMetric, type ReportRecord, type RepReport } from '@/lib/reports';

export type ReportScope = { workspaceId: string; timezone: string; owner: string; source?: string | null };

const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
export const validDay = (value: unknown): value is string => typeof value === 'string' && dayPattern.test(value);

/** SQLite keeps UTC, while "today" means the rep's own calendar day. */
export function zoneModifier(timezone: string, at = new Date()) {
  const clock = (zone: string) => new Date(at.toLocaleString('en-US', { timeZone: zone })).getTime();
  const minutes = Math.round((clock(timezone) - clock('UTC')) / 60000);
  return `${minutes >= 0 ? '+' : ''}${minutes} minutes`;
}

const number = (value: unknown) => Number(value || 0);
const sourceClause = (source?: string | null) => source === 'Finder' ? ' AND c.finder_provider IS NOT NULL' : source === 'Manual' ? ' AND c.finder_provider IS NULL' : '';

/** Internal reminders aren't sales work. Every other finished task is a follow-up with a customer. */
const followUpTasks = "t.status='Completed' AND LOWER(t.type)!='internal reminder'";
const proposalActivity = "(LOWER(a.type) IN ('proposal','send proposal') OR (a.type='Status change' AND a.detail LIKE '% → Proposal%'))";
const completedActivity = "a.deleted_at IS NULL AND COALESCE(a.status,'Completed')='Completed'";

// Older Lead logs start with the outcome. Older Task logs put it after the task title.
const firstDetail = (value: string) => `LOWER(TRIM(substr(${value},1,instr(${value}||' · ',' · ')-1)))`;
const firstPart = firstDetail('a.detail');
const secondPart = firstDetail("substr(a.detail,instr(a.detail,' · ')+3)");
const callOutcome = `COALESCE(NULLIF(LOWER(TRIM(a.outcome)),''), CASE
  WHEN ${firstPart} IN ('connected','no answer','voicemail','cannot be reached','rescheduled','not interested','completed') THEN ${firstPart}
  WHEN instr(a.detail,' · ')>0 THEN ${secondPart} END)`;
const liveCall = `${callOutcome} IN ('connected','not interested')`;
const noAnswerCall = `${callOutcome}='no answer'`;

function statements(db: D1Database, scope: ReportScope, from: string, to: string) {
  const zone = zoneModifier(scope.timezone);
  const source = sourceClause(scope.source);
  const owner = (column: string) => scope.owner ? ` AND ${column}=?` : '';
  const owners = scope.owner ? [scope.owner] : [];
  return [
    db.prepare(`SELECT o.owner owner,date(o.closed_at,?) day,SUM(o.stage='Won') won_count,SUM(CASE WHEN o.stage='Won' THEN o.value ELSE 0 END) won_value,SUM(o.stage='Lost') lost_count
      FROM opportunities o LEFT JOIN companies c INDEXED BY idx_companies_id ON c.id=o.company_id WHERE o.workspace_id=? AND o.archived=0 AND o.stage IN ('Won','Lost') AND date(o.closed_at,?) BETWEEN ? AND ?${owner('o.owner')}${source} GROUP BY 1,2`)
      .bind(zone, scope.workspaceId, zone, from, to, ...owners),
    db.prepare(`SELECT l.owner owner,date(l.prospect_at,?) day,COUNT(*) total FROM leads l LEFT JOIN companies c INDEXED BY idx_companies_id ON c.id=l.company_id
      WHERE l.workspace_id=? AND l.archived=0 AND l.prospect_at IS NOT NULL AND date(l.prospect_at,?) BETWEEN ? AND ?${owner('l.owner')}${source} GROUP BY 1,2`)
      .bind(zone, scope.workspaceId, zone, from, to, ...owners),
    db.prepare(`SELECT a.owner owner,substr(a.occurred_at,1,10) day,LOWER(a.type) type,COUNT(*) total,
      CASE WHEN LOWER(a.type) IN ('call','callback') THEN SUM(${liveCall}) END live_calls,
      CASE WHEN LOWER(a.type) IN ('call','callback') THEN SUM(${noAnswerCall}) END no_answer_calls
      FROM activities a LEFT JOIN companies c INDEXED BY idx_companies_id ON c.id=a.company_id
      WHERE a.workspace_id=? AND ${completedActivity} AND a.occurred_at BETWEEN ? AND ?||'~'${owner('a.owner')}${source} GROUP BY 1,2,3`)
      .bind(scope.workspaceId, from, to, ...owners),
    db.prepare(`SELECT t.owner owner,date(t.completed_at,?) day,COUNT(*) total FROM tasks t LEFT JOIN companies c INDEXED BY idx_companies_id ON c.id=t.company_id
      WHERE t.workspace_id=? AND ${followUpTasks} AND date(t.completed_at,?) BETWEEN ? AND ?${owner('t.owner')}${source} GROUP BY 1,2`)
      .bind(zone, scope.workspaceId, zone, from, to, ...owners),
    db.prepare(`SELECT a.owner owner,substr(a.occurred_at,1,10) day,COALESCE(a.lead_id,a.uid) item FROM activities a LEFT JOIN companies c INDEXED BY idx_companies_id ON c.id=a.company_id
      WHERE a.workspace_id=? AND ${completedActivity} AND ${proposalActivity} AND a.occurred_at BETWEEN ? AND ?||'~'${owner('a.owner')}${source}
      UNION ALL SELECT o.owner owner,date(o.proposal_at,?) day,COALESCE(o.lead_id,o.id) item FROM opportunities o LEFT JOIN companies c INDEXED BY idx_companies_id ON c.id=o.company_id
      WHERE o.workspace_id=? AND o.archived=0 AND date(o.proposal_at,?) BETWEEN ? AND ?${owner('o.owner')}${source}`)
      .bind(scope.workspaceId, from, to, ...owners, zone, scope.workspaceId, zone, from, to, ...owners),
  ];
}

type Tally = (owner: string, day: string, counts: Partial<ReportCounts>) => void;

function tallyInto(results: { results: unknown[] }[], tally: Tally) {
  const [deals, leads, work, followUps, proposals] = results.map(result => result.results) as Record<string, unknown>[][];
  for (const row of deals) tally(String(row.owner), String(row.day), { wonCount: number(row.won_count), wonValue: number(row.won_value), lostCount: number(row.lost_count) });
  for (const row of leads) tally(String(row.owner), String(row.day), { newLeads: number(row.total) });
  for (const row of work) {
    const field = activityField(String(row.type));
    if (!field) continue;
    const counts: Partial<ReportCounts> = { [field]: number(row.total) };
    if (field === 'calls') {
      counts.liveCalls = number(row.live_calls);
      counts.noAnswerCalls = number(row.no_answer_calls);
    }
    tally(String(row.owner), String(row.day), counts);
  }
  for (const row of followUps) tally(String(row.owner), String(row.day), { followUps: number(row.total) });
  for (const row of firstProposals(proposals as { owner: string; day: string; item: string }[])) tally(row.owner, row.day, { proposals: 1 });
}

/** One place to count, so Overview, Reports and their exports can never disagree. */
/** Names of people switched out of sales (IT, admins who don't sell), so their test calls and leads don't show as sales work. */
export async function nonSalesNames(db: D1Database, workspaceId: string) {
  const rows = await db.prepare('SELECT u.name FROM workspace_memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? AND m.in_sales=0').bind(workspaceId).all<{ name: string }>();
  return new Set(rows.results.map(row => row.name));
}

export async function loadReport(db: D1Database, scope: ReportScope, range: { from: string; to: string; previousFrom: string; previousTo: string }): Promise<Report> {
  const excluded = await nonSalesNames(db, scope.workspaceId);
  const results = await db.batch([...statements(db, scope, range.from, range.to), ...statements(db, scope, range.previousFrom, range.previousTo)]);
  const current = { ...emptyCounts };
  const previous = { ...emptyCounts };
  const reps = new Map<string, RepReport>();
  const days = new Map<string, DayReport>();
  tallyInto(results.slice(0, 5), (owner, day, counts) => {
    if (excluded.has(owner)) return;
    addCounts(current, counts);
    if (!reps.has(owner)) reps.set(owner, { ...emptyCounts, name: owner });
    if (!days.has(day)) days.set(day, { ...emptyCounts, day });
    addCounts(reps.get(owner)!, counts);
    addCounts(days.get(day)!, counts);
  });
  tallyInto(results.slice(5), (owner, _day, counts) => { if (!excluded.has(owner)) addCounts(previous, counts); });
  return { current, previous, byRep: [...reps.values()], byDay: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)) };
}

const RECORD_LIMIT = 200;

/** The records behind a number, so nobody has to take a total on trust. */
export async function loadReportRecords(db: D1Database, scope: ReportScope, metric: ReportMetric, from: string, to: string): Promise<ReportRecord[]> {
  const zone = zoneModifier(scope.timezone);
  const source = sourceClause(scope.source);
  const owner = (column: string) => scope.owner ? ` AND ${column}=?` : '';
  const owners = scope.owner ? [scope.owner] : [];
  const excluded = await nonSalesNames(db, scope.workspaceId);
  const rows = async (sql: string, ...values: unknown[]) => (await db.prepare(`${sql} LIMIT ${RECORD_LIMIT}`).bind(...values).all<ReportRecord>()).results.filter(record => !excluded.has(record.rep));
  if (metric === 'newLeads') return rows(`SELECT l.id key,date(l.prospect_at,?) date,l.owner rep,l.name lead,l.industry||' · '||l.city detail FROM leads l LEFT JOIN companies c INDEXED BY idx_companies_id ON c.id=l.company_id
    WHERE l.workspace_id=? AND l.archived=0 AND l.prospect_at IS NOT NULL AND date(l.prospect_at,?) BETWEEN ? AND ?${owner('l.owner')}${source} ORDER BY 2 DESC,l.name`, zone, scope.workspaceId, zone, from, to, ...owners);
  if (metric === 'followUps') return rows(`SELECT t.uid key,date(t.completed_at,?) date,t.owner rep,t.lead lead,t.title detail FROM tasks t LEFT JOIN companies c INDEXED BY idx_companies_id ON c.id=t.company_id
    WHERE t.workspace_id=? AND ${followUpTasks} AND date(t.completed_at,?) BETWEEN ? AND ?${owner('t.owner')}${source} ORDER BY 2 DESC,t.title`, zone, scope.workspaceId, zone, from, to, ...owners);
  if (metric === 'wonCount') return rows(`SELECT o.id key,date(o.closed_at,?) date,o.owner rep,COALESCE(l.name,c.name,o.name) lead,o.name detail FROM opportunities o LEFT JOIN companies c INDEXED BY idx_companies_id ON c.id=o.company_id LEFT JOIN leads l ON l.id=o.lead_id
    WHERE o.workspace_id=? AND o.archived=0 AND o.stage='Won' AND date(o.closed_at,?) BETWEEN ? AND ?${owner('o.owner')}${source} ORDER BY 2 DESC,o.name`, zone, scope.workspaceId, zone, from, to, ...owners);
  if (metric === 'proposals') {
    const found = await rows(`SELECT a.uid key,COALESCE(a.lead_id,a.uid) item,substr(a.occurred_at,1,10) day,substr(a.occurred_at,1,10) date,a.owner rep,a.lead lead,a.detail detail FROM activities a LEFT JOIN companies c INDEXED BY idx_companies_id ON c.id=a.company_id
      WHERE a.workspace_id=? AND ${completedActivity} AND ${proposalActivity} AND a.occurred_at BETWEEN ? AND ?||'~'${owner('a.owner')}${source}
      UNION ALL SELECT o.id key,COALESCE(o.lead_id,o.id) item,date(o.proposal_at,?) day,date(o.proposal_at,?) date,o.owner rep,COALESCE(l.name,c.name,o.name) lead,o.name detail FROM opportunities o LEFT JOIN companies c INDEXED BY idx_companies_id ON c.id=o.company_id LEFT JOIN leads l ON l.id=o.lead_id
      WHERE o.workspace_id=? AND o.archived=0 AND date(o.proposal_at,?) BETWEEN ? AND ?${owner('o.owner')}${source} ORDER BY 3 DESC`, scope.workspaceId, from, to, ...owners, zone, zone, scope.workspaceId, zone, from, to, ...owners) as (ReportRecord & { item: string; day: string })[];
    return firstProposals(found).map(({ key, date, rep, lead, detail }) => ({ key, date, rep, lead, detail })).sort((a, b) => b.date.localeCompare(a.date));
  }
  const types = metric === 'emails' ? ['email'] : metric === 'meetings' ? ['meeting'] : ['call', 'callback'];
  const outcomeFilter = metric === 'liveCalls' ? ` AND ${liveCall}` : metric === 'noAnswerCalls' ? ` AND ${noAnswerCall}` : '';
  return rows(`SELECT a.uid key,substr(a.occurred_at,1,10) date,a.owner rep,a.lead lead,a.detail detail FROM activities a LEFT JOIN companies c INDEXED BY idx_companies_id ON c.id=a.company_id
    WHERE a.workspace_id=? AND ${completedActivity} AND LOWER(a.type) IN (${types.map(() => '?').join(',')}) AND a.occurred_at BETWEEN ? AND ?||'~'${owner('a.owner')}${source}${outcomeFilter} ORDER BY a.occurred_at DESC`, scope.workspaceId, ...types, from, to, ...owners);
}
