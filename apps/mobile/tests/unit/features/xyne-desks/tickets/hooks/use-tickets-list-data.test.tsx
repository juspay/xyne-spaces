/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories run before imports and cannot reference module scope */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { type ReactElement } from 'react';
import { act, create } from 'react-test-renderer';
import { MailboxState } from '@xyne/shared';

jest.mock('@xyne/shared', () => require('../../../../../mocks/xyne-shared'));

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
import { TICKETS_PAGE_SIZE } from '@/src/features/xyne-desks/tickets/constants';
import {
  useTicketsListData,
  type UseTicketsListDataOptions,
  type UseTicketsListDataReturn,
} from '@/src/features/xyne-desks/tickets/hooks/use-tickets-list-data';
import type {
  TicketListItemData,
  TicketMailboxFolder,
} from '@/src/features/xyne-desks/tickets/types';
import {
  clearTicketsPaintCache,
  setTicketsPaintCache,
} from '@/src/features/xyne-desks/tickets/utils/tickets-list-paint-cache';

const mockedUseCachedQuery = jest.mocked(useCachedQuery);

type QueryCall = { name: string; args: Record<string, unknown> };
const queryCalls: QueryCall[] = [];

const PAGE_ROWS = [
  { id: 'inbox', title: 'Inbox ticket', lastEmailAt: 3 },
  {
    id: 'overlay-archived',
    title: 'Archived overlay',
    lastEmailAt: 2,
    userMailbox: [{ state: MailboxState.ARCHIVED }],
  },
  { id: 'ticket-archived', title: 'Ticket archived', lastEmailAt: 1, isArchived: true },
  {
    id: 'spam',
    title: 'Spam',
    lastEmailAt: 0,
    userMailbox: [{ state: MailboxState.SPAM }],
  },
];

let latest!: UseTicketsListDataReturn;

function Probe({
  mailboxFolder,
}: {
  mailboxFolder?: TicketMailboxFolder | undefined;
}): ReactElement | null {
  const options: UseTicketsListDataOptions | undefined =
    mailboxFolder !== undefined ? { mailboxFolder } : undefined;
  latest = useTicketsListData('ch-1', options);
  return null;
}

const mount = (mailboxFolder?: TicketMailboxFolder): void => {
  act(() => {
    create(<Probe mailboxFolder={mailboxFolder} />);
  });
};

describe('useTicketsListData mailbox folders', () => {
  beforeEach(() => {
    queryCalls.length = 0;
    clearTicketsPaintCache();
    mockedUseCachedQuery.mockImplementation(((query: QueryCall) => {
      queryCalls.push(query);
      return [PAGE_ROWS, { type: 'complete' }, { source: 'fresh' }];
    }) as never);
  });

  it('shows overlay-archived tickets in All Mail but not Inbox', () => {
    mount('inbox');
    expect(latest.items.map(item => item.id)).toEqual(['inbox']);

    mount('all');
    expect(latest.items.map(item => item.id)).toEqual(['inbox', 'overlay-archived']);
  });

  it('does not surface ticket-level archived rows in All Mail (V4 drops them)', () => {
    mount('all');
    expect(latest.items.map(item => item.id)).not.toContain('ticket-archived');
    expect(latest.items.map(item => item.id)).not.toContain('spam');
  });

  it('APP/Slack (no mailboxFolder) keep the archive guard', () => {
    mount();
    expect(latest.items.map(item => item.id)).not.toContain('ticket-archived');
    expect(latest.items.map(item => item.id)).toEqual(['inbox', 'overlay-archived', 'spam']);
  });

  it('asks for a growing window (page size + sentinel)', () => {
    mount();
    expect(queryCalls[0]?.args['limit']).toBe(TICKETS_PAGE_SIZE + 1);
  });

  it('auto-grows Inbox when a dense first page is all non-inbox rows', () => {
    mockedUseCachedQuery.mockImplementation(((query: QueryCall) => {
      queryCalls.push(query);
      const limit = Number(query.args['limit'] ?? 0);
      const archived = Array.from({ length: TICKETS_PAGE_SIZE }, (_, i) => ({
        id: `arch-${i}`,
        title: 'Archived',
        lastEmailAt: 2000 - i,
        userMailbox: [{ state: MailboxState.ARCHIVED }],
      }));
      const inboxLate = { id: 'inbox-late', title: 'Inbox late', lastEmailAt: 1 };
      return [[...archived, inboxLate].slice(0, limit), { type: 'complete' }, { source: 'fresh' }];
    }) as never);

    mount('inbox');
    expect(latest.items.map(item => item.id)).toEqual(['inbox-late']);
    expect(queryCalls.some(call => call.args['limit'] === TICKETS_PAGE_SIZE * 2 + 1)).toBe(true);
  });

  it('does not reuse the unfiltered paint cache while Inbox is pending', () => {
    setTicketsPaintCache('session-1', 'ch-1', [
      { id: 'spam-cached' } as TicketListItemData,
      { id: 'archived-cached' } as TicketListItemData,
    ]);
    mockedUseCachedQuery.mockImplementation(((query: QueryCall) => {
      queryCalls.push(query);
      return [undefined, { type: 'unknown' }, { source: 'unknown' }];
    }) as never);

    mount('inbox');
    expect(latest.items.map(item => item.id)).not.toContain('spam-cached');
    expect(latest.items.map(item => item.id)).not.toContain('archived-cached');
    expect(latest.items).toEqual([]);
    expect(latest.isInitialLoading).toBe(true);
  });
});
