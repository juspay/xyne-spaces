/* eslint-disable @typescript-eslint/no-require-imports, react/display-name -- jest.mock factories run before imports and cannot reference module scope */
import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { TicketPriority, TicketStatusV2 } from '@xyne/shared';

jest.mock('@xyne/shared', () => require('../../../mocks/xyne-shared'));

jest.mock('uniwind', () => ({ useCSSVariable: () => '#abcdef' }));

jest.mock('lucide-react-native', () => {
  const React = require('react') as typeof import('react');
  const { Text } = require('react-native') as typeof import('react-native');
  const stub = (name: string) => () => React.createElement(Text, null, `${name}-icon`);
  return new Proxy({}, { get: (_t, prop: string) => stub(prop) });
});

jest.mock('@/src/components/ui/avatar', () => {
  const React = require('react') as typeof import('react');
  const { Text } = require('react-native') as typeof import('react-native');
  return {
    __esModule: true,
    default: ({ userIds }: { userIds: readonly string[] }) =>
      React.createElement(Text, null, `avatar:${userIds.join(',')}`),
  };
});

import { ChannelTicketCell } from '@/src/features/channel-tickets/components/channel-ticket-cell';
import type { ChannelTicketColumnKey } from '@/src/features/channel-tickets/types';

import { LOOKUPS, PALETTE, makeRow } from './fixtures';

const renderCell = (
  columnKey: ChannelTicketColumnKey,
  overrides: Parameters<typeof makeRow>[0] = {},
): void => {
  render(
    <ChannelTicketCell
      row={makeRow(overrides)}
      columnKey={columnKey}
      align='left'
      width={120}
      palette={PALETTE}
      lookups={LOOKUPS}
    />,
  );
};

describe('ChannelTicketCell', () => {
  it('ticket: shows the human id and the title', () => {
    renderCell('ticket');
    expect(screen.getByText('UPI-1')).toBeTruthy();
    expect(screen.getByText('Fix payment retry')).toBeTruthy();
  });

  it('board: resolves the board name, shows … while unresolved and — when unset', () => {
    renderCell('board');
    expect(screen.getByText('Payments')).toBeTruthy();
    screen.unmount();
    renderCell('board', { boardId: 'b-unknown' });
    expect(screen.getByText('…')).toBeTruthy();
    screen.unmount();
    renderCell('board', { boardId: '' });
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('status: renders the dashboard label with the palette colours', () => {
    renderCell('status', { statusV2: TicketStatusV2.COMPLETED });
    const label = screen.getByText('Completed');
    expect(label.props['style']).toEqual(expect.objectContaining({ color: '#16a34a' }));
  });

  it('status: falls back for null', () => {
    renderCell('status', { statusV2: null });
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('priority: icon + label, or — when unset', () => {
    renderCell('priority', { priority: TicketPriority.CRITICAL });
    expect(screen.getByText('Critical')).toBeTruthy();
    expect(screen.getByText('TriangleAlert-icon')).toBeTruthy();
    screen.unmount();
    renderCell('priority', { priority: null });
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('assignee: user name with avatar, group name, or Unassigned', () => {
    renderCell('assignee');
    expect(screen.getByText('Krishna Rao')).toBeTruthy();
    expect(screen.getByText('avatar:u-1')).toBeTruthy();
    screen.unmount();
    renderCell('assignee', { assignee: { kind: 'group', id: 'g-1' } });
    expect(screen.getByText('Risk squad')).toBeTruthy();
    screen.unmount();
    renderCell('assignee', { assignee: { kind: 'user', id: 'u-missing' } });
    expect(screen.getByText('Unknown')).toBeTruthy();
    screen.unmount();
    renderCell('assignee', { assignee: null });
    expect(screen.getByText('Unassigned')).toBeTruthy();
  });

  it('dueDate: urgent rows use the urgent colour and an overdue label', () => {
    renderCell('dueDate');
    const label = screen.getByText('Sep 1, 2026');
    expect(label.props['style']).toEqual(expect.objectContaining({ color: PALETTE.urgent }));
    expect(screen.getByLabelText('Overdue Sep 1, 2026')).toBeTruthy();
    screen.unmount();
    renderCell('dueDate', { isDueUrgent: false });
    expect(screen.getByText('Sep 1, 2026').props['style']).toEqual(
      expect.objectContaining({ color: PALETTE.secondary }),
    );
  });

  it('stage / createdAt / age: plain text with fallbacks', () => {
    renderCell('stage');
    expect(screen.getByText('In Progress')).toBeTruthy();
    screen.unmount();
    renderCell('stage', { stageName: null });
    expect(screen.getByText('—')).toBeTruthy();
    screen.unmount();
    renderCell('createdAt');
    expect(screen.getByText('Aug 23, 2026')).toBeTruthy();
    screen.unmount();
    renderCell('age');
    expect(screen.getByText('12d')).toBeTruthy();
  });

  it('sizes and tags the cell by column', () => {
    renderCell('age');
    const cell = screen.getByTestId('channel-ticket-cell-age');
    expect(cell.props['style']).toEqual(expect.objectContaining({ width: 120 }));
  });
});
