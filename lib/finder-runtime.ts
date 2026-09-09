import type { FinderJobMessage, FinderRuntimeConfig } from '@/lib/finder-store';

export type FinderEnv = {
  DB: D1Database;
  FINDER_QUEUE?: Queue<FinderJobMessage>;
  AUTH_PROVIDER?: 'cloudflare-access' | 'openai-sites';
  CLOUDFLARE_ACCESS_TEAM_DOMAIN?: string;
  GOOGLE_PLACES_API_KEY?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  FINDER_AI_MONTHLY_BUDGET_USD?: string;
  FINDER_AI_MAX_CANDIDATES?: string;
};

export function finderRuntimeConfig(env: Partial<FinderEnv>): FinderRuntimeConfig {
  const budget = Number(env.FINDER_AI_MONTHLY_BUDGET_USD ?? 2);
  const candidates = Number(env.FINDER_AI_MAX_CANDIDATES ?? 20);
  return {
    googlePlacesApiKey: env.GOOGLE_PLACES_API_KEY,
    geminiApiKey: env.GEMINI_API_KEY,
    geminiModel: env.GEMINI_MODEL || 'gemini-3.1-flash-lite',
    aiMonthlyBudgetUsd: Number.isFinite(budget) ? Math.max(0, budget) : 2,
    aiMaxCandidates: Number.isFinite(candidates) ? Math.max(0, Math.floor(candidates)) : 20,
  };
}
