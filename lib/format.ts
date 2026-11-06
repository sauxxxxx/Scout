type DisplayPreferences = { dateFormat: string; timeFormat: string; timezone: string };

let preferences: DisplayPreferences = { dateFormat: 'MMM d, yyyy', timeFormat: '12-hour', timezone: 'Asia/Manila' };

/** Set once from the person's profile so every date in the app follows the same settings. */
export function setDisplayPreferences(next: Partial<DisplayPreferences>) {
  preferences = { ...preferences, ...next };
}

function parse(value: string) {
  // Plain dates must stay on their calendar day, whatever the timezone.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return { date: new Date(`${value}T12:00:00Z`), dateOnly: true };
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value) ? `${value.replace(' ', 'T')}Z` : value;
  return { date: new Date(iso), dateOnly: false };
}

export function formatDate(value?: string | null, fallback = '') {
  if (!value) return fallback;
  const { date, dateOnly } = parse(value);
  if (Number.isNaN(date.getTime())) return value;
  const short = preferences.dateFormat === 'MMM d, yyyy';
  return new Intl.DateTimeFormat(preferences.dateFormat === 'dd/MM/yyyy' ? 'en-GB' : 'en-US', {
    month: short ? 'short' : '2-digit', day: short ? 'numeric' : '2-digit', year: 'numeric', timeZone: dateOnly ? 'UTC' : preferences.timezone,
  }).format(date);
}

export function formatDateTime(value?: string | null, fallback = '') {
  if (!value) return fallback;
  const { date, dateOnly } = parse(value);
  if (Number.isNaN(date.getTime())) return value;
  if (dateOnly) return formatDate(value);
  return `${formatDate(value)}, ${new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit', hour12: preferences.timeFormat === '12-hour', timeZone: preferences.timezone }).format(date)}`;
}

/** Activity times are saved as the wall-clock time someone entered, so plain values are shown as typed. */
export function formatActivityTime(occurredAt?: string | null, fallback = '') {
  if (!occurredAt) return fallback;
  const wall = occurredAt.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!wall) return formatDateTime(occurredAt, fallback);
  const [, day, hour, minute] = wall;
  const time = new Date(Date.UTC(2000, 0, 1, Number(hour), Number(minute)));
  return `${formatDate(day)}, ${new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit', hour12: preferences.timeFormat === '12-hour', timeZone: 'UTC' }).format(time)}`;
}

/** Just the time of an activity, for showing beside its date. A date with no time gives nothing. */
export function formatTouchTime(occurredAt?: string | null) {
  const wall = occurredAt?.match(/T(\d{2}):(\d{2})/);
  if (!wall) return '';
  const time = new Date(Date.UTC(2000, 0, 1, Number(wall[1]), Number(wall[2])));
  return new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit', hour12: preferences.timeFormat === '12-hour', timeZone: 'UTC' }).format(time);
}

/** Stored times come in three shapes: a wall-clock activity time, a UTC database timestamp, and ISO. */
export function parseStamp(value?: string | null) {
  if (!value) return null;
  const text = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value) ? `${value.replace(' ', 'T')}Z` : value;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The current time as an activity stores it: the rep's own wall clock, to the minute. */
export function localDateTime(now = new Date()) {
  const shifted = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return shifted.toISOString().slice(0, 16);
}

const dayStart = (time: number) => { const date = new Date(time); date.setHours(0, 0, 0, 0); return date.getTime(); };

/** Calendar days between then and now, so 11pm to 1am counts as a day. */
export function daysSince(value?: string | null, now = Date.now()) {
  const date = parseStamp(value);
  return date ? Math.round((dayStart(now) - dayStart(date.getTime())) / 86400000) : null;
}

export function formatDaysAgo(value?: string | null, now = Date.now()) {
  const days = daysSince(value, now);
  if (days === null) return '';
  if (days <= 0) return 'Today';
  return days === 1 ? 'Yesterday' : `${days} days ago`;
}

/** Counts up for the first hour, then settles on the real time. Scheduled times in the future keep their full date. */
export function formatRelativeTime(value?: string | null, fallback = '', now = Date.now()) {
  const date = parseStamp(value);
  if (!date) return fallback;
  const elapsed = now - date.getTime();
  if (elapsed < -60000) return formatActivityTime(value, fallback);
  if (elapsed < 60000) return 'Just now';
  if (elapsed < 3600000) return `${Math.floor(elapsed / 60000)} min ago`;
  const days = daysSince(value, now);
  const time = formatActivityTime(value, fallback).split(', ').pop();
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;
  return formatActivityTime(value, fallback);
}

export function formatClock(date: Date) {
  return new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit', hour12: preferences.timeFormat === '12-hour' }).format(date);
}
