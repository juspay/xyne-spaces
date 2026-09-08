/**
 * Hook for managing Ask AI v2 sessions via xyne-claw backend.
 *
 * Uses claw conversation APIs (proxied through Spaces backend) instead of
 * the v1 session store. Provides the same interface as useAskAISessions
 * so the sidebar can switch between versions seamlessly.
 */

import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchAllV2Conversations, fetchV2Conversations } from '../services/XyneAI/XyneAISessionsV2Service';

// ============================================================================
// Query Keys
// ============================================================================

const V2_SESSIONS_KEY = (agentSlug?: string | null): readonly string[] =>
  agentSlug ? ['xyne-ai-v2-sessions', agentSlug] : ['xyne-ai-v2-sessions'];
/** Consolidated cross-agent recents. Shares the 'xyne-ai-v2-sessions' prefix so
 *  the existing invalidator (which invalidates by prefix) also refreshes it. */
const V2_ALL_SESSIONS_KEY = ['xyne-ai-v2-sessions', '__all__'] as const;
const ALL_SESSIONS_PAGE_SIZE = 30;
const v2SessionMessagesKey = (convId: string, agentSlug?: string | null): readonly string[] =>
  agentSlug
    ? ['xyne-ai-v2-session', convId, 'messages', agentSlug]
    : ['xyne-ai-v2-session', convId, 'messages'];

// ============================================================================
// Hooks
// ============================================================================

/**
 * List all conversations for the current user from claw.
 * @param agentSlug - Optional agent slug to filter conversations per-agent.
 */
export function useV2SessionsList(agentSlug?: string | null, enabled = true) {
  return useQuery({
    queryKey: V2_SESSIONS_KEY(agentSlug),
    queryFn: () => fetchV2Conversations(agentSlug),
    staleTime: 30_000,
    enabled,
  });
}

/**
 * Consolidated recents: ALL of the user's conversations across every agent,
 * newest first, independent of the composer's selected agent. Paginated via
 * infinite scroll (offset cursor from the backend's `nextOffset`).
 */
export function useV2AllSessionsList(enabled = true) {
  return useInfiniteQuery({
    queryKey: V2_ALL_SESSIONS_KEY,
    queryFn: ({ pageParam }) =>
      fetchAllV2Conversations({ limit: ALL_SESSIONS_PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: lastPage => lastPage.nextOffset ?? undefined,
    staleTime: 30_000,
    enabled,
  });
}

/**
 * Invalidate v2 session lists (call after new chat, etc.)
 * Passing a prefix key invalidates all variations (with or without agentSlug).
 */
export function useV2SessionInvalidator() {
  const queryClient = useQueryClient();

  const invalidateSessions = (agentSlug?: string | null) => {
    void queryClient.invalidateQueries({ queryKey: V2_SESSIONS_KEY(agentSlug) });
    // The consolidated cross-agent list must refresh too. A prefix-only
    // invalidation (no agentSlug) already covers it, but an agent-scoped one
    // (['xyne-ai-v2-sessions', slug]) does not — invalidate __all__ explicitly.
    if (agentSlug) {
      void queryClient.invalidateQueries({ queryKey: V2_ALL_SESSIONS_KEY });
    }
  };

  const invalidateMessages = (convId: string, agentSlug?: string | null) => {
    void queryClient.invalidateQueries({ queryKey: v2SessionMessagesKey(convId, agentSlug) });
  };

  return { invalidateSessions, invalidateMessages };
}
