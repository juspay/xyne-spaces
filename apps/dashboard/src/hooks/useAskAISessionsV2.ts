/**
 * Hook for managing Ask AI v2 sessions via xyne-claw backend.
 *
 * Uses claw conversation APIs (proxied through Spaces backend) instead of
 * the v1 session store. Provides the same interface as useAskAISessions
 * so the sidebar can switch between versions seamlessly.
 */

import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { fetchV2Conversations } from '../services/XyneAI/XyneAISessionsV2Service';
import type { ConversationHistory } from '../components/Chat/XyneAISidebar/utils/XyneAITypes';

// ============================================================================
// Query Keys
// ============================================================================

const V2_SESSIONS_KEY = (agentSlug?: string | null, allRuns = false): readonly unknown[] =>
  agentSlug
    ? ['xyne-ai-v2-sessions', agentSlug, { allRuns }]
    : ['xyne-ai-v2-sessions', { allRuns }];
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
export function useV2SessionsList(
  agentSlug?: string | null,
  enabled = true,
  options: { allRuns?: boolean } = {},
): UseQueryResult<ConversationHistory[], Error> {
  return useQuery({
    queryKey: V2_SESSIONS_KEY(agentSlug, Boolean(options.allRuns)),
    queryFn: () => fetchV2Conversations(agentSlug, options),
    staleTime: 30_000,
    enabled,
  });
}

/**
 * Invalidate v2 session lists (call after new chat, etc.)
 * Passing a prefix key invalidates all variations (with or without agentSlug).
 */
export function useV2SessionInvalidator(): {
  invalidateSessions: (agentSlug?: string | null) => void;
  invalidateMessages: (convId: string, agentSlug?: string | null) => void;
} {
  const queryClient = useQueryClient();

  const invalidateSessions = (agentSlug?: string | null): void => {
    void queryClient.invalidateQueries({
      queryKey: agentSlug ? ['xyne-ai-v2-sessions', agentSlug] : ['xyne-ai-v2-sessions'],
    });
  };

  const invalidateMessages = (convId: string, agentSlug?: string | null): void => {
    void queryClient.invalidateQueries({ queryKey: v2SessionMessagesKey(convId, agentSlug) });
  };

  return { invalidateSessions, invalidateMessages };
}
