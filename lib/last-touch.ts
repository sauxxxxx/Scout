/** Contact with the customer. Edits, assignments and scheduling don't count, so a stale lead can't look worked. */
export const touchActivityTypes = ['call', 'callback', 'email', 'meeting', 'note', 'proposal', 'send proposal', 'facebook message'];

export const isTouchActivity = (activity: { type: string; status?: string; deletedAt?: string; occurredAt?: string }) =>
  touchActivityTypes.includes(activity.type.toLowerCase()) && (activity.status || 'Completed') === 'Completed' && !activity.deletedAt && !!activity.occurredAt;

export const touchTypesSql = touchActivityTypes.map(type => `'${type}'`).join(',');

export const touchFilters = ['Any last touch', 'Today', 'Last 7 days', 'Last 30 days', 'No touch in 14+ days', 'No touch in 30+ days', 'Never touched', 'Custom range'] as const;
export type TouchFilter = (typeof touchFilters)[number];
export type TouchRange = { touchFrom?: string; touchTo?: string; touchBefore?: string; touchNever?: string };

const shift = (day: string, days: number) => {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

/** Dates are the rep's own calendar days, matching how activity times are stored. */
export function touchRange(filter: string, today: string, custom: { from?: string; to?: string } = {}): TouchRange {
  if (filter === 'Today') return { touchFrom: today, touchTo: today };
  if (filter === 'Last 7 days') return { touchFrom: shift(today, -6), touchTo: today };
  if (filter === 'Last 30 days') return { touchFrom: shift(today, -29), touchTo: today };
  if (filter === 'No touch in 14+ days') return { touchBefore: shift(today, -13) };
  if (filter === 'No touch in 30+ days') return { touchBefore: shift(today, -29) };
  if (filter === 'Never touched') return { touchNever: '1' };
  if (filter === 'Custom range') return { touchFrom: custom.from || undefined, touchTo: custom.to || undefined };
  return {};
}

export function matchesTouch(lastTouch: string | null | undefined, range: TouchRange) {
  const day = lastTouch?.slice(0, 10) || '';
  if (range.touchNever) return !day;
  if (range.touchBefore) return !day || day < range.touchBefore;
  if (range.touchFrom && (!day || day < range.touchFrom)) return false;
  if (range.touchTo && (!day || day > range.touchTo)) return false;
  return true;
}
