import { describe, expect, it } from 'vitest';
import { hashSessionToken } from '@/lib/session-auth';

describe('Scout sessions', () => {
  it('hashes session tokens deterministically without storing the raw token', async () => {
    const token = 'a'.repeat(64);
    const first = await hashSessionToken(token);
    expect(first).toBe(await hashSessionToken(token));
    expect(first).not.toContain(token);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });
});
