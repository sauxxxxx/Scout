import { describe, expect, it } from 'vitest';
import { phoneKey } from '@/lib/phone';

describe('comparing phone numbers', () => {
  it('treats the usual Philippine ways of writing one number as the same', () => {
    const key = phoneKey('0917 123 4567');
    expect(key).toBe('639171234567');
    for (const written of ['+63 917-123-4567', '639171234567', '(0917) 123-4567', '+639171234567', '00639171234567']) expect(phoneKey(written)).toBe(key);
  });

  it('matches landlines with and without the leading zero', () => {
    expect(phoneKey('(032) 123 4567')).toBe(phoneKey('+63 32 123 4567'));
  });

  it('ignores extensions and refuses numbers too short to compare', () => {
    expect(phoneKey('+63 32 123 4567 loc. 12')).toBe(phoneKey('+63 32 123 4567'));
    expect(phoneKey('123')).toBe('');
    expect(phoneKey('')).toBe('');
    expect(phoneKey(undefined)).toBe('');
  });

  it('uses the lead’s own country code', () => {
    expect(phoneKey('6123 4567', 'SG')).toBe('6561234567');
    expect(phoneKey('+65 6123 4567', 'PH')).toBe('6561234567');
  });
});
