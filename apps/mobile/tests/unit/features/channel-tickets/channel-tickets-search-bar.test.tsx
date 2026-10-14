/* eslint-disable @typescript-eslint/no-require-imports, react/display-name -- jest.mock factories run before imports and cannot reference module scope */
import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('@xyne/shared', () => require('../../../mocks/xyne-shared'));
jest.mock('lucide-react-native', () => {
  const React = require('react') as typeof import('react');
  const { Text } = require('react-native') as typeof import('react-native');
  const stub = (name: string) => () => React.createElement(Text, null, `${name}-icon`);
  return new Proxy({}, { get: (_t, prop: string) => stub(prop) });
});

import {
  ChannelTicketsSearchBar,
  type ChannelTicketsSearchBarProps,
} from '@/src/features/channel-tickets/components/channel-tickets-search-bar';

import { PALETTE } from './fixtures';

const renderBar = (
  overrides: Partial<ChannelTicketsSearchBarProps> = {},
): { onChangeQuery: jest.Mock; onClose: jest.Mock } => {
  const onChangeQuery = jest.fn();
  const onClose = jest.fn();
  render(
    <ChannelTicketsSearchBar
      query=''
      placeholder='Search tickets in payments-core'
      isSearching={false}
      errorMessage={null}
      palette={PALETTE}
      onChangeQuery={onChangeQuery}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { onChangeQuery, onClose };
};

describe('ChannelTicketsSearchBar', () => {
  it('forwards typing and cancel', () => {
    const { onChangeQuery, onClose } = renderBar();
    fireEvent.changeText(screen.getByLabelText('Search tickets'), 'retry');
    fireEvent.press(screen.getByLabelText('Close search'));
    expect(onChangeQuery).toHaveBeenCalledWith('retry');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows a clear button only with a query, and clearing empties it', () => {
    renderBar();
    expect(screen.queryByLabelText('Clear search')).toBeNull();
    screen.unmount();

    const { onChangeQuery } = renderBar({ query: 'retry' });
    fireEvent.press(screen.getByLabelText('Clear search'));
    expect(onChangeQuery).toHaveBeenCalledWith('');
  });

  it('reports the wider server search and errors on a status line', () => {
    renderBar({ query: 'retry', isSearching: true });
    expect(screen.getByText('Searching all tickets…')).toBeTruthy();
    screen.unmount();

    renderBar({ query: 'retry', errorMessage: 'vespa down' });
    expect(screen.getByText('vespa down').props['style']).toEqual(
      expect.objectContaining({ color: PALETTE.urgent }),
    );
    screen.unmount();

    renderBar({ query: 'retry' });
    expect(screen.queryByText('Searching all tickets…')).toBeNull();
  });
});
