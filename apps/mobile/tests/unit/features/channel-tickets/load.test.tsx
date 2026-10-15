/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories run before imports and cannot reference module scope */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, render, screen } from '@testing-library/react-native';
import { Suspense, type ReactElement } from 'react';
import { Text, View } from 'react-native';
import { act as rendererAct, create } from 'react-test-renderer';

jest.mock('@xyne/shared', () => require('../../../mocks/xyne-shared'));

jest.mock('@/src/hooks/useChannels', () => ({
  useUserChannelStatuses: () => [{ channelId: 'ch-1' }],
}));
jest.mock('@/src/zero/queries', () => ({
  queries: new Proxy({}, { get: (_target, name: string) => (args: unknown) => ({ name, args }) }),
}));
jest.mock('@/src/hooks/useCachedQuery', () => ({ useCachedQuery: jest.fn() }));

// The real screen drags the whole table in; a stub proves the lazy boundary.
jest.mock('@/src/features/channel-tickets/components/channel-tickets-screen', () => {
  const React = require('react') as typeof import('react');
  const { Text } = require('react-native') as typeof import('react-native');
  return { __esModule: true, default: () => React.createElement(Text, null, 'screen-stub') };
});

import { useCachedQuery } from '@/src/hooks/useCachedQuery';
import { CHANNEL_TICKETS_PAGE_SIZE } from '@/src/features/channel-tickets/constants';
import {
  LazyChannelTicketsScreen,
  loadChannelTicketsScreen,
  useChannelTicketsWarmup,
  useIsChannelMember,
} from '@/src/features/channel-tickets/load';

const mockedUseCachedQuery = jest.mocked(useCachedQuery);
type QueryCall = {
  query: { name: string; args: Record<string, unknown> };
  options: { enabled?: boolean };
};
const calls: QueryCall[] = [];

function WarmupProbe({
  channelId,
  enabled,
}: {
  channelId: string;
  enabled: boolean;
}): ReactElement | null {
  useChannelTicketsWarmup(channelId, enabled);
  return null;
}

let memberResult = false;
function MemberProbe({ channelId }: { channelId: string }): ReactElement | null {
  memberResult = useIsChannelMember(channelId);
  return null;
}

describe('load.ts', () => {
  beforeEach(() => {
    calls.length = 0;
    mockedUseCachedQuery.mockImplementation(((
      query: QueryCall['query'],
      options: QueryCall['options'],
    ) => {
      calls.push({ query, options });
      return [[], { type: 'complete' }, { source: 'fresh' }];
    }) as never);
  });

  it('memoises the screen module promise', async () => {
    const first = loadChannelTicketsScreen();
    const second = loadChannelTicketsScreen();
    expect(first).toBe(second);
    await expect(first).resolves.toEqual(
      expect.objectContaining({ default: expect.any(Function) }),
    );
  });

  it('renders the lazily loaded screen once the module has resolved', async () => {
    // Suspending at the very root is not something react-test-renderer can
    // observe (the fallback tree is torn down when the module lands), so settle
    // the memoised promise first: a resolved `lazy` renders synchronously, which
    // is exactly the warm path the Info screen prepares for.
    await loadChannelTicketsScreen();
    // A host View around the boundary keeps react-test-renderer's root alive
    // across the suspended pass.
    render(
      <View testID='host'>
        <Suspense fallback={<Text>loading</Text>}>
          <LazyChannelTicketsScreen />
        </Suspense>
      </View>,
    );
    // React resolves the lazy on its own microtask even when the promise has
    // already settled, so flush one act() turn before asserting.
    await act(async () => {});
    expect(screen.getByText('screen-stub')).toBeTruthy();
    expect(screen.queryByText('loading')).toBeNull();
  });

  it('resolves membership from channel statuses', () => {
    rendererAct(() => {
      create(<MemberProbe channelId='ch-1' />);
    });
    expect(memberResult).toBe(true);
    rendererAct(() => {
      create(<MemberProbe channelId='ch-other' />);
    });
    expect(memberResult).toBe(false);
  });

  it('warms the unfiltered first page only when the gate passes', () => {
    rendererAct(() => {
      create(<WarmupProbe channelId='ch-1' enabled={false} />);
    });
    expect(calls.at(-1)?.options.enabled).toBe(false);

    rendererAct(() => {
      create(<WarmupProbe channelId='ch-1' enabled />);
    });
    const warm = calls.at(-1);
    expect(warm?.options.enabled).toBe(true);
    expect(warm?.query.name).toBe('supportTicketsPageV3');
    // Byte-identical to the screen's own first-page args so the cache is shared.
    expect(warm?.query.args).toEqual({
      channelId: 'ch-1',
      isMember: true,
      limit: CHANNEL_TICKETS_PAGE_SIZE + 1,
      start: null,
      dir: 'forward',
    });
  });
});
