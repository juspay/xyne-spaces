/**
 * Hook for managing Ask AI v2 sessions via xyne-claw backend.
 *
 * Uses claw conversation APIs (proxied through Spaces backend) instead of
 * the v1 session store. Provides the same interface as useAskAISessions
 * so the sidebar can switch between versions seamlessly.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchV2Conversations } from '../services/XyneAI/XyneAISessionsV2Service';

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

  const invalidateSessions = (agentSlug?: string | null) => {
    void queryClient.invalidateQueries({ queryKey: V2_SESSIONS_KEY(agentSlug) });
  };

  const invalidateMessages = (convId: string, agentSlug?: string | null) => {
    void queryClient.invalidateQueries({ queryKey: v2SessionMessagesKey(convId, agentSlug) });
  };

  return { invalidateSessions, invalidateMessages };
}
