import { describe, expect, it } from 'vitest';
import { notificationDefaults, parseObject, profileDefaults, profileUpdateSchema } from '@/lib/profile';

describe('Scout profile preferences', () => {
  it('restores defaults when stored profile JSON is invalid', () => {
    expect(parseObject('{invalid', profileDefaults)).toEqual(profileDefaults);
  });

  it('accepts the complete editable profile contract', () => {
    expect(profileUpdateSchema.safeParse({
      name: 'Scout User', jobTitle: 'Sales manager', phone: '+63 917 000 0000', avatarUrl: '', timezone: 'Asia/Manila',
      language: 'English (Philippines)', dateFormat: 'MMM d, yyyy', timeFormat: '12-hour', preferences: profileDefaults, notifications: notificationDefaults,
    }).success).toBe(true);
  });

  it('rejects unsupported Finder defaults', () => {
    expect(profileUpdateSchema.safeParse({
      name: 'Scout User', jobTitle: '', phone: '', avatarUrl: '', timezone: 'Asia/Manila', language: 'English (Philippines)',
      dateFormat: 'MMM d, yyyy', timeFormat: '12-hour', preferences: { ...profileDefaults, finderRadius: 100 }, notifications: notificationDefaults,
    }).success).toBe(false);
  });

  it('accepts uploaded avatar URLs and rejects unsafe schemes and unsupported presets', () => {
    const profile = { name: 'Scout User', jobTitle: '', phone: '', avatarUrl: '/api/profile/photo?key=profiles%2Fuser-1%2Fabc.jpg', timezone: 'Asia/Manila', language: 'English (Philippines)', dateFormat: 'MMM d, yyyy', timeFormat: '12-hour', preferences: profileDefaults, notifications: notificationDefaults };
    expect(profileUpdateSchema.safeParse(profile).success).toBe(true);
    expect(profileUpdateSchema.safeParse({ ...profile, avatarUrl: 'javascript:alert(1)' }).success).toBe(false);
    expect(profileUpdateSchema.safeParse({ ...profile, preferences: { ...profileDefaults, finderRadius: 4 } }).success).toBe(false);
    expect(profileUpdateSchema.safeParse({ ...profile, preferences: { ...profileDefaults, finderLeadCount: 301 } }).success).toBe(false);
  });
});
