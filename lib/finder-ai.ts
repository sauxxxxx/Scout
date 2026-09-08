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

const delay = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

export function createGeminiProvider(apiKey: string | undefined, model = 'gemini-3.1-flash-lite', fetcher: typeof fetch = fetch): FinderAiProvider | undefined {
  if (!apiKey?.trim()) return undefined;
  return {
    model,
    async assess(input) {
      const allowedEvidence = new Set(input.evidence.map(item => item.id));
      const body = {
        systemInstruction: { parts: [{ text: 'You qualify sales prospects for Scout CRM. Use only the supplied facts. Never infer or invent contact data, company facts, or evidence. Unknown facts must remain unknown. Return only the requested JSON.' }] },
        contents: [{ role: 'user', parts: [{ text: `Assess this business against the search intent. Evidence references must contain only IDs from evidence.\n${JSON.stringify(input)}` }] }],
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
