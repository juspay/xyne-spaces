/**
 * Hook for managing Ask AI v2 sessions via xyne-claw backend.
 *
 * Uses claw conversation APIs (proxied through Spaces backend) instead of
 * the v1 session store. Provides the same interface as useAskAISessions
 * so the sidebar can switch between versions seamlessly.
 */

import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchV2Conversations } from '../services/XyneAI/XyneAISessionsV2Service';
import type { ConversationHistory } from '../components/Chat/XyneAISidebar/utils/XyneAITypes';

// ============================================================================
// Query Keys
// ============================================================================

const V2_SESSIONS_KEY = (agentSlug?: string | null): readonly string[] =>
  agentSlug ? ['xyne-ai-v2-sessions', agentSlug] : ['xyne-ai-v2-sessions'];
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
 * Invalidate v2 session lists (call after new chat, etc.)
 * Passing a prefix key invalidates all variations (with or without agentSlug).
 */
export function useV2SessionInvalidator() {
  const queryClient = useQueryClient();

  const invalidateSessions = useCallback(
    (agentSlug?: string | null) => {
      void queryClient.invalidateQueries({ queryKey: V2_SESSIONS_KEY(agentSlug) });
    },
    [queryClient],
  );

  const invalidateMessages = useCallback(
    (convId: string, agentSlug?: string | null) => {
      void queryClient.invalidateQueries({ queryKey: v2SessionMessagesKey(convId, agentSlug) });
    },
    [queryClient],
  );

  return { invalidateSessions, invalidateMessages };
}

/**
 * Apply a change to one conversation in the cached list immediately, and hand
 * back a rollback.
 *
 * Rename and pin used to rely on invalidate-then-refetch alone, which made a
 * success wait a round trip and — worse — made a FAILURE look like a
 * successful revert: the refetch returned the server's unchanged row, so the
 * old title reappeared with nothing said. Writing the cache up front and
 * rolling back on error keeps the two outcomes distinguishable.
 */
export function useV2SessionPatcher() {
  const queryClient = useQueryClient();

  const patchSession = useCallback(
    (
      agentSlug: string | null | undefined,
      sessionId: string,
      patch: Partial<ConversationHistory>,
    ): (() => void) => {
      const key = V2_SESSIONS_KEY(agentSlug);
      const previous = queryClient.getQueryData<ConversationHistory[]>(key);
      queryClient.setQueryData<ConversationHistory[]>(key, rows =>
        rows?.map(row => (row.sessionId === sessionId ? { ...row, ...patch } : row)),
      );
      return () => queryClient.setQueryData<ConversationHistory[]>(key, previous);
    },
    [queryClient],
  );

  return { patchSession };
}
