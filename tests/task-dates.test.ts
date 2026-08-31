import { describe, expect, it } from 'vitest';
import { nextRecurringTaskDue, resolveTaskDate } from '@/lib/task-dates';

describe('task recurrence dates', () => {
  const anchor = new Date('2026-08-31T12:00:00');

  it('creates the next daily and weekly occurrence', () => {
    expect(nextRecurringTaskDue('Today', 'Daily', anchor)).toBe('Tomorrow');
    expect(nextRecurringTaskDue('Sep 2', 'Weekly', anchor)).toBe('Sep 9');
  });

  it('rolls monthly tasks into the next month', () => {
    expect(nextRecurringTaskDue('Sep 15', 'Monthly', anchor)).toBe('Oct 15');
    expect(resolveTaskDate('2026-09-10', anchor).toISOString().slice(0, 10)).toBe('2026-09-10');
  });
});
