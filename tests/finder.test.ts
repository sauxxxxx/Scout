import { describe, expect, it } from 'vitest';
import { assessPlace, matchesRequirements } from '@/lib/finder-store';
import { calibrateAssessment, createGeminiProvider, finderAiAssessmentSchema, finderAiInputHash, geminiCostMicroUsd, withinBudget, type FinderAiAssessment, type FinderAiInput } from '@/lib/finder-ai';
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

  it('qualifies a business when any selected contact field is available', () => {
    const phoneOnly = { phone: '+63 917 000 0000', website: '', email: '', socialUrl: '' };
    expect(matchesRequirements(phoneOnly, ['Phone', 'Email'])).toBe(true);
    expect(matchesRequirements(phoneOnly, ['Email', 'Social'])).toBe(false);
  });
});

const aiInput: FinderAiInput = {
  name: 'ABC Dental Clinic', industry: 'Dental clinic', location: 'Cebu City', address: 'Cebu City', phone: '+63 1', email: '', website: 'https://example.com', socialUrl: '', businessStatus: 'OPERATIONAL', rating: 4.6, reviewCount: 40, websiteSummary: 'Family dental clinic', searchIndustry: 'Dental clinics', searchLocation: 'Cebu City', ruleScore: 81, ruleReason: 'operational', evidence: [{ id: 'evidence-1', field: 'business', provider: 'Google Places', sourceUrl: 'https://maps.google.com/' }],
};

const validAssessment: FinderAiAssessment = { classification: 'Dental clinic', icpMatch: 'strong', fitScore: 91, confidence: 'high', explanation: 'Matches the requested industry and location.', opportunitySignals: ['Published website'], concerns: ['No public email'], recommendedNextAction: 'Call the published business number.', evidenceReferences: ['evidence-1'] };

describe('Gemini Finder intelligence', () => {
  it('validates the structured assessment and rejects malformed output', () => {
    expect(finderAiAssessmentSchema.safeParse(validAssessment).success).toBe(true);
    expect(finderAiAssessmentSchema.safeParse({ ...validAssessment, fitScore: 101 }).success).toBe(false);
  });

  it('returns no provider without a key and enforces budget math', () => {
    expect(createGeminiProvider(undefined)).toBeUndefined();
    expect(geminiCostMicroUsd(1000, 100)).toBe(400);
    expect(withinBudget(1_999_000, 1_000, 2_000_000)).toBe(true);
    expect(withinBudget(1_999_001, 1_000, 2_000_000)).toBe(false);
  });

  it('uses stable hashes for cache and deduplication', async () => {
    await expect(finderAiInputHash(aiInput)).resolves.toBe(await finderAiInputHash({ ...aiInput }));
  });

  it('calibrates confident model scores against the collected evidence', () => {
    const sparse = calibrateAssessment({ ...aiInput, website: '', websiteSummary: '', email: '', socialUrl: '', rating: undefined, reviewCount: 0 }, validAssessment);
    const evidenced = calibrateAssessment({ ...aiInput, email: 'hello@example.com', socialUrl: 'https://facebook.com/example', reviewCount: 500 }, validAssessment);
    expect(sparse.fitScore).toBeLessThan(evidenced.fitScore);
    expect(sparse.confidence).toBe('medium');
    expect(sparse.concerns).toContain('No business website was found.');
  });

  it('parses structured Gemini output and records tokens', async () => {
    const fetcher = async () => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(validAssessment) }] } }], usageMetadata: { promptTokenCount: 320, candidatesTokenCount: 80 } });
    const result = await createGeminiProvider('test-key', 'gemini-test', fetcher as typeof fetch)!.assess(aiInput);
    expect(result.assessment.fitScore).toBe(91);
    expect(result.promptTokens).toBe(320);
  });

  it('rejects invented evidence references', async () => {
    const fetcher = async () => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ ...validAssessment, evidenceReferences: ['invented'] }) }] } }] });
    await expect(createGeminiProvider('test-key', 'gemini-test', fetcher as typeof fetch)!.assess(aiInput)).rejects.toThrow('not supplied');
  });

  it('retries retryable provider responses but not malformed JSON', async () => {
    let attempts = 0;
    const retrying = async () => { attempts += 1; return attempts === 1 ? new Response('', { status: 429 }) : Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(validAssessment) }] } }] }); };
    await createGeminiProvider('test-key', 'gemini-test', retrying as typeof fetch)!.assess(aiInput);
    expect(attempts).toBe(2);
    const malformed = async () => Response.json({ candidates: [{ content: { parts: [{ text: '{bad' }] } }] });
    await expect(createGeminiProvider('test-key', 'gemini-test', malformed as typeof fetch)!.assess(aiInput)).rejects.toThrow('malformed JSON');
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
