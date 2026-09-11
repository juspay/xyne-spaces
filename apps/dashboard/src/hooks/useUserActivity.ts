import { logger, Event as LogEvent } from '../utils/logger';
import { useState, useCallback, useRef } from 'react';
import { apiInstance } from '../services/clients/apiClient';
import type { UserActivity, UserActivityResponse } from '@xyne/shared';

export type { UserActivity, UserActivityResponse };

interface UseUserActivityReturn {
  activities: UserActivity[];
  isLoading: boolean;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
}

const PAGE_SIZE = 20;

export const useUserActivity = (): UseUserActivityReturn => {
  const [activities, setActivities] = useState<UserActivity[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const cursorRef = useRef<string | null>(null);
  const isFetchingRef = useRef(false);

  const fetchActivities = useCallback(async (cursor?: string) => {
    const params = new URLSearchParams();
    if (cursor) params.append('cursor', cursor);
    params.append('limit', String(PAGE_SIZE));

    const response = await apiInstance.get<UserActivityResponse>(
      `/user-activity?${params.toString()}`,
    );
    return response.data;
  }, []);

  const loadMore = useCallback(async () => {
    if (isLoading || isFetchingRef.current || !hasMore) return;

    isFetchingRef.current = true;
    setIsLoading(true);

    try {
      const response = await fetchActivities(cursorRef.current || undefined);

      setActivities(prev => {
        // Avoid duplicates
        const existingIds = new Set(prev.map(a => a.id));
        const newActivities = response.data.filter(a => !existingIds.has(a.id));
        return [...prev, ...newActivities];
      });

      setHasMore(response.pagination.hasMore);
      cursorRef.current = response.pagination.nextCursor;
    } catch (error) {
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('Error fetching user activities:'),
        error: error,
      });
    } finally {
      setIsLoading(false);
      isFetchingRef.current = false;
    }
  }, [fetchActivities, hasMore, isLoading]);

  const refresh = useCallback(async () => {
    setActivities([]);
    setHasMore(true);
    cursorRef.current = null;
    isFetchingRef.current = false;

    isFetchingRef.current = true;
    setIsLoading(true);

    try {
      const response = await fetchActivities();
      setActivities(response.data);
      setHasMore(response.pagination.hasMore);
      cursorRef.current = response.pagination.nextCursor;
    } catch (error) {
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('Error refreshing user activities:'),
        error: error,
      });
    } finally {
      setIsLoading(false);
      isFetchingRef.current = false;
    }
  }, [fetchActivities]);

  return {
    activities,
    isLoading,
    hasMore,
    loadMore,
    refresh,
  };
};
