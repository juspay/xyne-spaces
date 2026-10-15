import { useMemo, useSyncExternalStore } from 'react';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';
import type { SubTicketItem, SubTicketProgress } from './SubTickets.types';
import { isSubTicketDone } from './SubTickets.utils';

// How many sub-tickets each ticket shows; absent means collapsed. Outside React so it
// survives the virtualised card or row unmounting while scrolled away.
const shownByTicketId = new Map<string, number>();
const listeners = new Set<() => void>();

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const setSubTicketsShown = (ticketId: string, shown: number): void => {
  if (shown > 0) shownByTicketId.set(ticketId, shown);
  else shownByTicketId.delete(ticketId);
  for (const listener of listeners) listener();
};

export const useSubTicketsShown = (ticketId: string): number =>
  useSyncExternalStore(subscribe, () => shownByTicketId.get(ticketId) ?? 0);

/** Done/total sub-tickets per ticket, in one query. Pass a stable, sorted id list. */
export const useSubTicketProgress = (ticketIds: string[]): Map<string, SubTicketProgress> => {
  const [mappings] = useCachedQuery(queries.subTicketMappingsForTickets({ ticketIds }), {
    enabled: ticketIds.length > 0,
  });
  return useMemo(() => {
    const progress = new Map<string, SubTicketProgress>();
    mappings?.forEach(mapping => {
      const entry = progress.get(mapping.ticketId) ?? { done: 0, total: 0 };
      entry.total += 1;
      if (isSubTicketDone(mapping.subTicket?.mappedTicket)) entry.done += 1;
      progress.set(mapping.ticketId, entry);
    });
    return progress;
  }, [mappings]);
};

/** The first `limit` sub-tickets of a ticket, and whether the server has confirmed them. */
export const useSubTicketsPage = (
  ticketId: string,
  limit: number,
): { items: SubTicketItem[]; isComplete: boolean } => {
  // A collapsed tree passes 0: the query stays off, and limit must then be left out.
  const [mappings, details] = useCachedQuery(
    queries.subTicketsForTicket({ ticketId, ...(limit > 0 && { limit }) }),
    { enabled: limit > 0 },
  );
  const items = useMemo(
    () =>
      (mappings ?? []).map(mapping => ({
        id: mapping.subTicket?.id ?? mapping.id,
        title: mapping.subTicket?.title ?? '',
        ticket: mapping.subTicket?.mappedTicket ?? null,
      })),
    [mappings],
  );
  return { items, isComplete: details.type === 'complete' };
};
