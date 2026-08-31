export type TaskRecurrence = 'None' | 'Daily' | 'Weekly' | 'Monthly';

function atNoon(date: Date) {
  const copy = new Date(date);
  copy.setHours(12, 0, 0, 0);
  return copy;
}

export function resolveTaskDate(due: string, anchor = new Date()) {
  const date = atNoon(anchor);
  if (due === 'Tomorrow') date.setDate(date.getDate() + 1);
  else if (!['Today', 'Overdue'].includes(due)) {
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(due) ? new Date(`${due}T12:00:00`) : new Date(`${due}, ${date.getFullYear()} 12:00`);
    if (!Number.isNaN(iso.getTime())) date.setTime(iso.getTime());
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

export function nextRecurringTaskDue(due: string, recurrence: TaskRecurrence, anchor = new Date()) {
  const date = resolveTaskDate(due, anchor);
  if (recurrence === 'Daily') date.setDate(date.getDate() + 1);
  if (recurrence === 'Weekly') date.setDate(date.getDate() + 7);
  if (recurrence === 'Monthly') date.setMonth(date.getMonth() + 1);
  return taskDateLabel(date, anchor);
}

export function taskDueIso(due: string, anchor = new Date()) {
  return resolveTaskDate(due, anchor).toISOString().slice(0, 10);
}
