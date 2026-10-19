import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { useAuth } from '@/src/contexts/AuthContext';
import { apiGet } from '@/src/services/apiClient';
import { buildAuthenticatedHeaders } from '@/src/services/authToken';
import {
  CUSTOM_EMOJIS_STALE_TIME_MS,
  customEmojisQueryKeyForUser,
} from '@/src/services/customEmojiQuery';
import {
  type CustomEmojiItem,
  readCustomEmojiCache,
  writeCustomEmojiCache,
} from '@/src/services/customEmojiCache';
import { queryClient } from '@/src/services/queryClient';
import { logEmojiPickerDiagnostic } from '@/src/components/emoji-picker/emoji-picker-diagnostics';

export type { CustomEmojiItem };
export { customEmojisQueryKey, CUSTOM_EMOJIS_STALE_TIME_MS } from '@/src/services/customEmojiQuery';

type EmojisResponse = {
  emojis?: Array<{ id?: string; name?: string }>;
};

const GC_TIME_MS = 24 * 60 * 60 * 1000;

async function fetchCustomEmojis(userId: string): Promise<CustomEmojiItem[]> {
  const traceId = 'custom-emoji-catalog';
  const startedAtMs = Date.now();
  logEmojiPickerDiagnostic(traceId, 'catalog_request_started');
  try {
    const headers = await buildAuthenticatedHeaders();
    const response = await apiGet<EmojisResponse>('/emojis', { headers });
    const emojis = (response.emojis ?? [])
      .filter((emoji): emoji is { id: string; name: string } => Boolean(emoji?.id && emoji?.name))
      .map(emoji => ({ id: emoji.id, name: emoji.name }));

    writeCustomEmojiCache(userId, emojis);
    logEmojiPickerDiagnostic(traceId, 'catalog_request_succeeded', {
      durationMs: Date.now() - startedAtMs,
      emojiCount: emojis.length,
    });
    return emojis;
  } catch (error) {
    logEmojiPickerDiagnostic(traceId, 'catalog_request_failed', {
      durationMs: Date.now() - startedAtMs,
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

type UseCustomEmojisOptions = {
  enabled?: boolean;
};

export function useCustomEmojis(options?: UseCustomEmojisOptions): {
  data: CustomEmojiItem[];
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  refresh: () => Promise<unknown>;
} {
  const { user } = useAuth();
  const userId = user?.user_id;
  const enabled = (options?.enabled ?? true) && Boolean(userId);

  /** Seed React Query from MMKV only when no in-memory result is available. */
  const diskCache = useMemo(() => {
    if (!enabled || !userId) return null;
    if (queryClient.getQueryData(customEmojisQueryKeyForUser(userId))) return null;
    return readCustomEmojiCache(userId);
  }, [enabled, userId]);

  const query = useQuery({
    queryKey: customEmojisQueryKeyForUser(userId!),
    queryFn: () => fetchCustomEmojis(userId!),
    staleTime: CUSTOM_EMOJIS_STALE_TIME_MS,
    gcTime: GC_TIME_MS,
    // The picker falls back to Unicode when a cold metadata request fails.
    // One retry avoids holding its opening state through React Query's longer
    // default retry sequence on a release build with no disk cache yet.
    retry: 1,
    enabled,
    ...(diskCache
      ? {
          initialData: diskCache.emojis,
          initialDataUpdatedAt: diskCache.cachedAt,
        }
      : {}),
  });

  useEffect(() => {
    if (!enabled) return;
    logEmojiPickerDiagnostic('custom-emoji-catalog', 'catalog_query_state', {
      hasDiskCache: diskCache !== null,
      dataCount: query.data?.length ?? 0,
      isLoading: query.isLoading,
      isFetching: query.isFetching,
      hasError: query.error !== null,
    });
  }, [diskCache, enabled, query.data?.length, query.error, query.isFetching, query.isLoading]);

  return {
    data: query.data ?? [],
    /** True only when there is no data yet (first load with empty cache). */
    isLoading: query.isLoading,
    /** True during background refresh while cached data is already shown. */
    isFetching: query.isFetching,
    error: query.error,
    refresh: query.refetch,
  };
}
