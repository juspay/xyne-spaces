/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories run before imports and cannot reference module scope */
import { describe, expect, it, jest } from '@jest/globals';
import { type ReactElement } from 'react';
import { act, create } from 'react-test-renderer';
import { TicketPriority } from '@xyne/shared';

jest.mock('@xyne/shared', () => require('../../../mocks/xyne-shared'));

jest.mock('@/src/hooks/useUsers', () => ({
  useUsers: () => [
    { id: 'u-1', name: 'Krishna Rao' },
    { id: 'u-2', name: 'Priya Nair' },
  ],
}));
jest.mock('@/src/utils/channel-utils', () => ({
  getUserDisplayName: (user: { name: string }) => user.name,
}));

import {
  useChannelTicketsFilters,
  type UseChannelTicketsFiltersReturn,
} from '@/src/features/channel-tickets/hooks/use-channel-tickets-filters';

const BOARDS = new Map([
  ['b-1', 'Payments'],
  ['b-2', 'Platform'],
]);

let latest!: UseChannelTicketsFiltersReturn;

function Probe(): ReactElement | null {
  latest = useChannelTicketsFilters(BOARDS);
  return null;
}

const mount = (): void => {
  act(() => {
    create(<Probe />);
  });
};

describe('useChannelTicketsFilters', () => {
  it('starts empty with placeholder labels', () => {
    mount();
    expect(latest.hasActiveFilters).toBe(false);
    expect(latest.labels).toEqual({
      assignee: 'Assignee',
      priority: 'Priority',
      stage: 'Stages',
      board: 'Boards',
    });
  });

  it('labels selections Gmail-style and resolves names', () => {
    mount();
    act(() => latest.setAssigneeIds(['u-1', 'u-2']));
    act(() => latest.setBoardIds(['b-2']));
    act(() => latest.togglePriority(TicketPriority.HIGH));
    act(() => latest.togglePriority(TicketPriority.LOW));
    act(() => latest.setStageNames(['Done', 'QA']));
    expect(latest.hasActiveFilters).toBe(true);
    expect(latest.labels.assignee).toBe('Krishna + 1 more');
    expect(latest.labels.board).toBe('Platform');
    expect(latest.labels.priority).toBe('Low + 1 more');
    expect(latest.labels.stage).toBe('Done + 1 more');
  });

  it('toggling a priority twice removes it', () => {
    mount();
    act(() => latest.togglePriority(TicketPriority.HIGH));
    act(() => latest.togglePriority(TicketPriority.HIGH));
    expect(latest.filters.priorities).toEqual([]);
    expect(latest.hasActiveFilters).toBe(false);
  });

  it('changing the board resets the stage selection (stages are board-scoped)', () => {
    mount();
    act(() => latest.setStageNames(['Done']));
    act(() => latest.setBoardIds(['b-1']));
    expect(latest.filters.stageNames).toEqual([]);
    expect(latest.filters.boardIds).toEqual(['b-1']);
  });

  it('clearAll empties everything and keeps empty arrays referentially stable', () => {
    mount();
    const emptyAssignees = latest.filters.assigneeIds;
    act(() => latest.setAssigneeIds(['u-1']));
    act(() => latest.setBoardIds(['b-1']));
    act(() => latest.clearAll());
    expect(latest.hasActiveFilters).toBe(false);
    expect(latest.filters.assigneeIds).toBe(emptyAssignees);
    act(() => latest.setAssigneeIds([]));
    expect(latest.filters.assigneeIds).toBe(emptyAssignees);
  });
});
