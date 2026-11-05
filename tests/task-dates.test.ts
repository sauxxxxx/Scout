import { describe, expect, it } from 'vitest';
import { isoInZone, localIso, nextRecurringTaskDue, relabelTask, resolveTaskDate, taskDueIso, taskDueLabel } from '@/lib/task-dates';

describe('task recurrence dates', () => {
  const anchor = new Date('2026-08-31T12:00:00');

  it('creates the next daily and weekly occurrence', () => {
    expect(nextRecurringTaskDue('Today', 'Daily', anchor)).toBe('Tomorrow');
    expect(nextRecurringTaskDue('Sep 2', 'Weekly', anchor)).toBe('Sep 9');
  });

  it('rolls monthly tasks into the next month', () => {
    expect(nextRecurringTaskDue('Sep 15', 'Monthly', anchor)).toBe('Oct 15');
    expect(localIso(resolveTaskDate('2026-09-10', anchor))).toBe('2026-09-10');
  });
});

describe('task due labels', () => {
  const today = new Date('2026-11-05T09:00:00');

  it('works the label out from the real date, not the saved text', () => {
    expect(taskDueLabel('2026-11-04', today)).toBe('Overdue');
    expect(taskDueLabel('2026-11-05', today)).toBe('Today');
    expect(taskDueLabel('2026-11-06', today)).toBe('Tomorrow');
    expect(taskDueLabel('2026-11-20', today)).toBe('Nov 20');
  });

  it('turns a stale "Today" into Overdue and leaves finished tasks alone', () => {
    const stale = { due: 'Today', dueAt: '2026-10-29', status: 'Open' };
    expect(relabelTask(stale, today).due).toBe('Overdue');
    expect(relabelTask({ ...stale, status: 'Completed' }, today).due).toBe('Today');
  });

  it('reads a date picked in December as next year', () => {
    expect(taskDueIso('Jan 3', new Date('2026-12-28T12:00:00'))).toBe('2027-01-03');
  });
});

describe('what counts as today', () => {
  it('uses the person’s timezone, not the server’s', () => {
    const earlyInManila = new Date('2026-11-04T22:30:00Z');
    expect(isoInZone('Asia/Manila', earlyInManila)).toBe('2026-11-05');
    expect(isoInZone('UTC', earlyInManila)).toBe('2026-11-04');
  });

  it('survives an unknown timezone', () => {
    expect(isoInZone('Not/AZone', new Date('2026-11-04T22:30:00Z'))).toBe('2026-11-04');
  });
});
