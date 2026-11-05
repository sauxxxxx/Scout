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

export function formatClock(date: Date) {
  return new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit', hour12: preferences.timeFormat === '12-hour' }).format(date);
}
