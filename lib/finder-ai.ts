import { z } from 'zod';

export const finderAiAssessmentSchema = z.object({
  classification: z.string().trim().min(1).max(80),
  icpMatch: z.enum(['strong', 'moderate', 'weak', 'unknown']),
  fitScore: z.number().int().min(0).max(100),
  confidence: z.enum(['high', 'medium', 'low']),
  explanation: z.string().trim().min(1).max(500),
  opportunitySignals: z.array(z.string().trim().min(1).max(180)).max(6),
  concerns: z.array(z.string().trim().min(1).max(180)).max(6),
  recommendedNextAction: z.string().trim().min(1).max(240),
  evidenceReferences: z.array(z.string().trim().min(1).max(80)).max(12),
}).strict();

export type FinderAiAssessment = z.infer<typeof finderAiAssessmentSchema>;
export type FinderAiStatus = 'pending' | 'running' | 'complete' | 'cached' | 'failed' | 'skipped' | 'budget_limited';

export type FinderAiInput = {
  name: string;
  industry: string;
  location: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  socialUrl: string;
  businessStatus?: string;
  rating?: number;
  reviewCount?: number;
  websiteSummary: string;
  searchIndustry: string;
  searchLocation: string;
  ruleScore: number;
  ruleReason: string;
  evidence: Array<{ id: string; field: string; provider: string; sourceUrl: string }>;
};

export type AiProviderResult = {
  assessment: FinderAiAssessment;
  promptTokens: number;
  outputTokens: number;
};

export interface FinderAiProvider {
  readonly model: string;
  assess(input: FinderAiInput): Promise<AiProviderResult>;
}

export class FinderAiProviderError extends Error {
  constructor(message: string, readonly retryable: boolean) { super(message); }
}

const assessmentJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['classification', 'icpMatch', 'fitScore', 'confidence', 'explanation', 'opportunitySignals', 'concerns', 'recommendedNextAction', 'evidenceReferences'],
  properties: {
    classification: { type: 'string' },
    icpMatch: { type: 'string', enum: ['strong', 'moderate', 'weak', 'unknown'] },
    fitScore: { type: 'integer', minimum: 0, maximum: 100 },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    explanation: { type: 'string' },
    opportunitySignals: { type: 'array', maxItems: 6, items: { type: 'string' } },
    concerns: { type: 'array', maxItems: 6, items: { type: 'string' } },
    recommendedNextAction: { type: 'string' },
    evidenceReferences: { type: 'array', maxItems: 12, items: { type: 'string' } },
  },
};

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

export async function finderAiInputHash(input: FinderAiInput) {
  const bytes = new TextEncoder().encode(stable(input));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join('');
}

export function geminiCostMicroUsd(promptTokens: number, outputTokens: number) {
  return Math.ceil(promptTokens * 0.25 + outputTokens * 1.5);
}

export function withinBudget(currentMicroUsd: number, reservationMicroUsd: number, limitMicroUsd: number) {
  return currentMicroUsd + reservationMicroUsd <= limitMicroUsd;
}

function unique(values: string[]) {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

/**
 * Keeps Gemini's judgement useful without allowing a confident model response to
 * overpower the public evidence Scout actually collected.
 */
export function calibrateAssessment(input: FinderAiInput, assessment: FinderAiAssessment): FinderAiAssessment {
  const ratingAdjustment = input.rating == null ? -2 : Math.max(-4, Math.min(3, Math.round((input.rating - 4) * 4)));
  const reviewAdjustment = input.reviewCount == null || input.reviewCount === 0 ? -6
    : input.reviewCount < 10 ? -4
      : input.reviewCount < 25 ? -2
        : input.reviewCount >= 500 ? 3
          : input.reviewCount >= 100 ? 2 : 0;
  const evidenceAdjustment = (input.phone ? 2 : -12)
    + (input.website ? 2 : -3)
    + (input.email ? 2 : 0)
    + (input.socialUrl ? 1 : 0)
    + (input.websiteSummary ? 1 : 0);
  let fitScore = Math.round(input.ruleScore * 0.45 + assessment.fitScore * 0.55 + ratingAdjustment + reviewAdjustment + evidenceAdjustment);
  if (input.businessStatus && input.businessStatus !== 'OPERATIONAL') fitScore = Math.min(fitScore, 58);
  if (!input.phone) fitScore = Math.min(fitScore, 64);
  fitScore = Math.max(0, Math.min(96, fitScore));

  const evidenceCount = [input.phone, input.website, input.email, input.socialUrl].filter(Boolean).length;
  const confidence = evidenceCount >= 3 && Boolean(input.websiteSummary)
    ? assessment.confidence
    : assessment.confidence === 'high' ? 'medium' : assessment.confidence;
  const icpMatch = fitScore >= 82
    ? (assessment.icpMatch === 'weak' || assessment.icpMatch === 'unknown' ? 'moderate' : assessment.icpMatch)
    : fitScore >= 68 ? 'moderate' : 'weak';
  const evidenceConcerns = [
    !input.phone ? 'No public business phone was found.' : '',
    !input.website ? 'No business website was found.' : '',
    !input.email ? 'No public business email was found.' : '',
    input.rating == null ? 'Google rating is unavailable.' : '',
  ];

  return {
    ...assessment,
    fitScore,
    confidence,
    icpMatch,
    concerns: unique([...assessment.concerns, ...evidenceConcerns]).slice(0, 6),
  };
}

const delay = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

export function createGeminiProvider(apiKey: string | undefined, model = 'gemini-3.1-flash-lite', fetcher: typeof fetch = fetch): FinderAiProvider | undefined {
  if (!apiKey?.trim()) return undefined;
  return {
    model,
    async assess(input) {
      const allowedEvidence = new Set(input.evidence.map(item => item.id));
      const body = {
        systemInstruction: { parts: [{ text: 'You qualify sales prospects for Scout CRM. Use only the supplied facts. Never infer or invent contact data, company facts, or evidence. Unknown facts must remain unknown. Differentiate scores: 82-100 is a strong, well-evidenced fit; 68-81 is promising but needs validation; below 68 is weak or poorly evidenced. A missing website may be a sales opportunity, but is not proof of customer fit. Confidence must reflect evidence coverage. Return only the requested JSON.' }] },
        contents: [{ role: 'user', parts: [{ text: `Assess this business against the search industry and location. Explain the strongest verified signals and material gaps, recommend one concrete next action, and use only supplied evidence IDs.\n${JSON.stringify(input)}` }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 500, responseMimeType: 'application/json', responseJsonSchema: assessmentJsonSchema },
      };
      let lastError: unknown;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const response = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
            method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify(body), signal: AbortSignal.timeout(12_000),
          });
          if (!response.ok) {
            const retryable = response.status === 429 || response.status >= 500;
            throw new FinderAiProviderError(`Gemini returned ${response.status}.`, retryable);
          }
          const data = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } };
          const text = data.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('').trim();
          if (!text || text.length > 20_000) throw new FinderAiProviderError('Gemini returned an empty or oversized assessment.', false);
          let decoded: unknown;
          try { decoded = JSON.parse(text); } catch { throw new FinderAiProviderError('Gemini returned malformed JSON.', false); }
          const assessment = finderAiAssessmentSchema.parse(decoded);
          if (assessment.evidenceReferences.some(reference => !allowedEvidence.has(reference))) throw new FinderAiProviderError('Gemini referenced evidence that was not supplied.', false);
          return { assessment, promptTokens: Number(data.usageMetadata?.promptTokenCount || 0), outputTokens: Number(data.usageMetadata?.candidatesTokenCount || 0) };
        } catch (error) {
          lastError = error;
          const retryable = error instanceof FinderAiProviderError ? error.retryable : error instanceof TypeError || (error instanceof DOMException && error.name === 'TimeoutError');
          if (!retryable || attempt === 2) throw error;
          await delay(250 * 2 ** attempt);
        }
      }
      throw lastError;
    },
  };
}

export function parseAssessment(value: unknown) {
  try { return finderAiAssessmentSchema.parse(typeof value === 'string' ? JSON.parse(value) : value); } catch { return undefined; }
}
