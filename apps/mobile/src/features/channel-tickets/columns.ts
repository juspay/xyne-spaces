import type { ColumnDef } from '@tanstack/react-table';

import type { ChannelTicketColumnKey, ChannelTicketColumnMeta, ChannelTicketRow } from './types';

/**
 * TanStack column model for the channel tickets table.
 *
 * Deliberately free of React Native imports: the table state / column model is
 * headless, cells are rendered by `channel-ticket-cell.tsx` switching on `meta.key`.
 * `size` is the fixed pixel width used by both header and body (no measuring).
 * Order is tuned so the first viewport is useful on a phone without scrolling.
 */
export type ChannelTicketColumnDef = ColumnDef<ChannelTicketRow, unknown> & {
  id: ChannelTicketColumnKey;
  size: number;
  meta: ChannelTicketColumnMeta;
};

export const CHANNEL_TICKET_COLUMNS: readonly ChannelTicketColumnDef[] = [
  {
    id: 'ticket',
    header: 'Ticket',
    accessorFn: row => row.title,
    size: 220,
    meta: { key: 'ticket', align: 'left' },
  },
  {
    id: 'board',
    header: 'Board',
    accessorFn: row => row.boardId,
    size: 120,
    meta: { key: 'board', align: 'left' },
  },
  {
    id: 'status',
    header: 'Status',
    accessorFn: row => row.statusV2,
    size: 120,
    meta: { key: 'status', align: 'left' },
  },
  {
    id: 'priority',
    header: 'Priority',
    accessorFn: row => row.priority,
    size: 110,
    meta: { key: 'priority', align: 'left' },
  },
  {
    id: 'assignee',
    header: 'Assignee',
    accessorFn: row => row.assignee?.id ?? null,
    size: 150,
    meta: { key: 'assignee', align: 'left' },
  },
  {
    id: 'dueDate',
    header: 'Due',
    accessorFn: row => row.eta,
    size: 110,
    meta: { key: 'dueDate', align: 'left' },
  },
  {
    id: 'stage',
    header: 'Stage',
    accessorFn: row => row.stageName,
    size: 130,
    meta: { key: 'stage', align: 'left' },
  },
  {
    id: 'createdAt',
    header: 'Created',
    accessorFn: row => row.createdAt,
    size: 120,
    meta: { key: 'createdAt', align: 'left' },
  },
  {
    id: 'age',
    header: 'Age',
    accessorFn: row => row.createdAt,
    size: 64,
    meta: { key: 'age', align: 'center' },
  },
];

/** Total content width of the table; the horizontal scroller's minWidth. */
export const CHANNEL_TICKETS_TABLE_WIDTH = CHANNEL_TICKET_COLUMNS.reduce(
  (total, column) => total + column.size,
  0,
);

export function getChannelTicketColumnMeta(meta: unknown): ChannelTicketColumnMeta | null {
  if (!meta || typeof meta !== 'object') return null;
  const candidate = meta as Partial<ChannelTicketColumnMeta>;
  if (typeof candidate.key !== 'string') return null;
  return { key: candidate.key, align: candidate.align === 'center' ? 'center' : 'left' };
}
