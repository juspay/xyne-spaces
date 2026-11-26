import { clawRequest } from './clawRequest';

// Shapes mirror apps/xyne-claw-auth/backend/src/lib/llm-usage.ts.

export interface UsageTotals {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  calls: number;
  runs: number;
  sessions: number;
  users: number;
  agents: number;
  /** Calls whose provider reported no usage; never estimated. */
  callsWithoutUsage: number;
  /** API-key calls with no price row; their cost is null, not 0. */
  unpricedCalls: number;
}

export type KeyedTotals = UsageTotals & { key: string };

/** Tokens one price (or one of its slabs) was charged at, within the range. */
export interface RateGroup {
  provider: string;
  model: string;
  /** 0 for the base rates. */
  overPromptTokens: number;
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number;
  cacheWritePerMTok: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  calls: number;
}

export interface UsageSummary {
  scope: { level: 'org' | 'own'; isAdmin: boolean };
  range: { from: string; to: string };
  totals: UsageTotals;
  previous: UsageTotals;
  byBilling: KeyedTotals[];
  /** Priced tokens by the rates they were charged at; calls with no price add tokens only. */
  costSplit: { rates: RateGroup[]; uncostedCalls: number; uncostedTokens: number };
}

export type GroupBy = 'agent' | 'user' | 'model' | 'provider' | 'ticket' | 'session' | 'pr';

export const OTHER_KEY = '__other__';

export interface SeriesPoint {
  day: string;
  key: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  calls: number;
}

export interface UsageSeries {
  days: string[];
  groupBy: GroupBy;
  /** Top keys by cost, then OTHER_KEY when more groups exist. */
  keys: Array<{ key: string; label: string }>;
  /** Missing day/key pairs are zero. */
  points: SeriesPoint[];
}

export interface BreakdownRow extends UsageTotals {
  key: string;
  label: string;
  sublabel?: string;
  /** user rows */
  spacesUserId?: string;
  firstAt: string;
  lastAt: string;
  /** session rows */
  peakContextTokens?: number;
  agentSlug?: string;
  userId?: string;
  /** pr rows */
  prUrl?: string;
  prStatus?: string;
  /** pr rows: PRs bound to the same session all show that session's cost. */
  prsInSession?: number;
}

export interface UsageBreakdown {
  groupBy: GroupBy;
  rows: BreakdownRow[];
  total: number;
  totals: UsageTotals;
}

export type BreakdownSort =
  | 'costUsd'
  | 'totalTokens'
  | 'calls'
  | 'runs'
  | 'sessions'
  | 'lastAt'
  | 'label';

export interface SessionCall {
  id: string;
  startedAt: string;
  durationMs: number;
  runId: string | null;
  purpose: string;
  subagent: string | null;
  provider: string;
  billing: string;
  model: string;
  servedModel: string | null;
  outcome: string;
  usageReported: boolean;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  contextTokens: number;
  /** null = subscription or unpriced API key. */
  costUsd: number | null;
  cumulativeCostUsd: number;
  toolNames: string[];
}

export interface SessionTimeline {
  conversationId: string;
  label: string | null;
  totals: UsageTotals;
  runs: Array<{ runId: string; agentSlug: string }>;
  calls: SessionCall[];
  truncated: boolean;
}

export interface ToolUsageRow {
  tool: string;
  /** Calls that read this tool's results and no other tool's. */
  soloCalls: number;
  /** Calls that read this tool's results together with other tools'. */
  sharedCalls: number;
  /** Exact context growth of solo calls. */
  soloContextTokens: number;
  maxSoloContextTokens: number;
}

export interface UsageOptions {
  agents: Array<{ key: string; label: string }>;
  users: Array<{ key: string; label: string; sublabel?: string; spacesUserId?: string }>;
}

export interface UnpricedModel {
  provider: string;
  model: string;
  serviceTier: string;
  billing: string;
  calls: number;
  totalTokens: number;
}

/** Prisma Decimals arrive as strings. */
export interface ModelPrice {
  id: string;
  provider: string;
  model: string;
  serviceTier: string;
  inputPerMTok: string;
  outputPerMTok: string;
  cacheReadPerMTok: string;
  cacheWritePerMTok: string;
  effectiveFrom: string;
  updatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  /** Rates for requests whose prompt is over `overPromptTokens`, lowest first. */
  slabs: PriceSlab[];
}

export interface PriceSlab {
  overPromptTokens: number;
  inputPerMTok: string;
  outputPerMTok: string;
  cacheReadPerMTok: string;
  cacheWritePerMTok: string;
}

export type PriceRates = Pick<
  ModelPrice,
  'inputPerMTok' | 'outputPerMTok' | 'cacheReadPerMTok' | 'cacheWritePerMTok'
> & {
  /** Missing on changes recorded before slabs existed. */
  slabs?: PriceSlab[];
};

/** One audited price change; `before` is null for an added price, `after` for a deleted one. */
export interface PriceChange {
  id: string;
  eventType: 'LLM_PRICE_CREATED' | 'LLM_PRICE_UPDATED' | 'LLM_PRICE_DELETED';
  createdAt: string;
  actor: { name: string; email: string } | null;
  provider: string;
  model: string;
  serviceTier: string;
  effectiveFrom: string;
  before: PriceRates | null;
  after: PriceRates | null;
  repricedCalls: number;
}

export interface UsagePrices {
  canEdit: boolean;
  prices: ModelPrice[];
  /** null when the viewer isn't an admin. */
  unpriced: UnpricedModel[] | null;
  /** null when the viewer isn't an admin. */
  history: PriceChange[] | null;
}

export interface PriceInput {
  provider: string;
  model: string;
  serviceTier?: string;
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number;
  cacheWritePerMTok: number;
  effectiveFrom?: string;
  slabs: Array<{
    overPromptTokens: number;
    inputPerMTok: number;
    outputPerMTok: number;
    cacheReadPerMTok: number;
    cacheWritePerMTok: number;
  }>;
}

export const PURPOSE_LABELS: Record<string, string> = {
  main: 'Agent turns',
  subagent: 'Subagents',
  compaction: 'Compaction',
  title: 'Chat titles',
  follow_up: 'Follow-up suggestions',
  judge: 'Judges',
  verify: 'Answer verification',
  prefetch: 'Prefetch',
  twin_gate: 'Twin reply gate',
  curator: 'Memory curation',
  entity: 'Entity extraction',
  routing: 'Routing cards',
  video: 'Video understanding',
  triage: 'Inbox triage',
  probe: 'Provider checks',
  prompt_tools: 'Prompt and tool suggestions',
  eval: 'Evals',
  xor: 'Decision checks',
};

export const BILLING_LABELS: Record<string, string> = {
  platform: 'Platform (hosted)',
  api_key: 'API key',
  subscription: 'Subscription',
};

export const labelFor = (labels: Record<string, string>, key: string): string => labels[key] ?? key;

export interface UsageFilterParams {
  from: string;
  to: string;
  tz: string;
  agents: string[];
  users: string[];
  models: string[];
  providers: string[];
  tickets: string[];
}

const BASE = '/api/v1/usage';
const USER_ID_HEADER = 'x-user-id';

const query = (
  params: Partial<UsageFilterParams>,
  extra: Record<string, string | number | undefined> = {},
): string => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) {
      if (v.length > 0) sp.set(k, v.join(','));
    } else if (v) sp.set(k, v);
  }
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== '') sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : '';
};

const get = <T>(userId: string, path: string): Promise<T> =>
  clawRequest<T>(`${BASE}${path}`, { headers: { [USER_ID_HEADER]: userId } });

export const fetchUsageSummary = (userId: string, p: UsageFilterParams): Promise<UsageSummary> =>
  get(userId, `/summary${query(p)}`);

export const fetchUsageSeries = (
  userId: string,
  p: UsageFilterParams,
  groupBy: GroupBy,
  metric: 'cost' | 'tokens',
  top = 5,
): Promise<UsageSeries> => get(userId, `/series${query(p, { groupBy, metric, top })}`);

export interface BreakdownOptions {
  groupBy: GroupBy;
  sort?: BreakdownSort | undefined;
  dir?: 'asc' | 'desc' | undefined;
  q?: string | undefined;
  limit: number;
  offset: number;
}

export const fetchUsageBreakdown = (
  userId: string,
  p: UsageFilterParams,
  o: BreakdownOptions,
): Promise<UsageBreakdown> =>
  get(
    userId,
    `/breakdown${query(p, { groupBy: o.groupBy, sort: o.sort, dir: o.dir, q: o.q, limit: o.limit, offset: o.offset })}`,
  );

export async function fetchAllBreakdownRows(
  userId: string,
  p: UsageFilterParams,
  o: Omit<BreakdownOptions, 'limit' | 'offset'>,
): Promise<BreakdownRow[]> {
  const rows: BreakdownRow[] = [];
  for (let offset = 0; offset < 20_000; offset += 500) {
    const page = await fetchUsageBreakdown(userId, p, { ...o, limit: 500, offset });
    rows.push(...page.rows);
    if (rows.length >= page.total || page.rows.length === 0) break;
  }
  return rows;
}

export const fetchUsageSession = (
  userId: string,
  conversationId: string,
  p: Pick<UsageFilterParams, 'tz'>,
): Promise<SessionTimeline> =>
  get(userId, `/sessions/${encodeURIComponent(conversationId)}${query(p)}`);

export const fetchUsageTools = (
  userId: string,
  p: UsageFilterParams,
): Promise<{ rows: ToolUsageRow[] }> => get(userId, `/tools${query(p)}`);

export const fetchUsageOptions = (
  userId: string,
  p: Pick<UsageFilterParams, 'from' | 'to' | 'tz'>,
): Promise<UsageOptions> => get(userId, `/options${query(p)}`);

export const fetchUsagePrices = (userId: string): Promise<UsagePrices> => get(userId, '/prices');

export const saveUsagePrice = (
  userId: string,
  input: PriceInput,
): Promise<{ price: ModelPrice; repriced: number }> =>
  clawRequest(`${BASE}/prices`, {
    method: 'PUT',
    headers: { [USER_ID_HEADER]: userId },
    body: JSON.stringify(input),
  });

export const deleteUsagePrice = (userId: string, id: string): Promise<{ repriced: number }> =>
  clawRequest(`${BASE}/prices/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { [USER_ID_HEADER]: userId },
  });
