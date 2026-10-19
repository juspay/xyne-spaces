/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories run before imports and cannot reference module scope */
import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';

jest.mock('@xyne/shared', () => require('../../../mocks/xyne-shared'));

jest.mock('lucide-react-native', () => {
  const React = require('react') as typeof import('react');
  const { Text } = require('react-native') as typeof import('react-native');
  return {
    ListFilter: ({ color }: { color: string }) =>
      React.createElement(Text, null, `filter:${color}`),
    Search: ({ color }: { color: string }) => React.createElement(Text, null, `search:${color}`),
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

import { ChannelTicketsHeader } from '@/src/features/channel-tickets/components/channel-tickets-header';

const renderHeader = (
  hasActiveFilters: boolean,
  isSearchOpen = false,
): { onBack: jest.Mock; onOpenFilters: jest.Mock; onOpenSearch: jest.Mock } => {
  const onBack = jest.fn();
  const onOpenFilters = jest.fn();
  const onOpenSearch = jest.fn();
  render(
    <ChannelTicketsHeader
      channelName='payments-core'
      hasActiveFilters={hasActiveFilters}
      isSearchOpen={isSearchOpen}
      topInset={0}
      foregroundColor='#111111'
      accentColor='#2563eb'
      onBack={onBack}
      onOpenSearch={onOpenSearch}
      onOpenFilters={onOpenFilters}
    />,
  );
  return { onBack, onOpenFilters, onOpenSearch };
};

describe('ChannelTicketsHeader', () => {
  it('shows the title and the channel name', () => {
    renderHeader(false);
    expect(screen.getByText('Tickets')).toBeTruthy();
    expect(screen.getByText('payments-core')).toBeTruthy();
  });

  it('wires back, search and filters', () => {
    const { onBack, onOpenFilters, onOpenSearch } = renderHeader(false);
    fireEvent.press(screen.getByLabelText('Back'));
    fireEvent.press(screen.getByLabelText('Search'));
    fireEvent.press(screen.getByLabelText('Filters'));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onOpenSearch).toHaveBeenCalledTimes(1);
    expect(onOpenFilters).toHaveBeenCalledTimes(1);
  });

  it('marks search mode on the search button', () => {
    renderHeader(false, true);
    expect(screen.getByLabelText('Search (active)')).toBeTruthy();
    expect(screen.getByText('search:#2563eb')).toBeTruthy();
  });

  it('marks active filters with the accent colour and a dot', () => {
    renderHeader(false);
    expect(screen.getByText('filter:#111111')).toBeTruthy();
    expect(screen.queryByTestId('channel-tickets-filters-active-dot')).toBeNull();
    screen.unmount();

    renderHeader(true);
    expect(screen.getByLabelText('Filters (active)')).toBeTruthy();
    expect(screen.getByText('filter:#2563eb')).toBeTruthy();
    expect(screen.getByTestId('channel-tickets-filters-active-dot')).toBeTruthy();
  });
});
