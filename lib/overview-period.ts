import { emptyCounts, type ReportCounts } from '@/lib/reports';

export const overviewPeriods = ['Daily', 'Weekly', 'Monthly', 'Quarterly', 'Yearly'] as const;
export type OverviewPeriod = (typeof overviewPeriods)[number];
export type PeriodRange = { from: string; to: string; previousFrom: string; previousTo: string; label: string; previousLabel: string };

export type OverviewResults = ReportCounts;
export type OverviewTeamRow = OverviewResults & { name: string };
export type OverviewSummary = { current: OverviewResults; previous: OverviewResults; series: { day: string; value: number }[]; team: OverviewTeamRow[]; coldLeads: number };

export const emptyResults = emptyCounts;

const iso = (date: Date) => date.toISOString().slice(0, 10);
const parse = (day: string) => new Date(`${day}T12:00:00Z`);
const addDays = (day: string, days: number) => { const date = parse(day); date.setUTCDate(date.getUTCDate() + days); return iso(date); };
const monthStart = (year: number, month: number) => iso(new Date(Date.UTC(year, month, 1, 12)));
const short = (day: string, withYear = false) => new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' }).format(parse(day));
const monthName = (day: string) => new Intl.DateTimeFormat('en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(parse(day));

function span(period: OverviewPeriod, today: string, offset: number) {
  const date = parse(today);
  if (period === 'Daily') { const day = addDays(today, offset); return { from: day, to: day }; }
  if (period === 'Weekly') {
    const monday = addDays(today, -((date.getUTCDay() + 6) % 7) + offset * 7);
    return { from: monday, to: addDays(monday, 6) };
  }
  const size = period === 'Monthly' ? 1 : period === 'Quarterly' ? 3 : 12;
  const first = Math.floor(date.getUTCMonth() / size) * size + offset * size;
  return { from: monthStart(date.getUTCFullYear(), first), to: addDays(monthStart(date.getUTCFullYear(), first + size), -1) };
}

function describe(period: OverviewPeriod, range: { from: string; to: string }, today: string) {
  if (period === 'Daily') return range.from === today ? 'Today' : short(range.from, true);
  if (period === 'Weekly') return `${short(range.from)} to ${short(range.to, true)}`;
  if (period === 'Monthly') return monthName(range.from);
  const start = parse(range.from);
  return period === 'Quarterly' ? `Q${Math.floor(start.getUTCMonth() / 3) + 1} ${start.getUTCFullYear()}` : String(start.getUTCFullYear());
}

/** Calendar periods in the rep's own timezone. `offset` steps back through earlier periods: 0 is the current one. */
export function periodRange(period: OverviewPeriod, today: string, offset = 0): PeriodRange {
  const current = span(period, today, offset);
  const previous = span(period, today, offset - 1);
  return { ...current, previousFrom: previous.from, previousTo: previous.to, label: describe(period, current, today), previousLabel: describe(period, previous, today) };
}

/** Bars for the trend chart. A single day has nothing to compare, so it has no chart. */
export function trendBuckets(period: OverviewPeriod, range: { from: string; to: string }, series: { day: string; value: number }[]) {
  if (period === 'Daily') return [];
  const buckets = new Map<string, { key: string; label: string; value: number }>();
  const keyOf = (day: string) => {
    if (period === 'Yearly') return day.slice(0, 7);
    if (period === 'Quarterly') return addDays(day, -((parse(day).getUTCDay() + 6) % 7));
    return day;
  };
  const labelOf = (key: string) => (period === 'Yearly'
    ? new Intl.DateTimeFormat('en-PH', { month: 'short', timeZone: 'UTC' }).format(parse(`${key}-01`))
    : short(key));
  for (let day = range.from; day <= range.to; day = addDays(day, 1)) {
    const key = keyOf(day);
    if (!buckets.has(key)) buckets.set(key, { key, label: labelOf(key), value: 0 });
  }
  for (const point of series) {
    const bucket = buckets.get(keyOf(point.day));
    if (bucket) bucket.value += point.value;
  }
  return [...buckets.values()];
}

/** Written out in words, and never as a percentage of nothing. */
export function describeChange(current: number, previous: number, previousLabel: string, unit: 'percent' | 'points' = 'percent') {
  if (current === previous) return `Same as ${previousLabel}`;
  if (previous === 0 && unit === 'percent') return `None in ${previousLabel}`;
  const direction = current > previous ? 'Up' : 'Down';
  if (unit === 'points') return `${direction} ${Math.abs(current - previous)} pts from ${previousLabel}`;
  return `${direction} ${Math.round(Math.abs(current - previous) / previous * 100)}% from ${previousLabel}`;
}

export const conversionRate = (results: Pick<OverviewResults, 'wonCount' | 'lostCount'>) => {
  const closed = results.wonCount + results.lostCount;
  return closed ? Math.round(results.wonCount / closed * 100) : 0;
};
