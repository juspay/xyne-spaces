/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories run before imports and cannot reference module scope */
import { describe, expect, it, jest } from '@jest/globals';
import { type ReactElement } from 'react';
import { act, create } from 'react-test-renderer';

import { useTicketConversationLabelFilterOptions } from '@/src/features/xyne-desks/tickets/hooks/use-ticket-conversation-label-filter-options';

jest.mock('@/src/zero/queries', () => ({
  queries: {
    getAllMerchants: jest.fn(() => ({})),
  },
}));

jest.mock('@/src/hooks/useCachedQuery', () => ({
  useCachedQuery: jest.fn(() => [undefined]),
}));

type HookReturn = ReturnType<typeof useTicketConversationLabelFilterOptions>;
let latest!: HookReturn;

function Probe({ channelId }: { channelId: string }): ReactElement | null {
  latest = useTicketConversationLabelFilterOptions(channelId);
  return null;
}

describe('useTicketConversationLabelFilterOptions', () => {
  it('does not expose label options before the shared query exists', () => {
    act(() => {
      create(<Probe channelId='ch-1' />);
    });

    expect(latest.isAvailable).toBe(false);
    expect(latest.options).toEqual([]);
  });
});
