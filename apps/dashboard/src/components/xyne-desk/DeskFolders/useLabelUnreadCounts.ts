import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchConversationLabelUnreadCounts,
  fetchFilteredLabelUnreadCount,
  type LabelUnreadFilters,
} from '../../../api/conversationLabelsApi';
import { websocketService } from '../../../services/clients/socketClient';

/**
 * Unread-count queries for desk conversation labels. Mode A returns all-label
 * counts for a channel and keeps them fresh via the
 * `label-unread-counts:channel:<channelId>` socket room; mode B returns the
 * filtered count for one selected label and shares the same invalidation
 * stream through query-key prefixing.
 */

const STALE_TIME = 10 * 60 * 1000;
const INVALIDATE_DEBOUNCE_MS = 500;
/**
 * Every socket in a desk room gets the same event at the same instant. A random spread on
 * top of the debounce keeps N open sidebars from hitting the grouped count query in one
 * burst.
 */
const INVALIDATE_JITTER_MS = 1_500;
/**
 * Freshness comes from the socket room (and a refetch on reconnect), not polling. This
 * is only a slow safety net for a missed event; the server coalesces publishes per
 * channel, so a tight interval would just add a query per sidebar per desk.
 */
const FALLBACK_REFETCH_INTERVAL_MS = 10 * 60 * 1000;

type LabelUnreadCountsUpdateEvent = {
  channelId: string;
  timestamp: string;
};

const sortUniqueValues = <T extends string>(values?: readonly T[]): T[] | undefined => {
  if (!values || values.length === 0) return undefined;

  const uniqueValues = [...new Set(values)];
  uniqueValues.sort((left, right) => left.localeCompare(right));
  return uniqueValues;
};

export const normalizeLabelUnreadFilters = (
  filters?: LabelUnreadFilters,
): LabelUnreadFilters | undefined => {
  if (!filters) return undefined;

  const normalized: LabelUnreadFilters = {};

  const assignedTo = sortUniqueValues(filters.assignedTo);
  if (assignedTo) normalized.assignedTo = assignedTo;

  const createdBy = sortUniqueValues(filters.createdBy);
  if (createdBy) normalized.createdBy = createdBy;

  const priority = sortUniqueValues(filters.priority);
  if (priority) normalized.priority = priority;

  const stageName = sortUniqueValues(filters.stageName);
  if (stageName) normalized.stageName = stageName;

  const aiCategory = sortUniqueValues(filters.aiCategory);
  if (aiCategory) normalized.aiCategory = aiCategory;

  const userGroups = sortUniqueValues(filters.userGroups);
  if (userGroups) normalized.userGroups = userGroups;

  // An empty conversationIds list is meaningful (the tag filter matched no
  // conversations, so the count must be zero) — keep it rather than dropping it.
  if (filters.conversationIds !== undefined) {
    normalized.conversationIds = [...new Set(filters.conversationIds)].sort((left, right) =>
      left.localeCompare(right),
    );
  }

  if (filters.hasAiDraft !== undefined) normalized.hasAiDraft = filters.hasAiDraft;
  if (filters.hasSubTickets !== undefined) normalized.hasSubTickets = filters.hasSubTickets;
  if (filters.lastEmailAtStart !== undefined)
    normalized.lastEmailAtStart = filters.lastEmailAtStart;
  if (filters.lastEmailAtEnd !== undefined) normalized.lastEmailAtEnd = filters.lastEmailAtEnd;
  if (filters.createdAtStart !== undefined) normalized.createdAtStart = filters.createdAtStart;
  if (filters.createdAtEnd !== undefined) normalized.createdAtEnd = filters.createdAtEnd;

  if (filters.dynamicFieldFilters && filters.dynamicFieldFilters.length > 0) {
    normalized.dynamicFieldFilters = filters.dynamicFieldFilters
      .map(entry => ({
        fieldId: entry.fieldId,
        ...(entry.values && entry.values.length > 0
          ? {
              values: [...entry.values].sort((left, right) =>
                String(left).localeCompare(String(right)),
              ),
            }
          : {}),
      }))
      .sort((left, right) => left.fieldId.localeCompare(right.fieldId));
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
};

export const useLabelUnreadCounts = (channelId: string, enabled = true) => {
  const queryClient = useQueryClient();
  const isEnabled = !!channelId && enabled;
  const room = `label-unread-counts:channel:${channelId}`;

  const query = useQuery({
    queryKey: ['conversation-label-unread-counts', channelId],
    queryFn: () => fetchConversationLabelUnreadCounts(channelId),
    enabled: isEnabled,
    staleTime: STALE_TIME,
    refetchInterval: FALLBACK_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    if (!isEnabled) return;

    let cancelled = false;
    let invalidateTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleInvalidate = (): void => {
      if (invalidateTimer) clearTimeout(invalidateTimer);
      invalidateTimer = setTimeout(
        () => {
          invalidateTimer = null;
          if (cancelled) return;
          // Prefix match covers both this hook's key and the filtered-count keys.
          void queryClient.invalidateQueries({
            queryKey: ['conversation-label-unread-counts', channelId],
          });
        },
        INVALIDATE_DEBOUNCE_MS + Math.random() * INVALIDATE_JITTER_MS,
      );
    };
    const handleCountsUpdate = (event: LabelUnreadCountsUpdateEvent): void => {
      if (cancelled) return;
      if (event.channelId !== channelId) return;

      // Coalesce bursts (bulk mark-unread, ingest) into a single refetch.
      scheduleInvalidate();
    };
    const handleSocketConnect = (): void => {
      if (cancelled) return;
      websocketService.emit('subscribe_to_label_unread_counts', { room });
      // Events published while disconnected were missed — with no short poll, catch up once.
      scheduleInvalidate();
    };

    const subscribe = async (): Promise<void> => {
      try {
        if (!websocketService.isConnectedToServer()) {
          await websocketService.connect();
        }
        if (cancelled) return;
        websocketService.on<LabelUnreadCountsUpdateEvent>(
          'label_unread_counts_updated',
          handleCountsUpdate,
        );
        websocketService.on('connect', handleSocketConnect);
        websocketService.emit('subscribe_to_label_unread_counts', { room });
      } catch {
        // Ignore websocket failures; counts will continue to work from the API snapshot.
      }
    };

    void subscribe();

    return () => {
      cancelled = true;
      if (invalidateTimer) clearTimeout(invalidateTimer);
      websocketService.removeListener<LabelUnreadCountsUpdateEvent>(
        'label_unread_counts_updated',
        handleCountsUpdate,
      );
      websocketService.removeListener('connect', handleSocketConnect);
      websocketService.emit('unsubscribe_from_label_unread_counts', { room });
    };
  }, [channelId, isEnabled, queryClient, room]);

  return query;
};

interface UseFilteredLabelUnreadCountOptions {
  channelId: string;
  labelId: string | null;
  filters?: LabelUnreadFilters | undefined;
  enabled?: boolean;
}

export const useFilteredLabelUnreadCount = ({
  channelId,
  labelId,
  filters,
  enabled = true,
}: UseFilteredLabelUnreadCountOptions) => {
  const { normalizedFilters, filterKey } = useMemo(() => {
    const normalized = normalizeLabelUnreadFilters(filters);
    return { normalizedFilters: normalized, filterKey: JSON.stringify(normalized ?? null) };
  }, [filters]);

  return useQuery({
    queryKey: ['conversation-label-unread-counts', channelId, 'filtered', labelId, filterKey],
    queryFn: () => {
      if (!labelId) throw new Error('labelId is required for the filtered label unread count');
      return fetchFilteredLabelUnreadCount({ channelId, labelId, filters: normalizedFilters });
    },
    enabled: !!channelId && !!labelId && enabled,
    staleTime: STALE_TIME,
    refetchInterval: FALLBACK_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });
};
