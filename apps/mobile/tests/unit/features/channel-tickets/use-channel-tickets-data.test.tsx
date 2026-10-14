/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories run before imports and cannot reference module scope */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { type ReactElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

jest.mock('@xyne/shared', () => require('../../../mocks/xyne-shared'));

jest.mock('@/src/contexts/AuthContext', () => ({
  useAuth: () => ({ workspaceSessionKey: 'session-1' }),
}));
jest.mock('@/src/hooks/useChannels', () => ({
  useUserChannelStatuses: () => [{ channelId: 'ch-1' }],
}));
jest.mock('@/src/zero/queries', () => ({
  queries: new Proxy({}, { get: (_target, name: string) => (args: unknown) => ({ name, args }) }),
}));
jest.mock('@/src/hooks/useCachedQuery', () => ({ useCachedQuery: jest.fn() }));

import { useCachedQuery } from '@/src/hooks/useCachedQuery';
import { CHANNEL_TICKETS_PAGE_SIZE } from '@/src/features/channel-tickets/constants';
import {
  useChannelTicketsData,
  type UseChannelTicketsDataReturn,
} from '@/src/features/channel-tickets/hooks/use-channel-tickets-data';
import type { ChannelTicketsFilters } from '@/src/features/channel-tickets/types';
import { clearChannelTicketsPaintCache } from '@/src/features/channel-tickets/utils/channel-tickets-paint-cache';

import { makeSourceRows } from './fixtures';

type QueryCall = { name: string; args: Record<string, unknown> };

const mockedUseCachedQuery = jest.mocked(useCachedQuery);
const calls: QueryCall[] = [];
let queryRows: unknown[] = [];
let queryType: 'complete' | 'unknown' = 'complete';

const NO_FILTERS: ChannelTicketsFilters = {
  assigneeIds: [],
  priorities: [],
  stageNames: [],
  boardIds: [],
};

let latest!: UseChannelTicketsDataReturn;

function Probe({
  channelId,
  filters,
}: {
  channelId: string;
  filters: ChannelTicketsFilters;
}): ReactElement | null {
  latest = useChannelTicketsData(channelId, filters);
  return null;
}

const mount = (
  filters: ChannelTicketsFilters = NO_FILTERS,
  channelId = 'ch-1',
): ReactTestRenderer => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<Probe channelId={channelId} filters={filters} />);
  });
  return renderer;
};

const lastTicketsCall = (): QueryCall => {
  const call = [...calls].reverse().find(c => c.name === 'supportTicketsPageV3');
  if (!call) throw new Error('supportTicketsPageV3 was not queried');
  return call;
};

describe('useChannelTicketsData', () => {
  beforeEach(() => {
    calls.length = 0;
    queryRows = [];
    queryType = 'complete';
    clearChannelTicketsPaintCache();
    mockedUseCachedQuery.mockImplementation(((query: QueryCall) => {
      calls.push(query);
      return [queryRows, { type: queryType }, { source: 'fresh' }];
    }) as never);
  });

  it('queries the first window with membership and no filter args', () => {
    mount();
    expect(lastTicketsCall().args).toEqual({
      channelId: 'ch-1',
      isMember: true,
      limit: CHANNEL_TICKETS_PAGE_SIZE + 1,
      start: null,
      dir: 'forward',
    });
    expect(latest.isMember).toBe(true);
  });

  it('maps rows, drops archived / Support rows and reports empty correctly', () => {
    queryRows = [
      ...makeSourceRows(2),
      ...makeSourceRows(1, { id: 'archived', isArchived: true }),
      ...makeSourceRows(1, { id: 'support', ticketType: 'Support' }),
    ];
    mount();
    expect(latest.rows.map(r => r.id)).toEqual(['t-0', 't-1']);
    expect(latest.isEmpty).toBe(false);
    expect(latest.hasMore).toBe(false);
    expect(latest.isInitialLoading).toBe(false);
  });

  it('derives hasMore from the sentinel row and hides it from the rows', () => {
    queryRows = makeSourceRows(CHANNEL_TICKETS_PAGE_SIZE + 1);
    mount();
    expect(latest.hasMore).toBe(true);
    expect(latest.rows).toHaveLength(CHANNEL_TICKETS_PAGE_SIZE);
  });

  it('loadMore grows the single query window instead of adding a query', () => {
    queryRows = makeSourceRows(CHANNEL_TICKETS_PAGE_SIZE + 1);
    mount();
    act(() => latest.loadMore());
    expect(lastTicketsCall().args['limit']).toBe(CHANNEL_TICKETS_PAGE_SIZE * 2 + 1);
    expect(calls.filter(c => c.name === 'supportTicketsPageV3').length).toBeGreaterThan(0);
  });

  it('a filter change resets the window to one page and passes normalised args', () => {
    queryRows = makeSourceRows(CHANNEL_TICKETS_PAGE_SIZE + 1);
    const renderer = mount();
    act(() => latest.loadMore());
    expect(lastTicketsCall().args['limit']).toBe(CHANNEL_TICKETS_PAGE_SIZE * 2 + 1);

    act(() => {
      renderer.update(
        <Probe
          channelId='ch-1'
          filters={{ ...NO_FILTERS, assigneeIds: ['u-2', 'u-1'], stageNames: ['Done'] }}
        />,
      );
    });
    const args = lastTicketsCall().args;
    expect(args['limit']).toBe(CHANNEL_TICKETS_PAGE_SIZE + 1);
    expect(args['assignedTo']).toEqual(['u-1', 'u-2']);
    expect(args['stageName']).toEqual(['Done']);
  });

  it('is initial-loading while pending with nothing to paint, then paints from cache', () => {
    queryType = 'unknown';
    mount();
    expect(latest.isInitialLoading).toBe(true);
    expect(latest.isEmpty).toBe(false);

    // A completed unfiltered page seeds the paint cache …
    queryType = 'complete';
    queryRows = makeSourceRows(3);
    mount();
    expect(latest.rows).toHaveLength(3);

    // … so the next cold mount shows it while the live query is still pending.
    queryType = 'unknown';
    queryRows = [];
    mount();
    expect(latest.rows.map(r => r.id)).toEqual(['t-0', 't-1', 't-2']);
    expect(latest.isInitialLoading).toBe(false);
  });

  it('applies the board filter client-side and auto-grows a thin window', () => {
    queryRows = [
      ...makeSourceRows(CHANNEL_TICKETS_PAGE_SIZE, { boardId: 'b-1' }),
      ...makeSourceRows(1, { id: 'sentinel', boardId: 'b-1' }),
    ].map((row, index) => (index === 0 ? { ...row, boardId: 'b-2' } : row));
    mount({ ...NO_FILTERS, boardIds: ['b-2'] });
    expect(latest.rows.map(r => r.boardId)).toEqual(['b-2']);
    // One visible row out of a full page → the hook asked for the next window itself.
    expect(lastTicketsCall().args['limit']).toBe(CHANNEL_TICKETS_PAGE_SIZE * 2 + 1);
  });
});
