import { apiInstance } from '../../../services/clients/apiClient';

export interface ThreadSummaryResponse {
  success: boolean;
  content: string;
  cached: boolean;
  /** The messageId this content was actually generated from — lets the client tell a genuinely fresh summary apart from a stale fallback. */
  asOfMessageId: string;
}

/**
 * Fetch (or trigger generation of) the shared thread summary. The backend
 * only makes a fresh LLM call if new messages have landed since the last
 * summary — otherwise it returns the cached one immediately. Resolves to
 * `null` if the backend can't produce a summary for this request.
 */
export async function fetchThreadSummary(
  conversationId: string,
): Promise<ThreadSummaryResponse | null> {
  const res = await apiInstance.get<ThreadSummaryResponse>(
    `/conversations/${conversationId}/summary`,
    {
      validateStatus: status => status === 200 || status === 204,
    },
  );
  if (res.status === 204) {
    return null;
  }
  return res.data;
}

interface ThreadRecommendationResponse {
  success: boolean;
  recommended: boolean;
  /** Whether the thread summary feature is enabled for this channel at all (THREAD_SUMMARY_ENABLED_CHANNELS rollout gate) — false means the header button shouldn't render. */
  enabled: boolean;
  /** Only present when recommended is true — generated in the same request. */
  summary?: ThreadSummaryResponse;
}

export interface ThreadRecommendationResult {
  recommended: boolean;
  enabled: boolean;
  summary: ThreadSummaryResponse | undefined;
}

/**
 * One-time "you were just added" flag, set by the real-time participant-
 * insert side effect (not inferred from lastReadAt/joinedAt timestamps —
 * that broke down for existing participants with a stale-null read state).
 * The backend consumes/clears the flag on read, so this only ever returns
 * `recommended: true` once per genuine add — and bundles the summary content
 * in that same response, so a genuine recommendation never needs a second,
 * separate content fetch.
 */
export async function fetchThreadRecommendation(
  conversationId: string,
): Promise<ThreadRecommendationResult> {
  const res = await apiInstance.get<ThreadRecommendationResponse>(
    `/conversations/${conversationId}/recommendation`,
  );
  return {
    recommended: res.data.recommended,
    enabled: res.data.enabled,
    summary: res.data.summary,
  };
}
