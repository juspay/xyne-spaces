import type { AgentRun } from './clawRunsTypes';

type UsageRun = Pick<AgentRun, 'tokensIn' | 'tokensOut' | 'tokensCacheRead' | 'tokensCacheWrite'>;

export interface ConversationUsage {
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly tokensCached: number;
  readonly total: number;
  readonly runs: number;
}

export function summarizeConversationRuns(runs: readonly UsageRun[]): ConversationUsage {
  let tokensIn = 0;
  let tokensOut = 0;
  let tokensCached = 0;
  for (const run of runs) {
    tokensIn += run.tokensIn ?? 0;
    tokensOut += run.tokensOut ?? 0;
    tokensCached += (run.tokensCacheRead ?? 0) + (run.tokensCacheWrite ?? 0);
  }
  return { tokensIn, tokensOut, tokensCached, total: tokensIn + tokensOut, runs: runs.length };
}

export function formatTokenCount(count: number): string {
  if (count < 1_000) return String(count);
  if (count < 1_000_000) return `${(count / 1_000).toFixed(count < 10_000 ? 1 : 0)}k`;
  return `${(count / 1_000_000).toFixed(count < 10_000_000 ? 1 : 0)}M`;
}

export function agentScopeLabel(scope: string): string {
  return scope === 'global' ? 'Global' : 'Personal';
}

export type AgentPageTab = 'persona' | 'activity';

export function agentPagePath(slug: string, tab: AgentPageTab): string {
  return `/ai/library/agent/${encodeURIComponent(slug)}?tab=${tab}`;
}
