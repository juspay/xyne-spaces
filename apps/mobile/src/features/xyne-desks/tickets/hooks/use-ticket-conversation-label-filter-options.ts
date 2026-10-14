import { useMemo } from 'react';

import { useCachedQuery } from '@/src/hooks/useCachedQuery';
import { queries } from '@/src/zero/queries';

import type { TicketsMultiSelectFilterOption } from '../components/tickets-multi-select-filter';
import {
  mapConversationLabelRowsToFilterOptions,
  type ConversationLabelRowLike,
} from '../utils/conversation-label-filters';

type QueriesWithLabels = typeof queries & {
  conversationLabelsByChannelId?: (args: { channelId: string }) => unknown;
};

/**
 * Desk conversation labels for the Label filter.
 * Hidden until shared ships `conversationLabelsByChannelId` and V4 applies
 * `conversationLabelId` — the pinned SHA accepts the arg for parity only.
 */
export function useTicketConversationLabelFilterOptions(channelId: string): {
  options: TicketsMultiSelectFilterOption[];
  isAvailable: boolean;
} {
  const labelsQueryFn = (queries as QueriesWithLabels).conversationLabelsByChannelId;
  const isAvailable = typeof labelsQueryFn === 'function';

  const [labels] = useCachedQuery(
    (labelsQueryFn ? labelsQueryFn({ channelId }) : queries.getAllMerchants()) as never,
    {
      enabled: Boolean(channelId && isAvailable),
      ttl: '10m',
    },
  );

  const options = useMemo((): TicketsMultiSelectFilterOption[] => {
    if (!isAvailable) return [];
    return mapConversationLabelRowsToFilterOptions(
      labels as ConversationLabelRowLike[] | undefined,
    );
  }, [isAvailable, labels]);

  return { options, isAvailable };
}
