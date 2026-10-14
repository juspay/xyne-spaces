/**
 * Feature-level test: the real ChannelTicketsScreen container with the real
 * data / filter / picker hooks and the real pure views, over a mocked Zero
 * query layer, mocked stores (users, groups, channels), router, theme and the
 * native sheet / list primitives. Exercises load → table, filter drawer →
 * picker → applied query args, and row press → ticket detail navigation.
 */
/* eslint-disable @typescript-eslint/no-require-imports, react/display-name -- jest.mock factories run before imports and cannot reference module scope */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

jest.mock('@xyne/shared', () => require('../../../mocks/xyne-shared'));

const mockPush = jest.fn();
const mockBack = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
  useLocalSearchParams: () => ({ channelId: 'ch-1' }),
}));
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: () => {} }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, right: 0, bottom: 34, left: 0 }),
}));
jest.mock('uniwind', () => ({ useCSSVariable: (name: string) => `var(${name})` }));
jest.mock('@/src/theme/useBubbleAccent', () => ({
  useBubbleAccent: () => ({ accentText: '#2563eb', accentSoft: '#dbeafe' }),
}));
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
// Controlled sheet stand-in: renders children while open and reports the close
// through onOpenChange, like the real AppBottomSheet does after its animation.
jest.mock('@/src/components/ui/app-bottom-sheet', () => {
  const React = require('react') as typeof import('react');
  const { View } = require('react-native') as typeof import('react-native');
  const AppBottomSheet = React.forwardRef(function AppBottomSheet(
    {
      children,
      isOpen,
      onOpenChange,
    }: { children: ReactNode; isOpen: boolean; onOpenChange: (open: boolean) => void },
    ref: React.Ref<{ dismiss: () => void }>,
  ) {
    const wasOpen = React.useRef(isOpen);
    React.useEffect(() => {
      if (wasOpen.current && !isOpen) onOpenChange(false);
      wasOpen.current = isOpen;
    }, [isOpen, onOpenChange]);
    React.useImperativeHandle(ref, () => ({ dismiss: () => onOpenChange(false) }));
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

// Value pickers: plain stand-ins that expose an "apply" affordance.
jest.mock('@/src/features/xyne-desks/tickets/components/tickets-assignee-filter', () => {
  const React = require('react') as typeof import('react');
  const { Pressable, Text } = require('react-native') as typeof import('react-native');
  return {
    TicketsAssigneeFilterOverlay: ({
      isOpen,
      onApply,
    }: {
      isOpen: boolean;
      onApply: (ids: string[]) => void;
    }) =>
      isOpen
        ? React.createElement(
            Pressable,
            { testID: 'assignee-picker', onPress: () => onApply(['u-2', 'u-1']) },
            React.createElement(Text, null, 'assignee-picker'),
          )
        : null,
  };
});
jest.mock('@/src/features/xyne-desks/tickets/components/tickets-multi-select-filter', () => {
  const React = require('react') as typeof import('react');
  const { Pressable, Text } = require('react-native') as typeof import('react-native');
  return {
    TicketsMultiSelectFilterOverlay: ({
      isOpen,
      title,
      options,
      onApply,
    }: {
      isOpen: boolean;
      title: string;
      options: Array<{ id: string; label: string }>;
      onApply: (ids: string[]) => void;
    }) =>
      isOpen
        ? React.createElement(
            Pressable,
            {
              testID: `${title.toLowerCase()}-picker`,
              onPress: () => onApply([options[0]?.id ?? '']),
            },
            React.createElement(Text, null, options.map(o => o.label).join(',')),
          )
        : null,
  };
});
jest.mock('@/src/features/xyne-desks/tickets/components/tickets-priority-filter', () => {
  const React = require('react') as typeof import('react');
  const { Pressable, Text } = require('react-native') as typeof import('react-native');
  return {
    TicketsPriorityIcon: ({ priority }: { priority: string }) =>
      React.createElement(Text, null, `prio-icon:${priority}`),
    TicketsPriorityFilterSheet: ({
      isOpen,
      onTogglePriority,
    }: {
      isOpen: boolean;
      onTogglePriority: (priority: string) => void;
    }) =>
      isOpen
        ? React.createElement(
            Pressable,
            { testID: 'priority-picker', onPress: () => onTogglePriority('HIGH') },
            React.createElement(Text, null, 'priority-picker'),
          )
        : null,
  };
});
jest.mock('@/src/features/xyne-desks/tickets/hooks', () => {
  const React = require('react') as typeof import('react');
  const useOverlay = (): {
    isMounted: boolean;
    isOpen: boolean;
    progress: { value: number };
    open: () => void;
    close: () => void;
  } => {
    const [isOpen, setIsOpen] = React.useState(false);
    return {
      isMounted: isOpen,
      isOpen,
      progress: { value: isOpen ? 1 : 0 },
      open: () => setIsOpen(true),
      close: () => setIsOpen(false),
    };
  };
  return { useTicketsAssigneeFilterOverlay: useOverlay, useTicketsFilterOverlay: useOverlay };
});

// Stores and data layer.
jest.mock('@/src/contexts/AuthContext', () => ({
  useAuth: () => ({ workspaceSessionKey: 'session-1' }),
}));
jest.mock('@/src/hooks/useChannels', () => ({
  useChannelById: () => ({
    id: 'ch-1',
    name: 'payments-core',
    projectId: 'p-1',
    scopeType: 'DEFAULT',
    type: 'DEFAULT',
  }),
  useUserChannelStatuses: () => [{ channelId: 'ch-1' }],
}));
jest.mock('@/src/hooks/useUsers', () => ({
  useUsers: () => [
    { id: 'u-1', name: 'Krishna Rao' },
    { id: 'u-2', name: 'Priya Nair' },
  ],
}));
jest.mock('@/src/hooks/useUserGroups', () => ({
  useUserGroups: () => [{ id: 'g-1', name: 'Risk squad' }],
}));
jest.mock('@/src/utils/channel-utils', () => ({
  getUserDisplayName: (user: { name: string }) => user.name,
}));
jest.mock('@/src/zero/queries', () => ({
  queries: new Proxy({}, { get: (_target, name: string) => (args: unknown) => ({ name, args }) }),
}));
jest.mock('@/src/hooks/useCachedQuery', () => ({ useCachedQuery: jest.fn() }));
jest.mock('@/src/services/globalSearchService', () => ({
  globalSearchService: { search: jest.fn() },
}));

import { useCachedQuery } from '@/src/hooks/useCachedQuery';
import { globalSearchService } from '@/src/services/globalSearchService';
import ChannelTicketsScreen from '@/src/features/channel-tickets/components/channel-tickets-screen';
import { clearChannelTicketsPaintCache } from '@/src/features/channel-tickets/utils/channel-tickets-paint-cache';

import { makeSourceRow } from './fixtures';

type QueryCall = { name: string; args: Record<string, unknown> };
const mockedUseCachedQuery = jest.mocked(useCachedQuery);
const mockedSearch = jest.mocked(globalSearchService.search);
const ticketCalls: QueryCall[] = [];

const ROWS = [
  makeSourceRow({ id: 't-1', xyneId: 'UPI-1', title: 'Fix payment retry', assignedTo: 'user:u-1' }),
  makeSourceRow({
    id: 't-2',
    xyneId: 'UPI-2',
    title: 'Rotate webhook secret',
    boardId: 'b-2',
    assignedTo: 'group:g-1',
  }),
  makeSourceRow({ id: 't-3', xyneId: 'UPI-3', title: 'Archived one', isArchived: true }),
];

const lastTicketArgs = (): Record<string, unknown> => {
  const call = ticketCalls.at(-1);
  if (!call) throw new Error('no tickets query');
  return call.args;
};

describe('ChannelTicketsScreen (feature)', () => {
  beforeEach(() => {
    ticketCalls.length = 0;
    mockPush.mockClear();
    mockBack.mockClear();
    clearChannelTicketsPaintCache();
    mockedSearch.mockReset();
    mockedSearch.mockResolvedValue({ results: [], totalCount: 0, offset: 0, limit: 50 });
    mockedUseCachedQuery.mockImplementation(((query: QueryCall) => {
      switch (query.name) {
        case 'ticketsByIds': {
          const ids = (query.args['ticketIds'] as string[]) ?? [];
          return [
            ids.includes('t-9')
              ? [makeSourceRow({ id: 't-9', xyneId: 'UPI-9', title: 'Retry budget alarm' })]
              : [],
            { type: 'complete' },
            { source: 'fresh' },
          ];
        }
        case 'supportTicketsPageV3':
          ticketCalls.push(query);
          return [ROWS, { type: 'complete' }, { source: 'fresh' }];
        case 'boardsListByProject':
          return [
            [
              { id: 'b-1', name: 'Payments' },
              { id: 'b-2', name: 'Platform' },
            ],
            { type: 'complete' },
            { source: 'fresh' },
          ];
        case 'stagesByBoards':
          return [
            [{ name: 'Backlog' }, { name: 'Done' }],
            { type: 'complete' },
            { source: 'fresh' },
          ];
        case 'stagesByBoard':
          return [[{ name: 'Done' }], { type: 'complete' }, { source: 'fresh' }];
        default:
          return [[], { type: 'complete' }, { source: 'fresh' }];
      }
    }) as never);
  });

  it('renders the channel tickets as a table with resolved names', () => {
    render(<ChannelTicketsScreen />);
    expect(screen.getByText('payments-core')).toBeTruthy();
    expect(screen.getByText('Fix payment retry')).toBeTruthy();
    expect(screen.getByText('Rotate webhook secret')).toBeTruthy();
    expect(screen.queryByText('Archived one')).toBeNull();
    expect(screen.getByText('Krishna Rao')).toBeTruthy();
    expect(screen.getByText('Risk squad')).toBeTruthy();
    expect(screen.getByText('Payments')).toBeTruthy();
    expect(screen.getByText('Platform')).toBeTruthy();
    expect(lastTicketArgs()).toEqual(
      expect.objectContaining({ channelId: 'ch-1', isMember: true, start: null }),
    );
  });

  it('opens a ticket in the shared detail screen with the chat params', () => {
    render(<ChannelTicketsScreen />);
    fireEvent.press(screen.getByTestId('channel-ticket-row-t-2'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/ticket/[ticketId]',
      params: { ticketId: 't-2', channelId: 'ch-1', threadId: 'c-1' },
    });
  });

  it('filters: drawer → assignee picker → applied server-side and shown in the drawer', () => {
    render(<ChannelTicketsScreen />);
    fireEvent.press(screen.getByLabelText('Filters'));
    expect(screen.getByTestId('sheet')).toBeTruthy();
    expect(screen.getByTestId('channel-tickets-filter-row-boards')).toBeTruthy();
    expect(screen.getByTestId('channel-tickets-filter-row-stages')).toBeTruthy();

    fireEvent.press(screen.getByTestId('channel-tickets-filter-row-assignee'));
    // Drawer closed, then the picker opened from its close callback.
    expect(screen.queryByTestId('sheet')).toBeNull();
    fireEvent.press(screen.getByTestId('assignee-picker'));

    expect(lastTicketArgs()['assignedTo']).toEqual(['u-1', 'u-2']);
    expect(screen.getByLabelText('Filters (active)')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Filters (active)'));
    expect(screen.getByLabelText('Assignee: Priya + 1 more')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Clear all filters'));
    expect(lastTicketArgs()['assignedTo']).toBeUndefined();
    expect(screen.getByLabelText('Filters')).toBeTruthy();
  });

  it('filters: board is client-side and narrows the stage options', () => {
    render(<ChannelTicketsScreen />);
    fireEvent.press(screen.getByLabelText('Filters'));
    fireEvent.press(screen.getByTestId('channel-tickets-filter-row-boards'));
    fireEvent.press(screen.getByTestId('boards-picker'));

    // Board is not a query arg; rows are filtered on the client.
    expect(lastTicketArgs()['boardId']).toBeUndefined();
    expect(screen.getByText('Fix payment retry')).toBeTruthy();
    expect(screen.queryByText('Rotate webhook secret')).toBeNull();

    fireEvent.press(screen.getByLabelText('Filters (active)'));
    fireEvent.press(screen.getByTestId('channel-tickets-filter-row-stages'));
    expect(screen.getByText('Done')).toBeTruthy();
    expect(screen.queryByText('Backlog,Done')).toBeNull();
  });

  it('filters: priority toggles through the sheet', () => {
    render(<ChannelTicketsScreen />);
    fireEvent.press(screen.getByLabelText('Filters'));
    fireEvent.press(screen.getByTestId('channel-tickets-filter-row-priority'));
    fireEvent.press(screen.getByTestId('priority-picker'));
    expect(lastTicketArgs()['priority']).toEqual(['HIGH']);
  });

  it('back closes an open drawer first, then leaves the screen', () => {
    render(<ChannelTicketsScreen />);
    fireEvent.press(screen.getByLabelText('Filters'));
    fireEvent.press(screen.getByLabelText('Back'));
    expect(mockBack).not.toHaveBeenCalled();
    expect(screen.queryByTestId('sheet')).toBeNull();
    fireEvent.press(screen.getByLabelText('Back'));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('search: filters the table locally at once, then merges channel-scoped Vespa hits', async () => {
    mockedSearch.mockResolvedValue({
      results: [
        { id: 't-9', searchContext: { ticketId: 't-9', channelId: 'ch-1' } },
        { id: 'elsewhere', searchContext: { ticketId: 'elsewhere', channelId: 'ch-2' } },
      ],
      totalCount: 2,
      offset: 0,
      limit: 50,
    } as never);

    render(<ChannelTicketsScreen />);
    fireEvent.press(screen.getByLabelText('Search'));
    expect(screen.getByLabelText('Search (active)')).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText('Search tickets'), 'retry');

    // Local match is immediate; the non-matching loaded row is gone.
    expect(screen.getByText('Fix payment retry')).toBeTruthy();
    expect(screen.queryByText('Rotate webhook secret')).toBeNull();

    // After the debounce the Vespa hit outside the window is hydrated and appended.
    await waitFor(() => expect(screen.getByText('Retry budget alarm')).toBeTruthy());
    expect(mockedSearch).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'retry', type: 'tickets', in: 'ch-1' }),
    );
    expect(screen.queryByText('elsewhere')).toBeNull();

    // Cancel restores the full table.
    fireEvent.press(screen.getByLabelText('Close search'));
    expect(screen.queryByTestId('channel-tickets-search-bar')).toBeNull();
    expect(screen.getByText('Rotate webhook secret')).toBeTruthy();
  });

  it('search: back closes search mode before leaving the screen', () => {
    render(<ChannelTicketsScreen />);
    fireEvent.press(screen.getByLabelText('Search'));
    fireEvent.press(screen.getByLabelText('Back'));
    expect(mockBack).not.toHaveBeenCalled();
    expect(screen.queryByTestId('channel-tickets-search-bar')).toBeNull();
    fireEvent.press(screen.getByLabelText('Back'));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
