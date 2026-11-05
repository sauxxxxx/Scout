import type { FinderResultRecord } from '@/lib/finder-store';

// Spending, usage, provider diagnostics and internal limits stay on the server.
export function publicFinderResult(result: FinderResultRecord) {
  const { aiPromptTokens, aiOutputTokens, aiEstimatedCostUsd, aiError, ...publicResult } = result;
  void aiPromptTokens; void aiOutputTokens; void aiEstimatedCostUsd; void aiError;
  return {
    ...publicResult,
    aiStatus: result.aiStatus === 'budget_limited' ? 'skipped' : result.aiStatus,
    aiError: result.aiStatus === 'failed' ? 'Assessment unavailable. You can retry it.' : undefined,
  };
}
