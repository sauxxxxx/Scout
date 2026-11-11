/** What Overview and Reports count. Everything here runs in the browser and on the server, so both always agree. */
export type ReportCounts = { newLeads: number; calls: number; liveCalls: number; noAnswerCalls: number; emails: number; meetings: number; notes: number; followUps: number; proposals: number; wonCount: number; wonValue: number; lostCount: number };
export type RepReport = ReportCounts & { name: string };
export type DayReport = ReportCounts & { day: string };
export type Report = { current: ReportCounts; previous: ReportCounts; byRep: RepReport[]; byDay: DayReport[] };
export type ReportRecord = { key: string; date: string; rep: string; lead: string; detail: string };

export const emptyCounts: ReportCounts = { newLeads: 0, calls: 0, liveCalls: 0, noAnswerCalls: 0, emails: 0, meetings: 0, notes: 0, followUps: 0, proposals: 0, wonCount: 0, wonValue: 0, lostCount: 0 };

export const callMetrics = [
  { key: 'calls', label: 'Total Calls', singular: 'call attempt', plural: 'call attempts' },
  { key: 'liveCalls', label: 'Live Calls', singular: 'live call', plural: 'live calls' },
  { key: 'noAnswerCalls', label: 'No Answer', singular: 'unanswered call', plural: 'unanswered calls' },
] as const;

export const reportMetrics = [
  { key: 'newLeads', label: 'Prospects', singular: 'prospect', plural: 'prospects' },
  ...callMetrics,
  { key: 'emails', label: 'Emails', singular: 'email', plural: 'emails' },
  { key: 'meetings', label: 'Meetings', singular: 'meeting', plural: 'meetings' },
  { key: 'followUps', label: 'Follow-ups', singular: 'follow-up', plural: 'follow-ups' },
  { key: 'proposals', label: 'Proposals', singular: 'proposal', plural: 'proposals' },
  { key: 'wonCount', label: 'Deals won', singular: 'deal won', plural: 'deals won' },
] as const;
export type ReportMetric = (typeof reportMetrics)[number]['key'];
export const isReportMetric = (value: string | null): value is ReportMetric => reportMetrics.some(metric => metric.key === value);

/** The rep's work, in their words. Callbacks are calls, and `Send proposal` tasks are proposals (counted separately). */
export function activityField(type: string): 'calls' | 'emails' | 'meetings' | 'notes' | null {
  const name = type.toLowerCase();
  if (name === 'call' || name === 'callback') return 'calls';
  if (name === 'email') return 'emails';
  if (name === 'meeting') return 'meetings';
  if (name === 'note') return 'notes';
  return null;
}

/** Logging a proposal usually moves the deal too, so one proposal leaves two traces. Only the earliest counts. */
export function firstProposals<T extends { item: string; day: string }>(rows: T[]) {
  const first = new Map<string, T>();
  for (const row of rows) {
    const earliest = first.get(row.item);
    if (!earliest || row.day < earliest.day) first.set(row.item, row);
  }
  return [...first.values()];
}

export function addCounts(total: ReportCounts, row: Partial<ReportCounts>) {
  for (const key of Object.keys(emptyCounts) as (keyof ReportCounts)[]) total[key] += row[key] || 0;
  return total;
}

const parse = (day: string) => new Date(`${day}T12:00:00Z`);
const iso = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (day: string, days: number) => { const date = parse(day); date.setUTCDate(date.getUTCDate() + days); return iso(date); };
export const daysBetween = (from: string, to: string) => Math.round((parse(to).getTime() - parse(from).getTime()) / 86400000) + 1;
const short = (day: string) => new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(parse(day));
const monthName = (day: string) => new Intl.DateTimeFormat('en-PH', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(parse(day));

export const MAX_CUSTOM_DAYS = 366;

/** A chosen date range, compared with the same number of days just before it. */
export function customRange(from: string, to: string) {
  const length = daysBetween(from, to);
  const previousTo = addDays(from, -1);
  const previousFrom = addDays(from, -length);
  return { from, to, previousFrom, previousTo, label: `${short(from)} to ${short(to)}, ${to.slice(0, 4)}`, previousLabel: `the ${length === 1 ? 'day' : `${length} days`} before` };
}

export type ReportBucket = ReportCounts & { key: string; label: string; from: string; to: string };

/** Days for a month or less, weeks up to about a quarter, and months beyond that, so the table never runs to hundreds of rows. */
export function reportBuckets(from: string, to: string, days: DayReport[]): ReportBucket[] {
  const length = daysBetween(from, to);
  const size = length <= 31 ? 'day' : length <= 120 ? 'week' : 'month';
  const startOf = (day: string) => size === 'day' ? day : size === 'week' ? addDays(day, -((parse(day).getUTCDay() + 6) % 7)) : `${day.slice(0, 7)}-01`;
  const buckets = new Map<string, ReportBucket>();
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const key = startOf(day);
    const bucket = buckets.get(key);
    if (bucket) bucket.to = day;
    else buckets.set(key, { ...emptyCounts, key, from: day, to: day, label: size === 'month' ? monthName(day) : size === 'week' ? `Week of ${short(day)}` : short(day) });
  }
  for (const row of days) {
    const bucket = buckets.get(startOf(row.day));
    if (bucket) addCounts(bucket, row);
  }
  return [...buckets.values()];
}

const columns: { label: string; key: keyof ReportCounts }[] = [...reportMetrics.map(metric => ({ label: metric.label, key: metric.key as keyof ReportCounts })), { label: 'Revenue', key: 'wonValue' }];

/** The same table the page shows, for CSV and Google Sheets. */
export function reportTable(report: Report, view: 'rep' | 'day', from: string, to: string) {
  const headers = [view === 'rep' ? 'Rep' : 'Period', ...columns.map(column => column.label)];
  const rows = view === 'rep'
    ? report.byRep.map(row => [row.name, ...columns.map(column => row[column.key])])
    : reportBuckets(from, to, report.byDay).filter(hasActivity).map(row => [row.label, ...columns.map(column => row[column.key])]);
  return { headers, rows: [...rows, ['Total', ...columns.map(column => report.current[column.key])]] as (string | number)[][] };
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** The period in one plain sentence, followed by the biggest change. */
export function reportSummary(current: ReportCounts, previous: ReportCounts, previousLabel: string, who: string, money: (value: number) => string) {
  const work = [current.calls && plural(current.calls, 'call'), current.followUps && plural(current.followUps, 'follow-up'), current.proposals && plural(current.proposals, 'proposal')].filter(Boolean) as string[];
  const list = work.length > 1 ? `${work.slice(0, -1).join(', ')} and ${work[work.length - 1]}` : work[0];
  const won = current.wonCount ? `won ${plural(current.wonCount, 'deal')} worth ${money(current.wonValue)}` : '';
  const headline = list && won ? `${who} made ${list}, and ${won}.` : list ? `${who} made ${list}.` : won ? `${who} ${won}.` : current.newLeads ? `${who} added ${plural(current.newLeads, 'prospect')}.` : 'Nothing recorded for this period yet.';
  const changes = (['calls', 'followUps', 'proposals', 'wonCount'] as const).filter(key => previous[key] > 0 && current[key] !== previous[key]).map(key => ({ key, change: (current[key] - previous[key]) / previous[key] })).sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  const names = { calls: 'Calls', followUps: 'Follow-ups', proposals: 'Proposals', wonCount: 'Deals won' };
  const top = changes[0];
  return { headline, detail: top ? `${names[top.key]} are ${top.change > 0 ? 'up' : 'down'} ${Math.round(Math.abs(top.change) * 100)}% from ${previousLabel}.` : '' };
}

export const hasActivity = (row: ReportCounts) => (Object.keys(emptyCounts) as (keyof ReportCounts)[]).some(key => row[key] > 0);
