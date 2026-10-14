/* eslint-disable @typescript-eslint/no-require-imports, react/display-name -- jest.mock factories run before imports and cannot reference module scope */
import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('@xyne/shared', () => require('../../../mocks/xyne-shared'));

jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native') as typeof import('react-native');
  return {
    __esModule: true,
    default: { View },
    useSharedValue: (value: unknown) => ({ value }),
    useAnimatedStyle: () => ({}),
    withRepeat: (value: unknown) => value,
    withTiming: (value: unknown) => value,
    cancelAnimation: () => {},
    Easing: { inOut: () => () => 0, out: () => () => 0, ease: () => 0, cubic: () => 0 },
  };
});

jest.mock('uniwind', () => ({ useCSSVariable: () => '#abcdef' }));

jest.mock('lucide-react-native', () => {
  const React = require('react') as typeof import('react');
  const { Text } = require('react-native') as typeof import('react-native');
  const stub = (name: string) => () => React.createElement(Text, null, `${name}-icon`);
  return new Proxy({}, { get: (_t, prop: string) => stub(prop) });
});

jest.mock('@/src/utils/haptics', () => ({
  haptics: { buttonTap: jest.fn() },
}));

jest.mock('@/src/components/ui/avatar', () => {
  const React = require('react') as typeof import('react');
  const { Text } = require('react-native') as typeof import('react-native');
  return {
    __esModule: true,
    default: ({ userIds }: { userIds: readonly string[] }) =>
      React.createElement(Text, null, `avatar:${userIds.join(',')}`),
  };
});

jest.mock('@/src/components/ui/empty-state/list-empty-state', () => {
  const React = require('react') as typeof import('react');
  const { Text } = require('react-native') as typeof import('react-native');
  return {
    ListEmptyState: ({ title, subtitle }: { title: string; subtitle: string }) =>
      React.createElement(Text, null, `${title} | ${subtitle}`),
  };
});

// Plain, non-virtualised stand-in: renders every row, plus a pressable that
// fires onEndReached so load-more can be exercised without scrolling.
jest.mock('@legendapp/list/react-native', () => {
  const React = require('react') as typeof import('react');
  const { Pressable, View } = require('react-native') as typeof import('react-native');
  // Plain, non-virtualised stand-in: renders every row, plus a pressable that
  // fires onEndReached so load-more can be exercised without scrolling.
  // Kept free of generics / type aliases: jest's hoist check rejects them.
  return {
    LegendList: (props: {
      data: readonly unknown[];
      renderItem: (info: { item: unknown; index: number }) => unknown;
      keyExtractor?: (item: unknown, index: number) => string;
      ListEmptyComponent?: unknown;
      ListFooterComponent?: unknown;
      onEndReached?: () => void;
    }) =>
      React.createElement(
        View,
        { testID: 'legend-list' },
        props.data.length === 0
          ? ((props.ListEmptyComponent as React.ReactNode) ?? null)
          : props.data.map((item, index) =>
              React.createElement(
                View,
                { key: props.keyExtractor ? props.keyExtractor(item, index) : String(index) },
                props.renderItem({ item, index }) as React.ReactNode,
              ),
            ),
        (props.ListFooterComponent as React.ReactNode) ?? null,
        React.createElement(Pressable, {
          testID: 'legend-list-end',
          onPress: () => props.onEndReached?.(),
        }),
      ),
  };
});

import {
  ChannelTicketsTable,
  type ChannelTicketsTableProps,
} from '@/src/features/channel-tickets/components/channel-tickets-table';
import { CHANNEL_TICKET_COLUMNS } from '@/src/features/channel-tickets/columns';

import { LOOKUPS, PALETTE, makeRow } from './fixtures';

const renderTable = (
  overrides: Partial<ChannelTicketsTableProps> = {},
): { onLoadMore: jest.Mock; onPressTicket: jest.Mock } => {
  const onLoadMore = jest.fn();
  const onPressTicket = jest.fn();
  render(
    <ChannelTicketsTable
      rows={[makeRow({ id: 't-1', xyneId: 'UPI-1' }), makeRow({ id: 't-2', xyneId: 'UPI-2' })]}
      isEmpty={false}
      isInitialLoading={false}
      hasMore={false}
      isLoadingMore={false}
      hasActiveFilters={false}
      palette={PALETTE}
      lookups={LOOKUPS}
      bottomInset={0}
      onLoadMore={onLoadMore}
      onPressTicket={onPressTicket}
      {...overrides}
    />,
  );
  return { onLoadMore, onPressTicket };
};

describe('ChannelTicketsTable', () => {
  it('renders one header per column and one row per ticket', () => {
    renderTable();
    for (const column of CHANNEL_TICKET_COLUMNS) {
      expect(screen.getByText(column.header as string)).toBeTruthy();
    }
    expect(screen.getByTestId('channel-ticket-row-t-1')).toBeTruthy();
    expect(screen.getByTestId('channel-ticket-row-t-2')).toBeTruthy();
    expect(screen.getByText('UPI-2')).toBeTruthy();
  });

  it('reports the pressed ticket', () => {
    const { onPressTicket } = renderTable();
    fireEvent.press(screen.getByTestId('channel-ticket-row-t-2'));
    expect(onPressTicket).toHaveBeenCalledWith(expect.objectContaining({ id: 't-2' }));
  });

  it('asks for more only when more exists and nothing is in flight', () => {
    const idle = renderTable({ hasMore: true });
    fireEvent.press(screen.getByTestId('legend-list-end'));
    expect(idle.onLoadMore).toHaveBeenCalledTimes(1);
    screen.unmount();

    const exhausted = renderTable({ hasMore: false });
    fireEvent.press(screen.getByTestId('legend-list-end'));
    expect(exhausted.onLoadMore).not.toHaveBeenCalled();
    screen.unmount();

    const busy = renderTable({ hasMore: true, isLoadingMore: true });
    fireEvent.press(screen.getByTestId('legend-list-end'));
    expect(busy.onLoadMore).not.toHaveBeenCalled();
  });

  it('shows a footer spinner while loading more', () => {
    renderTable({ hasMore: true, isLoadingMore: true });
    expect(screen.getByTestId('channel-tickets-loading-more')).toBeTruthy();
  });

  it('shows the skeleton on a cold first load and hides the header row', () => {
    renderTable({ rows: [], isInitialLoading: true });
    expect(screen.getByLabelText('Loading tickets')).toBeTruthy();
    expect(screen.queryByText('Ticket')).toBeNull();
  });

  it('shows the empty state once the query is complete and nothing matched', () => {
    renderTable({ rows: [], isEmpty: true });
    expect(screen.getByText(/No tickets yet/)).toBeTruthy();
    screen.unmount();
    renderTable({ rows: [], isEmpty: true, hasActiveFilters: true });
    expect(screen.getByText(/No tickets match/)).toBeTruthy();
  });
});
