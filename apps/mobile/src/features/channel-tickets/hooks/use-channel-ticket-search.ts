import { useEffect, useMemo, useRef, useState } from 'react';

import { useCachedQuery } from '@/src/hooks/useCachedQuery';
import { globalSearchService } from '@/src/services/globalSearchService';
import { queries } from '@/src/zero/queries';

import { CHANNEL_TICKETS_SEARCH_DEBOUNCE_MS, CHANNEL_TICKETS_SEARCH_LIMIT } from '../constants';
import type { ChannelTicketRow } from '../types';
import {
  filterChannelTicketRowsByQuery,
  mapChannelTicketRows,
  mergeChannelTicketSearchRows,
  normalizeTicketSearchQuery,
  type ChannelTicketSourceRow,
} from '../utils';

export type UseChannelTicketSearchReturn = {
  /** Rows to show while a query is active: local matches + hydrated server hits. */
  rows: ChannelTicketRow[];
  hasQuery: boolean;
  /** Server search or hydration still in flight. Local matches are already in `rows`. */
  isSearching: boolean;
  errorMessage: string | null;
};

const EMPTY_IDS: readonly string[] = Object.freeze([]);

/**
 * Ticket search for one channel, dashboard-style but mobile-friendly:
 * 1. instant local substring match over the loaded window (no network);
 * 2. debounced Vespa search (`type: 'tickets'`, scoped with `in: channelId`);
 * 3. hits outside the loaded window hydrated through `ticketsByIds` so they
 *    render with the same columns as everything else.
 */
export function useChannelTicketSearch(
  channelId: string,
  query: string,
  loadedRows: readonly ChannelTicketRow[],
  enabled: boolean,
): UseChannelTicketSearchReturn {
  const normalizedQuery = normalizeTicketSearchQuery(query);
  const hasQuery = enabled && Boolean(channelId) && normalizedQuery.length > 0;

  const localMatches = useMemo(
    () => (hasQuery ? filterChannelTicketRowsByQuery(loadedRows, normalizedQuery) : []),
    [hasQuery, loadedRows, normalizedQuery],
  );

  const [remoteIds, setRemoteIds] = useState<readonly string[]>(EMPTY_IDS);
  const [isRemoteSearching, setIsRemoteSearching] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const requestVersionRef = useRef(0);

  useEffect(() => {
    if (!hasQuery) {
      setRemoteIds(EMPTY_IDS);
      setIsRemoteSearching(false);
      setErrorMessage(null);
      requestVersionRef.current += 1;
      return;
    }

    setIsRemoteSearching(true);
    setErrorMessage(null);
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;

    const timer = setTimeout(() => {
      void globalSearchService
        .search({
          query: normalizedQuery,
          type: 'tickets',
          apps: 'ticket',
          in: channelId,
          onlyMyChannels: false,
          limit: CHANNEL_TICKETS_SEARCH_LIMIT,
          offset: 0,
        })
        .then(page => {
          if (requestVersionRef.current !== requestVersion) return;
          const ids: string[] = [];
          for (const result of page.results) {
            const context = result.searchContext;
            // Belt and braces: `in:` scopes server-side, but never show a hit
            // that says it belongs to another channel.
            if (context?.channelId && context.channelId !== channelId) continue;
            const id = context?.ticketId ?? result.id;
            if (id && !ids.includes(id)) ids.push(id);
          }
          setRemoteIds(ids.length > 0 ? ids : EMPTY_IDS);
        })
        .catch((error: unknown) => {
          if (requestVersionRef.current !== requestVersion) return;
          setRemoteIds(EMPTY_IDS);
          setErrorMessage(
            error instanceof Error ? error.message : 'Could not search tickets right now.',
          );
        })
        .finally(() => {
          if (requestVersionRef.current === requestVersion) setIsRemoteSearching(false);
        });
    }, CHANNEL_TICKETS_SEARCH_DEBOUNCE_MS);

    return (): void => clearTimeout(timer);
  }, [channelId, hasQuery, normalizedQuery]);

  // Only hits the window does not already hold need a round trip to Zero.
  const missingIds = useMemo(() => {
    if (remoteIds.length === 0) return EMPTY_IDS;
    const loaded = new Set(loadedRows.map(row => row.id));
    const missing = remoteIds.filter(id => !loaded.has(id));
    return missing.length > 0 ? missing : EMPTY_IDS;
  }, [remoteIds, loadedRows]);

  const [hydratedSource, hydrationDetails] = useCachedQuery(
    queries.ticketsByIds({ ticketIds: [...missingIds] }),
    { enabled: hasQuery && missingIds.length > 0, ttl: '5m' },
  );

  const hydrated = useMemo(() => {
    if (missingIds.length === 0) return [];
    const source = ((hydratedSource ?? []) as readonly ChannelTicketSourceRow[]).filter(
      row => (row.channelId ?? channelId) === channelId,
    );
    return mapChannelTicketRows(source, { now: Date.now() });
  }, [hydratedSource, missingIds.length, channelId]);

  const rows = useMemo(
    () =>
      hasQuery ? mergeChannelTicketSearchRows(localMatches, remoteIds, loadedRows, hydrated) : [],
    [hasQuery, localMatches, remoteIds, loadedRows, hydrated],
  );

  const isHydrating = missingIds.length > 0 && hydrationDetails.type !== 'complete';

  return {
    rows,
    hasQuery,
    isSearching: hasQuery && (isRemoteSearching || isHydrating),
    errorMessage,
  };
}
