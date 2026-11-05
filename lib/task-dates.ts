export type TaskRecurrence = 'None' | 'Daily' | 'Weekly' | 'Monthly';

function atNoon(date: Date) {
  const copy = new Date(date);
  copy.setHours(12, 0, 0, 0);
  return copy;
}

const pad = (value: number) => String(value).padStart(2, '0');

/** A calendar date in this device's timezone. `toISOString()` would give the UTC date, which is yesterday before 8am in Manila. */
export function localIso(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Today's calendar date for a person, wherever the server happens to run. */
export function isoInZone(timezone = 'Asia/Manila', at = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

export const anchorForZone = (timezone?: string, at = new Date()) => new Date(`${isoInZone(timezone, at)}T12:00:00`);

export function resolveTaskDate(due: string, anchor = new Date()) {
  const date = atNoon(anchor);
  if (due === 'Tomorrow') date.setDate(date.getDate() + 1);
  else if (!['Today', 'Overdue'].includes(due)) {
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(due) ? new Date(`${due}T12:00:00`) : new Date(`${due}, ${date.getFullYear()} 12:00`);
    if (!Number.isNaN(iso.getTime())) {
      // "Jan 3" picked in December means next January, not eleven months ago.
      if (!/^\d{4}/.test(due) && date.getTime() - iso.getTime() > 180 * 86400000) iso.setFullYear(iso.getFullYear() + 1);
      date.setTime(iso.getTime());
    }
  }
  return date;
}

export function taskDateLabel(date: Date, anchor = new Date()) {
  const target = atNoon(date);
  const base = atNoon(anchor);
  const difference = Math.round((target.getTime() - base.getTime()) / 86400000);
  if (difference === 0) return 'Today';
  if (difference === 1) return 'Tomorrow';
  return target.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** The label a task should show right now. Stored labels go stale, so this always works from the real date. */
export function taskDueLabel(dueAt: string, anchor = new Date()) {
  const date = new Date(`${dueAt.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return localIso(date) < localIso(anchor) ? 'Overdue' : taskDateLabel(date, anchor);
}

export function relabelTask<T extends { due: string; dueAt?: string; status: string }>(task: T, anchor = new Date()): T {
  if (!task.dueAt || task.status === 'Completed') return task;
  const due = taskDueLabel(task.dueAt, anchor);
  return due && due !== task.due ? { ...task, due } : task;
}

export function nextRecurringTaskDue(due: string, recurrence: TaskRecurrence, anchor = new Date()) {
  const date = resolveTaskDate(due, anchor);
  if (recurrence === 'Daily') date.setDate(date.getDate() + 1);
  if (recurrence === 'Weekly') date.setDate(date.getDate() + 7);
  if (recurrence === 'Monthly') date.setMonth(date.getMonth() + 1);
  return taskDateLabel(date, anchor);
}

export function taskDueIso(due: string, anchor = new Date()) {
  return localIso(resolveTaskDate(due, anchor));
}
