/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories run before imports and cannot reference module scope */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { type ReactElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

jest.mock('@xyne/shared', () => require('../../../mocks/xyne-shared'));
jest.mock('@/src/zero/queries', () => ({
  queries: new Proxy({}, { get: (_target, name: string) => (args: unknown) => ({ name, args }) }),
}));
jest.mock('@/src/hooks/useCachedQuery', () => ({ useCachedQuery: jest.fn() }));
jest.mock('@/src/services/globalSearchService', () => ({
  globalSearchService: { search: jest.fn() },
}));

import { useCachedQuery } from '@/src/hooks/useCachedQuery';
import { globalSearchService } from '@/src/services/globalSearchService';
import { CHANNEL_TICKETS_SEARCH_DEBOUNCE_MS } from '@/src/features/channel-tickets/constants';
import {
  useChannelTicketSearch,
  type UseChannelTicketSearchReturn,
} from '@/src/features/channel-tickets/hooks/use-channel-ticket-search';
import type { ChannelTicketRow } from '@/src/features/channel-tickets/types';

import { makeRow, makeSourceRow } from './fixtures';

type QueryCall = { name: string; args: Record<string, unknown> };
type SearchPage = { results: Array<{ id: string; searchContext?: Record<string, unknown> }> };

const mockedUseCachedQuery = jest.mocked(useCachedQuery);
const mockedSearch = jest.mocked(globalSearchService.search);
const hydrationCalls: QueryCall[] = [];
let hydratedRows: unknown[] = [];

const LOADED: ChannelTicketRow[] = [
  makeRow({ id: 't-1', xyneId: 'UPI-1', title: 'Fix payment retry' }),
  makeRow({ id: 't-2', xyneId: 'UPI-2', title: 'Rotate webhook secret' }),
];

let latest!: UseChannelTicketSearchReturn;

function Probe({
  query,
  enabled = true,
}: {
  query: string;
  enabled?: boolean;
}): ReactElement | null {
  latest = useChannelTicketSearch('ch-1', query, LOADED, enabled);
  return null;
}

const mount = (query: string, enabled = true): ReactTestRenderer => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<Probe query={query} enabled={enabled} />);
  });
  return renderer;
};

const settle = async (): Promise<void> => {
  await act(async () => {
    jest.advanceTimersByTime(CHANNEL_TICKETS_SEARCH_DEBOUNCE_MS);
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('useChannelTicketSearch', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    hydrationCalls.length = 0;
    hydratedRows = [];
    mockedSearch.mockReset();
    mockedUseCachedQuery.mockImplementation(((query: QueryCall) => {
      hydrationCalls.push(query);
      return [hydratedRows, { type: 'complete' }, { source: 'fresh' }];
    }) as never);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('is inert without a query and never calls the server', () => {
    mount('   ');
    expect(latest.hasQuery).toBe(false);
    expect(latest.rows).toEqual([]);
    expect(mockedSearch).not.toHaveBeenCalled();
  });

  it('matches loaded rows instantly, before the debounced server search fires', () => {
    mockedSearch.mockResolvedValue({ results: [] } as never);
    mount('webhook');
    expect(latest.rows.map(r => r.id)).toEqual(['t-2']);
    expect(latest.isSearching).toBe(true);
    expect(mockedSearch).not.toHaveBeenCalled();
  });

  it('searches Vespa scoped to the channel after the debounce', async () => {
    mockedSearch.mockResolvedValue({ results: [] } as never);
    mount('retry');
    await settle();
    expect(mockedSearch).toHaveBeenCalledTimes(1);
    expect(mockedSearch.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ query: 'retry', type: 'tickets', apps: 'ticket', in: 'ch-1' }),
    );
    expect(latest.isSearching).toBe(false);
  });

  it('hydrates server hits outside the window and appends them after local matches', async () => {
    const page: SearchPage = {
      results: [
        { id: 't-9', searchContext: { ticketId: 't-9', channelId: 'ch-1' } },
        { id: 't-2', searchContext: { ticketId: 't-2', channelId: 'ch-1' } },
        { id: 'other', searchContext: { ticketId: 'other', channelId: 'ch-2' } },
      ],
    };
    mockedSearch.mockResolvedValue(page as never);
    hydratedRows = [makeSourceRow({ id: 't-9', xyneId: 'UPI-9', title: 'Retry budget alarm' })];

    mount('retry');
    await settle();

    // Only the hit the window lacks goes to Zero; the other-channel hit is dropped.
    const hydration = hydrationCalls.filter(c => c.name === 'ticketsByIds').at(-1);
    expect(hydration?.args).toEqual({ ticketIds: ['t-9'] });
    // Local match (t-1) first, then server-only hits in ranked order.
    expect(latest.rows.map(r => r.id)).toEqual(['t-1', 't-9', 't-2']);
    expect(latest.isSearching).toBe(false);
  });

  it('surfaces a server error but keeps local matches', async () => {
    mockedSearch.mockRejectedValue(new Error('vespa down'));
    mount('retry');
    await settle();
    expect(latest.errorMessage).toBe('vespa down');
    expect(latest.rows.map(r => r.id)).toEqual(['t-1']);
    expect(latest.isSearching).toBe(false);
  });

  it('ignores a stale response when the query changes mid-flight', async () => {
    let resolveFirst!: (page: SearchPage) => void;
    mockedSearch
      .mockImplementationOnce(
        () => new Promise<SearchPage>(resolve => (resolveFirst = resolve)) as never,
      )
      .mockResolvedValueOnce({ results: [] } as never);

    const renderer = mount('retry');
    act(() => {
      jest.advanceTimersByTime(CHANNEL_TICKETS_SEARCH_DEBOUNCE_MS);
    });
    act(() => {
      renderer.update(<Probe query='webhook' />);
    });
    await settle();
    await act(async () => {
      resolveFirst({ results: [{ id: 't-9', searchContext: { ticketId: 't-9' } }] });
      await Promise.resolve();
    });
    // The first (stale) response must not inject t-9 into the "webhook" results.
    expect(latest.rows.map(r => r.id)).toEqual(['t-2']);
  });

  it('clears everything when search mode is turned off', async () => {
    mockedSearch.mockResolvedValue({ results: [] } as never);
    const renderer = mount('retry');
    await settle();
    act(() => {
      renderer.update(<Probe query='retry' enabled={false} />);
    });
    expect(latest.hasQuery).toBe(false);
    expect(latest.rows).toEqual([]);
    expect(latest.isSearching).toBe(false);
  });
});
