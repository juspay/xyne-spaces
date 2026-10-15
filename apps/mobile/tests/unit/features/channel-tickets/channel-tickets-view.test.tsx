/* eslint-disable @typescript-eslint/no-require-imports, react/display-name -- jest.mock factories run before imports and cannot reference module scope */
import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';

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
jest.mock('@/src/utils/haptics', () => ({ haptics: { buttonTap: jest.fn() } }));
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
    ListEmptyState: ({ title }: { title: string }) => React.createElement(Text, null, title),
  };
});
jest.mock('@/src/components/ui/header-icon-button', () => {
  const React = require('react') as typeof import('react');
  const { Pressable } = require('react-native') as typeof import('react-native');
  return {
    HeaderBackButton: ({ onPress }: { onPress: () => void }) =>
      React.createElement(Pressable, { accessibilityLabel: 'Back', onPress }),
    HeaderIconButton: ({
      onPress,
      accessibilityLabel,
      children,
    }: {
      onPress: () => void;
      accessibilityLabel: string;
      children: ReactNode;
    }) => React.createElement(Pressable, { accessibilityLabel, onPress }, children),
  };
});
jest.mock('@/src/components/ui/app-bottom-sheet', () => {
  const React = require('react') as typeof import('react');
  const { View } = require('react-native') as typeof import('react-native');
  const AppBottomSheet = React.forwardRef(function AppBottomSheet(
    { children, isOpen }: { children: ReactNode; isOpen: boolean },
    ref: React.Ref<{ dismiss: () => void }>,
  ) {
    React.useImperativeHandle(ref, () => ({ dismiss: () => {} }));
    return isOpen ? React.createElement(View, { testID: 'sheet' }, children) : null;
  });
  return { AppBottomSheet };
});
jest.mock('@gorhom/bottom-sheet', () => {
  const React = require('react') as typeof import('react');
  const { View } = require('react-native') as typeof import('react-native');
  return {
    BottomSheetView: ({ children }: { children: ReactNode }) =>
      React.createElement(View, null, children),
  };
});
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
  ChannelTicketsView,
  type ChannelTicketsViewProps,
} from '@/src/features/channel-tickets/components/channel-tickets-view';

import { DRAWER_ITEMS, LOOKUPS, PALETTE, makeRow } from './fixtures';

type Handlers = Pick<
  ChannelTicketsViewProps,
  | 'onBack'
  | 'onOpenSearch'
  | 'onSearchQueryChange'
  | 'onCloseSearch'
  | 'onOpenFilters'
  | 'onDrawerOpenChange'
  | 'onDrawerSelect'
  | 'onClearFilters'
  | 'onLoadMore'
  | 'onPressTicket'
>;

const renderView = (
  overrides: Partial<ChannelTicketsViewProps> = {},
): { [K in keyof Handlers]: jest.Mock } => {
  const handlers = {
    onBack: jest.fn(),
    onOpenSearch: jest.fn(),
    onSearchQueryChange: jest.fn(),
    onCloseSearch: jest.fn(),
    onOpenFilters: jest.fn(),
    onDrawerOpenChange: jest.fn(),
    onDrawerSelect: jest.fn(),
    onClearFilters: jest.fn(),
    onLoadMore: jest.fn(),
    onPressTicket: jest.fn(),
  };
  render(
    <ChannelTicketsView
      channelName='payments-core'
      rows={[makeRow()]}
      isEmpty={false}
      isInitialLoading={false}
      hasMore={false}
      isLoadingMore={false}
      hasActiveFilters
      drawerOpen={false}
      drawerItems={DRAWER_ITEMS}
      isSearchOpen={false}
      searchQuery=''
      isSearching={false}
      searchErrorMessage={null}
      palette={PALETTE}
      lookups={LOOKUPS}
      topInset={0}
      bottomInset={0}
      {...handlers}
      {...overrides}
    />,
  );
  return handlers;
};

describe('ChannelTicketsView', () => {
  it('composes header, table and drawer from props alone', () => {
    renderView();
    expect(screen.getByText('payments-core')).toBeTruthy();
    expect(screen.getByTestId('channel-tickets-table')).toBeTruthy();
    expect(screen.getByText('Fix payment retry')).toBeTruthy();
    expect(screen.queryByTestId('sheet')).toBeNull();
  });

  it('routes header actions and row presses to the container', () => {
    const handlers = renderView();
    fireEvent.press(screen.getByLabelText('Back'));
    fireEvent.press(screen.getByLabelText('Filters (active)'));
    fireEvent.press(screen.getByTestId('channel-ticket-row-t-1'));
    expect(handlers.onBack).toHaveBeenCalledTimes(1);
    expect(handlers.onOpenFilters).toHaveBeenCalledTimes(1);
    expect(handlers.onPressTicket).toHaveBeenCalledWith(expect.objectContaining({ id: 't-1' }));
  });

  it('shows the drawer when open and forwards its selections', () => {
    const handlers = renderView({ drawerOpen: true });
    expect(screen.getByTestId('sheet')).toBeTruthy();
    fireEvent.press(screen.getByTestId('channel-tickets-filter-row-assignee'));
    fireEvent.press(screen.getByLabelText('Clear all filters'));
    expect(handlers.onDrawerSelect).toHaveBeenCalledWith('assignee');
    expect(handlers.onClearFilters).toHaveBeenCalledTimes(1);
  });

  it('shows the search bar in search mode and forwards typing / cancel', () => {
    const handlers = renderView({ isSearchOpen: true, searchQuery: 'retry' });
    expect(screen.getByTestId('channel-tickets-search-bar')).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText('Search tickets'), 'retry again');
    fireEvent.press(screen.getByLabelText('Close search'));
    expect(handlers.onSearchQueryChange).toHaveBeenCalledWith('retry again');
    expect(handlers.onCloseSearch).toHaveBeenCalledTimes(1);
  });

  it('hides the search bar outside search mode', () => {
    renderView();
    expect(screen.queryByTestId('channel-tickets-search-bar')).toBeNull();
  });
});
