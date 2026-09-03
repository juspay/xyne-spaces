export type ClawMetricsDays = 1 | 7 | 30;
export type AdminOrgScope = 'org' | 'all';

export interface SlowSessionToolRow {
  tool: string;
  ms: number;
  calls: number;
  isError: boolean;
}

export interface SlowSession {
  sessionId: string;
  agentSlug: string;
  totalMs: number | null;
  llmTotalMs: number | null;
  toolMs: number | null;
  completedAt: string;
  task: string | null;
  topTools: SlowSessionToolRow[];
}

export interface GlobalMetricsDayBucket {
  day: string;
  runs: number;
  completed: number;
  failed: number;
  cancelled: number;
  p50TotalMs: number | null;
  p95TotalMs: number | null;
  avgLlmMs: number | null;
  avgToolMs: number | null;
  errorRate: number;
}

export interface GlobalMetricsAgentRow {
  agentSlug: string;
  orgId?: string | null;
  orgName?: string | null;
  runs: number;
  p50TotalMs: number | null;
  p95TotalMs: number | null;
  avgLlmMs: number | null;
  avgToolMs: number | null;
  errorRate: number;
}

export interface GlobalMetricsProviderRow {
  provider: string;
  model: string | null;
  runs: number;
  p50LlmMs: number | null;
  p95LlmMs: number | null;
  p50TtftMs: number | null;
  p95TtftMs: number | null;
  avgTokensPerSec: number | null;
  errorRate: number;
}

export interface MetricsTotals {
  runs: number;
  completed: number;
  failed: number;
  cancelled: number;
  p50TotalMs: number | null;
  p95TotalMs: number | null;
  avgLlmMs: number | null;
  avgToolMs: number | null;
  errorRate: number;
}

export interface MetricsDelta {
  runs: number;
  p50TotalMs: number | null;
  p95TotalMs: number | null;
  errorRate: number;
}

export interface BotCommitAnalyticsRow {
  agentSlug: string;
  mergedPRs: number;
  totalCommits: number;
}

export interface BotCommitAnalytics {
  rows: BotCommitAnalyticsRow[];
  totalAnalyzed: number;
  totalPending: number;
  totalFailed: number;
}

export interface GlobalMetrics {
  days: number;
  windowStart: string;
  windowEnd: string;
  totals: MetricsTotals;
  delta: MetricsDelta;
  perDay: GlobalMetricsDayBucket[];
  topAgents: GlobalMetricsAgentRow[];
  byProvider: GlobalMetricsProviderRow[];
  slowSessions: SlowSession[];
}

export interface SentimentComment {
  sessionId: string;
  rating: 'up' | 'down';
  comment: string;
  completedAt: string;
}

export interface AgentSentiment {
  totalRuns: number;
  ratingUp: number;
  ratingDown: number;
  ratingTotal: number;
  ratingRatio: number | null;
  cancelledRate: number;
  failedRate: number;
  retriedRate: number;
  apologeticRate: number;
  recentComments: SentimentComment[];
}

export interface ToolLatencyRow {
  tool: string;
  calls: number;
  errors: number;
  avgMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  totalMs: number;
}

export interface AgentMetrics {
  agentSlug: string;
  days: number;
  windowStart: string;
  windowEnd: string;
  totals: MetricsTotals & {
    avgTurns: number | null;
    avgTokensPerSec: number | null;
  };
  delta: MetricsDelta;
  perDay: GlobalMetricsDayBucket[];
  slowSessions: SlowSession[];
  toolLatency: ToolLatencyRow[];
  sentiment: AgentSentiment;
}

export type ImprovementBucket = 'agent_unable_to_do_work' | 'failure' | 'user_frustrated';

export type ImprovementRootCause =
  | 'need-memory'
  | 'missing-tool'
  | 'prompt-ambiguity'
  | 'wrong-subagent'
  | 'redundant-subagent-call'
  | 'tool-misuse'
  | 'ext-api-failure'
  | 'permission-denied'
  | 'memory-miss'
  | 'identity-bleed'
  | 'no-actionable';

export type ImprovementFixType =
  | 'prompt-edit'
  | 'add-memory'
  | 'add-tool'
  | 'remove-tool'
  | 'tighten-subagent'
  | 'investigate'
  | 'ops';

export interface ImprovementCandidate {
  id: string;
  bucket: ImprovementBucket;
  rootCause: ImprovementRootCause;
  finding: string;
  evidence: string[];
  proposedFix: { type: ImprovementFixType; description: string };
  confidence: 'high' | 'medium' | 'low';
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
}
