/**
 * The real results component, request builder and search hook over a mocked HTTP
 * layer: what is asserted is which requests a given screen state actually sends.
 */
/* eslint-disable @typescript-eslint/no-require-imports, react/display-name -- jest.mock factories run before imports and cannot reference module scope */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SharedValue } from 'react-native-reanimated';

import { SearchResults } from '@/src/features/global-search/components/search-results';
import {
  createSearchState,
  type SearchState,
} from '@/src/features/global-search/hooks/use-search-state';
import type { SearchFilterChip, SearchScope } from '@/src/features/global-search/types';
import { apiGet } from '@/src/services/apiClient';

jest.mock('@/src/services/apiClient', () => ({ apiGet: jest.fn() }));

jest.mock('@/src/features/global-search/hooks/use-directory-search', () => ({
  usePeopleSearch: () => [{ id: 'u1', title: 'Ada Lovelace' }],
  useGroupDmsSearch: () => [{ id: 'g1', title: 'Ada, Grace', avatarUserIds: [] }],
  useChannelsSearch: () => [{ id: 'c1', title: '#engineering' }],
  useInTargetsSearch: () => [{ id: 'c1', title: '#engineering', kind: 'channel' }],
}));

jest.mock('@/src/features/global-search/hooks/use-search-navigation', () => ({
  useSearchNavigation: () => ({
    openResult: jest.fn(),
    openPerson: jest.fn(),
    openGroupDm: jest.fn(),
    openChannel: jest.fn(),
  }),
}));

jest.mock('@/src/features/global-search/hooks/use-call-results', () => ({
  useCallResults: (raw: { id: string; title: string }[]) =>
    raw.map(hit => ({ call: { id: hit.id, title: hit.title } })),
}));

jest.mock('@/src/components/call-log', () => {
  const React = require('react') as typeof import('react');
  const { Text } = require('react-native') as typeof import('react-native');
  return {
    CallLogItem: ({ call }: { call: { title: string } }) =>
      React.createElement(Text, null, call.title),
  };
});

jest.mock('@legendapp/list/keyboard', () => {
  const React = require('react') as typeof import('react');
  const { View } = require('react-native') as typeof import('react-native');
  return {
    KeyboardAwareLegendList: ({
      data,
      renderItem,
      ListEmptyComponent,
    }: {
      data: { key: string }[];
      renderItem: (info: { item: unknown }) => React.ReactElement | null;
      ListEmptyComponent: React.ReactElement;
    }) =>
      React.createElement(
        View,
        null,
        data.length === 0
          ? ListEmptyComponent
          : data.map(item => React.createElement(View, { key: item.key }, renderItem({ item }))),
      ),
  };
});

jest.mock('@/src/features/global-search/components/search-results-shimmer', () => {
  const React = require('react') as typeof import('react');
  const { Text } = require('react-native') as typeof import('react-native');
  return { SearchResultsShimmer: () => React.createElement(Text, null, 'loading') };
});

function mockRow(prop: 'item' | 'result') {
  const React = require('react') as typeof import('react');
  const { Text } = require('react-native') as typeof import('react-native');
  return (props: Record<string, unknown> & { onPress?: (value: unknown) => void }) => {
    const value = props[prop] as { title: string };
    return React.createElement(Text, { onPress: () => props.onPress?.(value) }, value.title);
  };
}

jest.mock('@/src/features/global-search/components/rows/search-result-row', () => ({
  SearchResultRow: mockRow('result'),
}));
jest.mock('@/src/features/global-search/components/rows/search-person-row', () => ({
  SearchPersonRow: mockRow('item'),
}));
jest.mock('@/src/features/global-search/components/rows/search-group-dm-row', () => ({
  SearchGroupDmRow: mockRow('item'),
}));
jest.mock('@/src/features/global-search/components/rows/search-channel-row', () => ({
  SearchChannelRow: mockRow('item'),
}));
jest.mock('@/src/features/global-search/components/rows/search-in-target-row', () => ({
  SearchInTargetRow: mockRow('item'),
}));

jest.mock('@/src/theme/useBubbleAccent', () => ({
  useBubbleAccent: () => ({ accentSoft: '#eeeeee', accentText: '#111111' }),
}));
jest.mock('@/src/utils/haptics', () => ({ haptics: { buttonTap: jest.fn() } }));

const mockedApiGet = apiGet as jest.MockedFunction<typeof apiGet>;

const scope: SearchScope = { channelId: 'chan-1', label: 'engineering' };
const fromAda: SearchFilterChip = { id: 'u1', label: 'Ada', prefix: 'from:', entityType: 'user' };

function renderResults(
  overrides: Partial<SearchState>,
  options: { scope?: SearchScope | null; onPickFilter?: (chip: SearchFilterChip) => void } = {},
): void {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });

  render(
    <QueryClientProvider client={client}>
      <SearchResults
        state={{ ...createSearchState('messages'), ...overrides }}
        scope={options.scope ?? null}
        onPickFilter={options.onPickFilter ?? jest.fn()}
        onLeave={jest.fn()}
        listContentTop={0}
        bottomContentInset={0}
        scrollOffset={{ value: 0 } as SharedValue<number>}
      />
    </QueryClientProvider>,
  );
}

function sentParams(): URLSearchParams[] {
  return mockedApiGet.mock.calls.map(([path]) => new URLSearchParams(path.split('?')[1]));
}

beforeEach(() => {
  const respond = (path: string): Promise<unknown> => {
    const type = new URLSearchParams(path.split('?')[1]).get('type');
    return Promise.resolve({
      success: true,
      data: {
        results: [{ id: 'r1', title: `a ${type} hit`, metadata: {} }],
        totalCount: 1,
        offset: 0,
        limit: 25,
      },
    });
  };
  mockedApiGet.mockImplementation(respond as typeof apiGet);
});

describe('SearchResults', () => {
  describe('tabs searched on-device', () => {
    it('lists people and group DMs on DMs without a request', () => {
      renderResults({ tab: 'chats', query: 'ada' });

      expect(screen.getByText('Ada Lovelace')).toBeTruthy();
      expect(screen.getByText('Ada, Grace')).toBeTruthy();
      expect(mockedApiGet).not.toHaveBeenCalled();
    });

    it('lists channels on Channels without a request', () => {
      renderResults({ tab: 'channels', query: 'eng' });

      expect(screen.getByText('#engineering')).toBeTruthy();
      expect(mockedApiGet).not.toHaveBeenCalled();
    });

    it('sends no request for filters either', () => {
      renderResults({ tab: 'chats', chips: [fromAda] });

      expect(mockedApiGet).not.toHaveBeenCalled();
    });

    it('shows nothing when only filters are set, which these lists cannot apply', () => {
      renderResults({ tab: 'chats', chips: [fromAda] });

      expect(screen.queryByText('Ada Lovelace')).toBeNull();
      expect(screen.getByText('No matching people')).toBeTruthy();
    });

    it('shows suggestions before anything is typed', () => {
      renderResults({ tab: 'chats' });

      expect(screen.getByText('Suggested')).toBeTruthy();
    });
  });

  describe('tabs searched on the backend', () => {
    const remoteTabs = ['messages', 'tickets', 'files', 'calls'] as const;

    for (const tab of remoteTabs) {
      it(`sends one request on ${tab}, for ${tab} only`, async () => {
        renderResults({ tab, query: 'deploy' });

        await waitFor(() => expect(screen.getByText(`a ${tab} hit`)).toBeTruthy());
        expect(sentParams().map(params => params.get('type'))).toEqual([tab]);
      });
    }

    it('sends nothing until the user asks for something', () => {
      renderResults({ tab: 'messages' });

      expect(screen.getByText('Search messages')).toBeTruthy();
      expect(mockedApiGet).not.toHaveBeenCalled();
    });

    it('searches on filters alone', async () => {
      renderResults({ tab: 'messages', chips: [fromAda] });

      await waitFor(() => expect(mockedApiGet).toHaveBeenCalledTimes(1));
      expect(sentParams()[0]?.get('from')).toBe('u1');
      expect(sentParams()[0]?.get('filterOnly')).toBe('true');
    });

    it('says so when nothing matches', async () => {
      mockedApiGet.mockResolvedValue({
        success: true,
        data: { results: [], totalCount: 0, offset: 0, limit: 25 },
      } as never);

      renderResults({ tab: 'tickets', query: 'deploy' });

      await waitFor(() => expect(screen.getByText('No matching tickets')).toBeTruthy());
    });
  });

  describe('while a from: or in: operator is being typed', () => {
    const trigger = { kind: 'from', query: 'ad', startIndex: 7, inMode: 'all' } as const;

    it('shows suggestions instead of searching', () => {
      renderResults({ tab: 'messages', query: 'urgent', trigger });

      expect(screen.getByText('Ada Lovelace')).toBeTruthy();
      expect(mockedApiGet).not.toHaveBeenCalled();
    });

    it('hands the picked person back as a from: chip', () => {
      const onPickFilter = jest.fn();
      renderResults({ tab: 'messages', trigger }, { onPickFilter });

      fireEvent.press(screen.getByText('Ada Lovelace'));

      expect(onPickFilter).toHaveBeenCalledWith({
        id: 'u1',
        label: 'Ada Lovelace',
        prefix: 'from:',
        entityType: 'user',
      });
    });

    it('hands the picked conversation back as an in: chip', () => {
      const onPickFilter = jest.fn();
      renderResults(
        { tab: 'messages', trigger: { ...trigger, kind: 'in', query: 'eng' } },
        { onPickFilter },
      );

      fireEvent.press(screen.getByText('#engineering'));

      expect(onPickFilter).toHaveBeenCalledWith({
        id: 'c1',
        label: 'engineering',
        prefix: 'in:',
        entityType: 'channel',
        targetKind: 'channel',
      });
    });
  });

  describe('locked to one conversation', () => {
    it('opens idle, naming the conversation, without a request', () => {
      renderResults({ tab: 'chats' }, { scope });

      expect(screen.getByText('Search messages in engineering')).toBeTruthy();
      expect(screen.queryByText('No matching messages')).toBeNull();
      expect(mockedApiGet).not.toHaveBeenCalled();
    });

    it('searches messages in that conversation once there is text', async () => {
      renderResults({ tab: 'chats', query: 'deploy' }, { scope });

      await waitFor(() => expect(screen.getByText('a messages hit')).toBeTruthy());
      expect(sentParams()).toHaveLength(1);
      expect(sentParams()[0]?.get('type')).toBe('messages');
      expect(sentParams()[0]?.get('in')).toBe('chan-1');
    });
  });
});
