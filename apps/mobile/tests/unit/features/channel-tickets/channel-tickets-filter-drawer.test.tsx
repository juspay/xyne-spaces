/* eslint-disable @typescript-eslint/no-require-imports, react/display-name -- jest.mock factories run before imports and cannot reference module scope */
import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';

jest.mock('@xyne/shared', () => require('../../../mocks/xyne-shared'));

const mockDismiss = jest.fn();

jest.mock('@/src/components/ui/app-bottom-sheet', () => {
  const React = require('react') as typeof import('react');
  const { View } = require('react-native') as typeof import('react-native');
  const AppBottomSheet = React.forwardRef(function AppBottomSheet(
    {
      children,
      isOpen,
      mode,
      snapPoints,
    }: { children: ReactNode; isOpen: boolean; mode: string; snapPoints?: number[] },
    ref: React.Ref<{ dismiss: () => void }>,
  ) {
    React.useImperativeHandle(ref, () => ({ dismiss: mockDismiss }));
    return isOpen
      ? React.createElement(
          View,
          { testID: 'sheet', accessibilityLabel: `${mode}:${snapPoints?.join(',') ?? ''}` },
          children,
        )
      : null;
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

jest.mock('lucide-react-native', () => {
  const React = require('react') as typeof import('react');
  const { Text } = require('react-native') as typeof import('react-native');
  const stub = (name: string) => () => React.createElement(Text, null, `${name}-icon`);
  return new Proxy({}, { get: (_t, prop: string) => stub(prop) });
});

jest.mock('@/src/utils/haptics', () => ({ haptics: { buttonTap: jest.fn() } }));

import {
  ChannelTicketsFilterDrawer,
  channelTicketsDrawerHeight,
  DRAWER_CHROME_HEIGHT,
  DRAWER_ROW_HEIGHT,
  type ChannelTicketsFilterDrawerProps,
} from '@/src/features/channel-tickets/components/channel-tickets-filter-drawer';

import { DRAWER_ITEMS, PALETTE } from './fixtures';

const renderDrawer = (
  overrides: Partial<ChannelTicketsFilterDrawerProps> = {},
): { onSelect: jest.Mock; onClearAll: jest.Mock; onOpenChange: jest.Mock } => {
  const onSelect = jest.fn();
  const onClearAll = jest.fn();
  const onOpenChange = jest.fn();
  render(
    <ChannelTicketsFilterDrawer
      isOpen
      items={DRAWER_ITEMS}
      hasActiveFilters
      palette={PALETTE}
      bottomInset={34}
      onOpenChange={onOpenChange}
      onSelect={onSelect}
      onClearAll={onClearAll}
      {...overrides}
    />,
  );
  return { onSelect, onClearAll, onOpenChange };
};

describe('ChannelTicketsFilterDrawer', () => {
  it('lists every filter with its current value, "Any" when unset', () => {
    renderDrawer();
    expect(screen.getByText('Board')).toBeTruthy();
    expect(screen.getByText('Krishna + 1 more')).toBeTruthy();
    expect(screen.getAllByText('Any')).toHaveLength(3);
    expect(screen.getByLabelText('Assignee: Krishna + 1 more')).toBeTruthy();
  });

  it('hands a tapped row to the parent', () => {
    const { onSelect } = renderDrawer();
    fireEvent.press(screen.getByTestId('channel-tickets-filter-row-priority'));
    expect(onSelect).toHaveBeenCalledWith('priority');
  });

  it('"Clear all" clears and dismisses; hidden when nothing is active', () => {
    const { onClearAll } = renderDrawer();
    fireEvent.press(screen.getByLabelText('Clear all filters'));
    expect(onClearAll).toHaveBeenCalledTimes(1);
    expect(mockDismiss).toHaveBeenCalledTimes(1);
    screen.unmount();

    renderDrawer({ hasActiveFilters: false });
    expect(screen.queryByLabelText('Clear all filters')).toBeNull();
  });

  it('renders nothing while closed', () => {
    renderDrawer({ isOpen: false });
    expect(screen.queryByTestId('sheet')).toBeNull();
  });

  it('is snap-sized from the row count (never measured content)', () => {
    renderDrawer();
    const expected = DRAWER_CHROME_HEIGHT + DRAWER_ITEMS.length * DRAWER_ROW_HEIGHT + 34;
    expect(channelTicketsDrawerHeight(DRAWER_ITEMS.length, 34)).toBe(expected);
    expect(screen.getByLabelText(`snap:${expected}`)).toBeTruthy();
    // Home-indicator-less devices still get a minimum bottom padding.
    expect(channelTicketsDrawerHeight(2, 0)).toBe(DRAWER_CHROME_HEIGHT + 2 * DRAWER_ROW_HEIGHT + 8);
  });
});
