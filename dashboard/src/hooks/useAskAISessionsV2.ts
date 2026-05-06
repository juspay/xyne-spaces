/**
 * Hook for managing Ask AI v2 sessions via xyne-claw backend.
 *
 * Uses claw conversation APIs (proxied through Spaces backend) instead of
 * the v1 session store. Provides the same interface as useAskAISessions
 * so the sidebar can switch between versions seamlessly.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchV2Conversations,
  fetchV2ConversationMessages,
} from '../services/XyneAI/XyneAISessionsV2Service';

// ============================================================================
// Query Keys
// ============================================================================

const V2_SESSIONS_KEY = ['xyne-ai-v2-sessions'] as const;
const v2SessionMessagesKey = (convId: string) =>
  ['xyne-ai-v2-session', convId, 'messages'] as const;

// ============================================================================
// Hooks
// ============================================================================

/**
 * List all conversations for the current user from claw.
 */
export function useV2SessionsList() {
  return useQuery({
    queryKey: V2_SESSIONS_KEY,
    queryFn: fetchV2Conversations,
    staleTime: 30_000,
  });
}

/**
 * Fetch messages for a specific claw conversation.
 */
export function useV2ConversationMessages(convId: string | null) {
  return useQuery({
    queryKey: v2SessionMessagesKey(convId || ''),
    queryFn: () => fetchV2ConversationMessages(convId!),
    enabled: !!convId,
    staleTime: 60_000,
  });
}

/**
 * Invalidate v2 session lists (call after new chat, etc.)
 */
export function useV2SessionInvalidator() {
  const queryClient = useQueryClient();

  const invalidateSessions = () => {
    void queryClient.invalidateQueries({ queryKey: V2_SESSIONS_KEY });
  };

  const invalidateMessages = (convId: string) => {
    void queryClient.invalidateQueries({ queryKey: v2SessionMessagesKey(convId) });
  };

  return { invalidateSessions, invalidateMessages };
}
