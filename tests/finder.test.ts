import { describe, expect, it } from 'vitest';
import { assessPlace } from '@/lib/finder-store';
import { finderImportSchema, finderSearchSchema } from '@/lib/validation';

describe('Finder qualification', () => {
  it('scores a real operational business and explains the opportunity', () => {
    const result = assessPlace({
      id: 'place-1',
      businessStatus: 'OPERATIONAL',
      internationalPhoneNumber: '+63 917 000 0000',
      rating: 4.6,
      userRatingCount: 40,
    });
    expect(result.opportunity).toBe('Website launch');
    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(result.scoreReason).toContain('no website found');
  });
});

describe('Finder input validation', () => {
  it('accepts the supported Google Places result limit', () => {
    expect(finderSearchSchema.safeParse({ action: 'run', industry: 'Dental clinics', location: 'Cebu City', targetCount: 60, requirements: ['Phone'] }).success).toBe(true);
  });

  it('rejects unsupported result counts and empty imports', () => {
    expect(finderSearchSchema.safeParse({ action: 'run', industry: 'Dental clinics', location: 'Cebu City', targetCount: 100, requirements: [] }).success).toBe(false);
    expect(finderImportSchema.safeParse({ action: 'import', searchId: crypto.randomUUID(), resultIds: [], owner: 'Shaun', priority: 'Medium', status: 'New', followUpDate: '2026-09-02' }).success).toBe(false);
  });
});
