import { TicketPriority, TicketStatusV2 } from '@xyne/shared';

import type {
  ChannelTicketRow,
  ChannelTicketsFilterDrawerItem,
  ChannelTicketsLookups,
  ChannelTicketsPalette,
} from '@/src/features/channel-tickets/types';
import type { ChannelTicketSourceRow } from '@/src/features/channel-tickets/utils/map-channel-ticket-row';

export const DAY_MS = 86_400_000;
/** Fixed "now": 2026-09-04T12:00 local. */
export const NOW = new Date(2026, 8, 4, 12, 0, 0).getTime();

export const PALETTE: ChannelTicketsPalette = {
  foreground: '#111111',
  secondary: '#666666',
  urgent: '#dc2626',
  accent: '#2563eb',
  tableHeaderText: '#666666',
  sheetHeader: '#212121',
  sheetLabel: '#212121',
  sheetMuted: '#989898',
  sheetIcon: '#7a7a7a',
  divider: '#eeeeee',
  byVar: new Map([
    ['--color-ticket-status-todo', '#ea580c'],
    ['--color-ticket-status-todo-soft', '#fff1e6'],
    ['--color-ticket-status-started', '#2563eb'],
    ['--color-ticket-status-started-soft', '#e8f0fe'],
    ['--color-ticket-status-completed', '#16a34a'],
    ['--color-ticket-status-completed-soft', '#e8f7ec'],
  ]),
};

export const LOOKUPS: ChannelTicketsLookups = {
  boardNameById: new Map([
    ['b-1', 'Payments'],
    ['b-2', 'Platform'],
  ]),
  groupNameById: new Map([['g-1', 'Risk squad']]),
  userNameById: new Map([
    ['u-1', 'Krishna Rao'],
    ['u-2', 'Priya Nair'],
  ]),
};

export const makeRow = (overrides: Partial<ChannelTicketRow> = {}): ChannelTicketRow => ({
  id: 't-1',
  xyneId: 'UPI-1',
  title: 'Fix payment retry',
  conversationId: 'c-1',
  channelId: 'ch-1',
  boardId: 'b-1',
  statusV2: TicketStatusV2.STARTED,
  priority: TicketPriority.HIGH,
  stageName: 'In Progress',
  assignee: { kind: 'user', id: 'u-1' },
  eta: NOW - 3 * DAY_MS,
  createdAt: NOW - 12 * DAY_MS,
  createdAtLabel: 'Aug 23, 2026',
  ageLabel: '12d',
  dueDateLabel: 'Sep 1, 2026',
  isDueUrgent: true,
  ...overrides,
});

export const makeSourceRow = (
  overrides: Partial<ChannelTicketSourceRow> = {},
): ChannelTicketSourceRow => ({
  id: 't-1',
  xyneId: 'UPI-1',
  title: 'Fix payment retry',
  conversationId: 'c-1',
  channelId: 'ch-1',
  boardId: 'b-1',
  statusV2: TicketStatusV2.STARTED,
  priority: TicketPriority.HIGH,
  stageName: 'In Progress',
  assignedTo: 'user:u-1',
  eta: NOW - 3 * DAY_MS,
  createdAt: NOW - 12 * DAY_MS,
  isArchived: false,
  ticketType: null,
  ...overrides,
});

/** `count` distinct source rows, ids t-0 … t-(count-1). */
export const makeSourceRows = (
  count: number,
  overrides: Partial<ChannelTicketSourceRow> = {},
): ChannelTicketSourceRow[] =>
  Array.from({ length: count }, (_, index) =>
    makeSourceRow({ id: `t-${index}`, xyneId: `UPI-${index}`, ...overrides }),
  );

export const DRAWER_ITEMS: ChannelTicketsFilterDrawerItem[] = [
  { kind: 'boards', label: 'Board', value: 'Boards', isActive: false },
  { kind: 'assignee', label: 'Assignee', value: 'Krishna + 1 more', isActive: true },
  { kind: 'priority', label: 'Priority', value: 'Priority', isActive: false },
  { kind: 'stages', label: 'Stage', value: 'Stages', isActive: false },
];
