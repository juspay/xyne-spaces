/**
 * Hook for managing Ask AI v2 sessions via xyne-claw backend.
 *
 * Uses claw conversation APIs (proxied through Spaces backend) instead of
 * the v1 session store. Provides the same interface as useAskAISessions
 * so the sidebar can switch between versions seamlessly.
 */

import { useCallback, useMemo } from 'react';
import {
  keepPreviousData,
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import {
  fetchV2Conversations,
  type AgentConversationCount,
  type V2ConversationPage,
} from '../services/XyneAI/XyneAISessionsV2Service';
import type { ConversationHistory } from '../components/Chat/XyneAISidebar/utils/XyneAITypes';

// ============================================================================
// Query Keys
// ============================================================================

const V2_SESSIONS_KEY = ['xyne-ai-v2-sessions'] as const;
const v2SessionMessagesKey = (convId: string, agentSlug?: string | null): readonly string[] =>
  agentSlug
    ? ['xyne-ai-v2-session', convId, 'messages', agentSlug]
    : ['xyne-ai-v2-session', convId, 'messages'];

// ============================================================================
// Hooks
// ============================================================================

const NO_AGENTS: AgentConversationCount[] = [];

interface V2SessionsListOptions {
  /** Keep only this agent's conversations (server-side). */
  agentSlug?: string | null;
  /** Title search (server-side). */
  query?: string;
  enabled?: boolean;
  /** Refetch whenever the list mounts — for panels the user opens to look. */
  refetchOnMount?: boolean | 'always';
}

/**
 * The user's chat history across every agent, newest first, a page of 50 at a
 * time (every pinned chat comes with the first page). Shared by the AI screen,
 * the sidebar and the overlay. Filter and search run on the server, so they
 * reach chats that are not loaded yet; `loadMore` fetches the next page.
 */
export function useV2SessionsList({
  agentSlug = null,
  query = '',
  enabled = true,
  refetchOnMount = true,
}: V2SessionsListOptions = {}) {
  const result = useInfiniteQuery({
    queryKey: [...V2_SESSIONS_KEY, agentSlug ?? '', query],
    queryFn: ({ pageParam }) => fetchV2Conversations({ agentSlug, q: query, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: page => page.nextCursor ?? undefined,
    // Changing the filter or search keeps the current rows on screen until
    // the new ones arrive, instead of flashing an empty list.
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    refetchOnMount,
    enabled,
  });
  const conversations = useMemo(() => {
    const seen = new Set<string>();
    return (result.data?.pages ?? [])
      .flatMap(page => page.conversations)
      .filter(row => !seen.has(row.id) && Boolean(seen.add(row.id)));
  }, [result.data]);
  return {
    conversations,
    agents: result.data?.pages[0]?.agents ?? NO_AGENTS,
    isLoading: result.isLoading,
    hasMore: result.hasNextPage,
    isLoadingMore: result.isFetchingNextPage,
    loadMore: result.fetchNextPage,
  };
}

/**
 * Invalidate the chat history (call after new chat, etc.) — a turn with any
 * agent changes it.
 */
export function useV2SessionInvalidator() {
  const queryClient = useQueryClient();

  const invalidateSessions = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: V2_SESSIONS_KEY });
  }, [queryClient]);

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
    (rowId: string, patch: Partial<ConversationHistory>): (() => void) => {
      // Every cached view of the list (each filter and search) holds its own
      // pages; patch the row wherever it is loaded.
      const previous = queryClient.getQueriesData<InfiniteData<V2ConversationPage>>({
        queryKey: V2_SESSIONS_KEY,
      });
      queryClient.setQueriesData<InfiniteData<V2ConversationPage>>(
        { queryKey: V2_SESSIONS_KEY },
        data =>
          data && {
            ...data,
            pages: data.pages.map(page => ({
              ...page,
              conversations: page.conversations.map(row =>
                row.id === rowId ? { ...row, ...patch } : row,
              ),
            })),
          },
      );
      return () => previous.forEach(([key, data]) => queryClient.setQueryData(key, data));
    },
    [queryClient],
  );

  return { patchSession };
}
