import { describe, expect, it } from 'vitest';
import { periodRange } from '@/lib/overview-period';
import { zoneModifier, validDay } from '@/lib/report-store';
import { activityField, addCounts, customRange, daysBetween, emptyCounts, firstProposals, hasActivity, isReportMetric, reportBuckets, reportSummary, reportTable, type DayReport, type Report } from '@/lib/reports';

const day = (date: string, counts: Partial<DayReport> = {}): DayReport => ({ ...emptyCounts, day: date, ...counts });

describe('what counts as what', () => {
  it('treats callbacks as calls and leaves other work alone', () => {
    expect(activityField('Call')).toBe('calls');
    expect(activityField('callback')).toBe('calls');
    expect(activityField('Email')).toBe('emails');
    expect(activityField('Meeting')).toBe('meetings');
    expect(activityField('Note')).toBe('notes');
    expect(activityField('Assignment')).toBeNull();
    expect(activityField('Status change')).toBeNull();
  });

  it('counts one proposal once when it was logged and the deal also moved', () => {
    const rows = [{ item: 'lead-a', day: '2026-11-03', owner: 'Ben' }, { item: 'lead-a', day: '2026-11-03', owner: 'Ben' }, { item: 'lead-b', day: '2026-11-04', owner: 'Cara' }];
    expect(firstProposals(rows)).toHaveLength(2);
  });

  it('keeps the earliest day for a proposal seen twice in a period', () => {
    const rows = [{ item: 'lead-a', day: '2026-11-05' }, { item: 'lead-a', day: '2026-11-02' }];
    expect(firstProposals(rows)).toEqual([{ item: 'lead-a', day: '2026-11-02' }]);
  });

  it('adds counts without losing money', () => {
    const total = { ...emptyCounts };
    addCounts(total, { calls: 2, wonValue: 500 });
    addCounts(total, { calls: 1, wonValue: 250 });
    expect(total).toMatchObject({ calls: 3, wonValue: 750 });
    expect(emptyCounts.calls).toBe(0);
  });

  it('knows when there is nothing to show', () => {
    expect(hasActivity(emptyCounts)).toBe(false);
    expect(hasActivity({ ...emptyCounts, notes: 1 })).toBe(true);
  });

  it('only accepts real metrics', () => {
    expect(isReportMetric('calls')).toBe(true);
    expect(isReportMetric('passwords')).toBe(false);
    expect(isReportMetric(null)).toBe(false);
  });
});

describe('date ranges', () => {
  it('compares a chosen range with the same number of days before it', () => {
    expect(customRange('2026-11-10', '2026-11-16')).toMatchObject({ previousFrom: '2026-11-03', previousTo: '2026-11-09' });
    expect(customRange('2026-11-10', '2026-11-10')).toMatchObject({ previousFrom: '2026-11-09', previousTo: '2026-11-09', previousLabel: 'the day before' });
  });

  it('counts both ends of a range', () => {
    expect(daysBetween('2026-11-01', '2026-11-01')).toBe(1);
    expect(daysBetween('2026-11-01', '2026-11-30')).toBe(30);
  });

  it('crosses a month and year correctly', () => {
    expect(customRange('2027-01-01', '2027-01-02')).toMatchObject({ previousFrom: '2026-12-30', previousTo: '2026-12-31' });
  });

  it('turns a rep timezone into a database offset', () => {
    expect(zoneModifier('Asia/Manila')).toBe('+480 minutes');
    expect(zoneModifier('UTC')).toBe('+0 minutes');
  });

  it('accepts only plain dates', () => {
    expect(validDay('2026-11-06')).toBe(true);
    for (const value of ['2026-11-6', "2026-11-06' OR 1=1", '', null]) expect(validDay(value)).toBe(false);
  });
});

describe('report rows', () => {
  it('shows days for a month, weeks for a quarter, and months for a year', () => {
    const week = periodRange('Weekly', '2026-11-06');
    expect(reportBuckets(week.from, week.to, [])).toHaveLength(7);
    const month = periodRange('Monthly', '2026-11-06');
    expect(reportBuckets(month.from, month.to, [])).toHaveLength(30);
    const quarter = periodRange('Quarterly', '2026-11-06');
    const weeks = reportBuckets(quarter.from, quarter.to, []);
    expect(weeks.length).toBeGreaterThanOrEqual(13);
    expect(weeks.length).toBeLessThanOrEqual(14);
    expect(weeks[0].label).toMatch(/^Week of/);
    expect(reportBuckets('2026-01-01', '2026-12-31', [])).toHaveLength(12);
  });

  it('puts each day into its bucket without dropping any', () => {
    const buckets = reportBuckets('2026-01-01', '2026-12-31', [day('2026-01-31', { calls: 2 }), day('2026-02-01', { calls: 3 }), day('2026-12-31', { proposals: 1 })]);
    expect(buckets[0].calls).toBe(2);
    expect(buckets[1].calls).toBe(3);
    expect(buckets[11].proposals).toBe(1);
  });

  it('gives each bucket the dates that open its records', () => {
    const [first, second] = reportBuckets('2026-01-14', '2026-03-31', []);
    expect(first).toMatchObject({ from: '2026-01-14', to: '2026-01-18' });
    expect(second).toMatchObject({ from: '2026-01-19', to: '2026-01-25' });
  });

  const report: Report = {
    current: { ...emptyCounts, calls: 5, wonValue: 900 }, previous: emptyCounts,
    byRep: [{ ...emptyCounts, name: 'Ben Cruz', calls: 3, wonValue: 900 }, { ...emptyCounts, name: 'Cara Dizon', calls: 2 }],
    byDay: [day('2026-11-02', { calls: 5, wonValue: 900 })],
  };

  it('builds an export by rep with a total', () => {
    const table = reportTable(report, 'rep', '2026-11-02', '2026-11-08');
    expect(table.headers).toEqual(['Rep', 'Prospects', 'Calls', 'Emails', 'Meetings', 'Follow-ups', 'Proposals', 'Deals won', 'Revenue']);
    expect(table.rows[0]).toEqual(['Ben Cruz', 0, 3, 0, 0, 0, 0, 0, 900]);
    expect(table.rows.at(-1)).toEqual(['Total', 0, 5, 0, 0, 0, 0, 0, 900]);
  });

  it('leaves quiet days out of an export over time', () => {
    const table = reportTable(report, 'day', '2026-11-02', '2026-11-08');
    expect(table.headers[0]).toBe('Period');
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0][2]).toBe(5);
  });
});

describe('report summary', () => {
  const money = (value: number) => `₱${value}`;
  it('says what happened in one sentence', () => {
    expect(reportSummary({ ...emptyCounts, calls: 12, proposals: 1, wonCount: 2, wonValue: 900 }, emptyCounts, 'October', 'The team', money).headline).toBe('The team made 12 calls and 1 proposal, and won 2 deals worth ₱900.');
    expect(reportSummary({ ...emptyCounts, calls: 1 }, emptyCounts, 'October', 'You', money).headline).toBe('You made 1 call.');
    expect(reportSummary({ ...emptyCounts, wonCount: 1, wonValue: 50 }, emptyCounts, 'October', 'Ben Cruz', money).headline).toBe('Ben Cruz won 1 deal worth ₱50.');
    expect(reportSummary({ ...emptyCounts, newLeads: 3 }, emptyCounts, 'October', 'You', money).headline).toBe('You added 3 prospects.');
    expect(reportSummary(emptyCounts, emptyCounts, 'October', 'You', money).headline).toBe('Nothing recorded for this period yet.');
  });

  it('points out the biggest change, and never divides by nothing', () => {
    const previous = { ...emptyCounts, calls: 10, followUps: 10 };
    expect(reportSummary({ ...emptyCounts, calls: 11, followUps: 5 }, previous, 'October', 'You', money).detail).toBe('Follow-ups are down 50% from October.');
    expect(reportSummary({ ...emptyCounts, calls: 5 }, emptyCounts, 'October', 'You', money).detail).toBe('');
    expect(reportSummary({ ...emptyCounts, calls: 10 }, { ...emptyCounts, calls: 10 }, 'October', 'You', money).detail).toBe('');
  });
});
