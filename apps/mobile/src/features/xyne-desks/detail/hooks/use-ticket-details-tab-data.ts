import { useMemo } from 'react';

import { useCachedQuery } from '@/src/hooks/useCachedQuery';
import { queries } from '@/src/zero/queries';

import type { TicketDetailsTabSnapshot } from '../types';
import { mapTicketDetailsTab } from '../utils';

export type UseTicketDetailsTabDataReturn = {
  details: TicketDetailsTabSnapshot | null;
  isInitialLoading: boolean;
};

export function useTicketDetailsTabData(
  ticketId: string | null | undefined,
  enabled = true,
): UseTicketDetailsTabDataReturn {
  const [ticket, details] = useCachedQuery(
    queries.ticketDetailsByIdV2({ ticketId: ticketId ?? '' }),
    {
      enabled: Boolean(ticketId) && enabled,
      ttl: '10m',
    },
  );

  const mapped = useMemo(() => mapTicketDetailsTab(ticket), [ticket]);
  const queryPending = details.type !== 'complete';

  return {
    details: mapped,
    isInitialLoading: mapped == null && queryPending,
  };
}
