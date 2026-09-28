import { apiInstance } from '../services/clients/apiClient';
import type { RadarRule, RadarRuleCondition } from '@xyne/shared';

interface SuccessEnvelope<T> {
  success: true;
  data: T;
}

export interface RadarFeedItem {
  id: string;
  conversationId: string;
  channelId: string;
  sourceMessageId: string;
  title: string;
  contextSummary: string | null;
  requestedBy: string[];
  pendingOn: string[];
  createdAt: string;
  updatedAt: string;
  /** True when one of THIS viewer's rules mutes it. Decided per read, so
   *  editing a rule re-answers for every item, and it is this viewer's answer
   *  alone — the same item reaches somebody else by their own rules. */
  muted: boolean;
}

export interface RadarThreadCard {
  /** A thread, or a whole DM. Bulk actions address the card through this. */
  scopeKey: string;
  /** Representative conversation only — open an item by its own conversationId. */
  conversationId: string;
  channelId: string;
  threadPreview: string | null;
  lastActivityAt: string | null;
  items: RadarFeedItem[];
}

export interface RadarApplyResult {
  created: number;
  resolved: number;
  reassigned: number;
  dismissed: number;
}

export interface RadarDedupCheck {
  title: string;
  sourceMessageId: string;
  /** Best-matching open item; null when Jev gave no answer. */
  itemId: string | null;
  itemTitle: string | null;
  probability: number | null;
  verdict: 'duplicate' | 'distinct' | 'unscored';
  /** Only on a flagged create the parser was sent back over: what it did. */
  outcome?: 'reassigned' | 'dropped' | 'kept';
}

export interface RadarDedupTrail {
  threshold: number;
  /** Whether the parser was sent back — for a duplicate, a no-op reassign, or both. */
  recalled: boolean;
  checks: RadarDedupCheck[];
}

export interface RadarRunLog {
  id: string;
  conversationId: string;
  gatePassed: boolean;
  gateReason: string;
  windowSize: number;
  parserRan: boolean;
  proposedOps: unknown[] | null;
  validOps: unknown[] | null;
  droppedOps: unknown[] | null;
  applied: { created: number; resolved: number; reassigned: number } | null;
  /** Model's one-sentence read of the window — why these ops, or why none. */
  assessment: string | null;
  /** Jev's duplicate verdict on each create the parser proposed, when the check ran. */
  dedupChecks: RadarDedupTrail | null;
  error: string | null;
  durationMs: number | null;
  createdAt: string;
}

async function unwrap<T>(promise: Promise<{ data: SuccessEnvelope<T> }>): Promise<T> {
  const res = await promise;
  return res.data.data;
}

export function fetchRadarPendingMe(): Promise<RadarThreadCard[]> {
  return unwrap(
    apiInstance.get<SuccessEnvelope<{ threads: RadarThreadCard[] }>>('/radar/feed/pending-me'),
  ).then(d => d.threads);
}

export function fetchRadarWaitingOn(): Promise<RadarThreadCard[]> {
  return unwrap(
    apiInstance.get<SuccessEnvelope<{ threads: RadarThreadCard[] }>>('/radar/feed/waiting-on'),
  ).then(d => d.threads);
}

/** Open items held by anyone but the viewer, whoever asked — the "All" half of
 *  the Others filter. Waiting On is the same feed narrowed to the viewer's own
 *  asks, so the two are never fetched together. */
export function fetchRadarPendingOthers(): Promise<RadarThreadCard[]> {
  return unwrap(
    apiInstance.get<SuccessEnvelope<{ threads: RadarThreadCard[] }>>('/radar/feed/pending-others'),
  ).then(d => d.threads);
}

export interface RadarPendingOthersPageParams {
  page: number;
  mutedPage: number;
  pageSize: number;
  holderIds: string[];
  channelIds: string[];
  createdFrom: Date | null;
  createdTo: Date | null;
}

export interface RadarPendingOthersPage {
  threads: RadarThreadCard[];
  totalThreads: number;
  page: number;
  mutedThreads: RadarThreadCard[];
  mutedTotalThreads: number;
  mutedItemCount: number;
  mutedPage: number;
  /** Unmuted open items left after the filters — the tab's badge. */
  openItemCount: number;
  facets: { holderIds: string[]; channelIds: string[] };
}

/** Pending Others one page at a time, filtered on the server — the feed is
 *  workspace-wide, so it is never shipped whole to be paged in the browser. */
export function fetchRadarPendingOthersPage(
  params: RadarPendingOthersPageParams,
): Promise<RadarPendingOthersPage> {
  return unwrap(
    apiInstance.get<SuccessEnvelope<RadarPendingOthersPage>>('/radar/feed/pending-others', {
      params: {
        page: params.page,
        mutedPage: params.mutedPage,
        pageSize: params.pageSize,
        ...(params.holderIds.length ? { holders: params.holderIds.join(',') } : {}),
        ...(params.channelIds.length ? { channels: params.channelIds.join(',') } : {}),
        ...(params.createdFrom ? { createdFrom: params.createdFrom.toISOString() } : {}),
        ...(params.createdTo ? { createdTo: params.createdTo.toISOString() } : {}),
      },
    }),
  );
}

export interface RadarItemMutation {
  id: string;
  itemId: string;
  op: string;
  actorType: 'llm' | 'manual';
  actorId: string | null;
  sourceMessageId: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

export interface RadarTrailMessage {
  senderId: string;
  senderName: string;
  text: string;
  createdAt: string;
}

export interface RadarItemTrail {
  item: RadarFeedItem & { status: string; resolvedAt: string | null };
  mutations: RadarItemMutation[];
  sourceMessages: Record<string, RadarTrailMessage>;
  threadState: { watermarkCreatedAt: string; watermarkMsgId: string; updatedAt: string } | null;
  latestMessage: { messageId: string; createdAt: string } | null;
  /** The ASKING viewer's answer and the rules behind it — somebody else opening
   *  the same trail gets their own, since rules are per reader. */
  rules: { muted: boolean; matched: RadarRule[] };
}

export function fetchRadarItemTrail(itemId: string): Promise<RadarItemTrail> {
  return unwrap(
    apiInstance.get<SuccessEnvelope<RadarItemTrail>>(
      `/radar/debug/items/${encodeURIComponent(itemId)}`,
    ),
  );
}

export interface RadarMessagePreview {
  messageId: string;
  createdAt: string;
  senderId: string | null;
  text: string;
}

export interface RadarRunsResult {
  runs: RadarRunLog[];
  threadState: { watermarkCreatedAt: string; watermarkMsgId: string; updatedAt: string } | null;
  latestMessage: RadarMessagePreview | null;
  /** The message the watermark sits on — what "processed till" actually means. */
  watermarkMessage: RadarMessagePreview | null;
  /** Every item the thread produced (resolved included) when scoped to one thread. */
  items: Array<{ id: string; title: string; status: string }>;
}

/** Debug is per-thread: the endpoint has no workspace-wide listing. */
export function fetchRadarDebugRuns(conversationId: string): Promise<RadarRunsResult> {
  const query = `?conversationId=${encodeURIComponent(conversationId)}`;
  return unwrap(apiInstance.get<SuccessEnvelope<RadarRunsResult>>(`/radar/debug/runs${query}`));
}

export function resolveRadarItem(itemId: string): Promise<RadarApplyResult> {
  return unwrap(
    apiInstance.post<SuccessEnvelope<RadarApplyResult>>(
      `/radar/items/${encodeURIComponent(itemId)}/resolve`,
    ),
  );
}

export function resolveAllRadarItems(scopeKey: string): Promise<RadarApplyResult> {
  return unwrap(
    apiInstance.post<SuccessEnvelope<RadarApplyResult>>(
      `/radar/threads/${encodeURIComponent(scopeKey)}/resolve-all`,
    ),
  );
}

/** Drops the caller from pendingOn; the item closes only when nobody is left. */
export function dismissRadarItem(itemId: string): Promise<RadarApplyResult> {
  return unwrap(
    apiInstance.post<SuccessEnvelope<RadarApplyResult>>(
      `/radar/items/${encodeURIComponent(itemId)}/dismiss`,
    ),
  );
}

export function dismissAllRadarItems(scopeKey: string): Promise<RadarApplyResult> {
  return unwrap(
    apiInstance.post<SuccessEnvelope<RadarApplyResult>>(
      `/radar/threads/${encodeURIComponent(scopeKey)}/dismiss-all`,
    ),
  );
}

/** A reader's own rules. Always the caller's — the API has no route that reads
 *  anyone else's, so there is no id to pass here. */
export function fetchRadarRules(): Promise<RadarRule[]> {
  return unwrap(apiInstance.get<SuccessEnvelope<{ rules: RadarRule[] }>>('/radar/rules')).then(
    d => d.rules,
  );
}

export function createRadarRule(conditions: RadarRuleCondition[]): Promise<RadarRule> {
  return unwrap(
    apiInstance.post<SuccessEnvelope<{ rule: RadarRule }>>('/radar/rules', { conditions }),
  ).then(d => d.rule);
}

export function updateRadarRule(id: string, conditions: RadarRuleCondition[]): Promise<RadarRule> {
  return unwrap(
    apiInstance.patch<SuccessEnvelope<{ rule: RadarRule }>>(
      `/radar/rules/${encodeURIComponent(id)}`,
      { conditions },
    ),
  ).then(d => d.rule);
}

export function deleteRadarRule(id: string): Promise<void> {
  return unwrap(
    apiInstance.delete<SuccessEnvelope<{ id: string }>>(`/radar/rules/${encodeURIComponent(id)}`),
  ).then(() => undefined);
}
