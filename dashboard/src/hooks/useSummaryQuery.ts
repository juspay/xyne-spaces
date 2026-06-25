/**
 * Summary React Query Hooks
 *
 * For caching thread and channel summaries.
 */

import { useMemo, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';

// Types from original store
interface Citation {
  messageIndex: number;
  messageId: string;
}

interface KeyPointWithCitation {
  point: string;
  citation: Citation;
}

export interface SummaryOutput {
  summary: string;
  keyPoints?: KeyPointWithCitation[];
  participantCount: number;
  messageCount: number;
  topicsTouched?: string[];
  topicSections?: Array<{
    heading: string;
    keyPoints: KeyPointWithCitation[];
  }>;
}

interface CachedSummary {
  summary: SummaryOutput;
  conversationIdMapping?: { [key: string]: string };
  messageIdMapping?: { [key: string]: string };
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
  cachedAt: number;
}

// ============================================================================
// Query Keys
// ============================================================================

const QUERY_KEYS = {
  threadSummary: (conversationId: string) => ['summary', 'thread', conversationId] as const,
  channelSummary: (channelId: string, dateFrom?: string, dateTo?: string) =>
    ['summary', 'channel', channelId, dateFrom || 'none', dateTo || 'none'] as const,
  allThreadSummaries: () => ['summary', 'thread'] as const,
  allChannelSummaries: (channelId: string) => ['summary', 'channel', channelId] as const,
} as const;

// ============================================================================
// Hooks
// ============================================================================

/**
 * Set thread summary in cache
 */
export function useSetThreadSummary() {
  const queryClient = useQueryClient();

  return (conversationId: string, data: CachedSummary) => {
    queryClient.setQueryData(QUERY_KEYS.threadSummary(conversationId), data);
  };
}

/**
 * Set channel summary in cache
 */
export function useSetChannelSummary() {
  const queryClient = useQueryClient();

  return (
    channelId: string,
    dateFrom: string | undefined,
    dateTo: string | undefined,
    data: CachedSummary,
  ) => {
    queryClient.setQueryData(QUERY_KEYS.channelSummary(channelId, dateFrom, dateTo), data);
  };
}

/**
 * Invalidate (clear) thread summary
 */
export function useInvalidateThreadSummary() {
  const queryClient = useQueryClient();

  return useCallback(
    (conversationId: string) => {
      queryClient.removeQueries({
        queryKey: QUERY_KEYS.threadSummary(conversationId),
      });
    },
    [queryClient],
  );
}

/**
 * Invalidate all channel summaries for a channelId (regardless of date range)
 */
export function useInvalidateChannelSummaries() {
  const queryClient = useQueryClient();

  return useCallback(
    (channelId: string) => {
      queryClient.removeQueries({
        queryKey: QUERY_KEYS.allChannelSummaries(channelId),
      });
    },
    [queryClient],
  );
}

/**
 * Clear all summary caches
 */
export function useClearAllSummaries() {
  const queryClient = useQueryClient();

  return useCallback(() => {
    queryClient.removeQueries({
      queryKey: ['summary'],
    });
  }, [queryClient]);
}

/**
 * Handle message change - invalidates both thread and channel summaries
 */
export function useOnMessageChange() {
  const invalidateThread = useInvalidateThreadSummary();
  const invalidateChannel = useInvalidateChannelSummaries();

  return useCallback(
    (conversationId: string, channelId: string) => {
      invalidateThread(conversationId);
      invalidateChannel(channelId);
    },
    [invalidateThread, invalidateChannel],
  );
}

// ============================================================================
// Export object interface matching original Zustand store
// ============================================================================

/**
 * Hook that provides the same interface as the original Zustand store
 * for backward compatibility with existing code.
 */
export function useSummaryCache() {
  const queryClient = useQueryClient();
  const setThread = useSetThreadSummary();
  const setChannel = useSetChannelSummary();
  const invalidateThread = useInvalidateThreadSummary();
  const invalidateChannel = useInvalidateChannelSummaries();
  const clearAll = useClearAllSummaries();
  const onMessageChange = useOnMessageChange();

  // Memoize to prevent infinite loops from changing references
  return useMemo(
    () => ({
      // Get methods
      getThreadSummary: (conversationId: string): CachedSummary | undefined => {
        return queryClient.getQueryData<CachedSummary>(QUERY_KEYS.threadSummary(conversationId));
      },

      getChannelSummary: (
        channelId: string,
        dateFrom?: string,
        dateTo?: string,
      ): CachedSummary | undefined => {
        return queryClient.getQueryData<CachedSummary>(
          QUERY_KEYS.channelSummary(channelId, dateFrom, dateTo),
        );
      },

      // Set methods
      setThreadSummary: setThread,
      setChannelSummary: setChannel,

      // Check methods
      hasThreadSummary: (conversationId: string): boolean => {
        const data = queryClient.getQueryData(QUERY_KEYS.threadSummary(conversationId));
        return data !== undefined;
      },

      hasChannelSummary: (channelId: string, dateFrom?: string, dateTo?: string): boolean => {
        const data = queryClient.getQueryData(
          QUERY_KEYS.channelSummary(channelId, dateFrom, dateTo),
        );
        return data !== undefined;
      },

      // Clear methods
      clearThreadSummary: (conversationId: string): void => {
        queryClient.removeQueries({
          queryKey: QUERY_KEYS.threadSummary(conversationId),
        });
      },

      clearChannelSummary: (channelId: string, dateFrom?: string, dateTo?: string): void => {
        queryClient.removeQueries({
          queryKey: QUERY_KEYS.channelSummary(channelId, dateFrom, dateTo),
        });
      },

      clearAll,

      // Invalidate methods
      invalidateThreadSummary: invalidateThread,
      invalidateChannelSummaries: invalidateChannel,
      onMessageChange,
    }),
    [
      queryClient,
      setThread,
      setChannel,
      invalidateThread,
      invalidateChannel,
      clearAll,
      onMessageChange,
    ],
  );
}
