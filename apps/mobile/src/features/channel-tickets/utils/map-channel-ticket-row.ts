import { BaseTicketType } from '@xyne/shared';
import type { TicketPriority, TicketStatusV2 } from '@xyne/shared';

import type { ChannelTicketRow } from '../types';
import { formatTicketAge } from './format-ticket-age';
import { formatTicketDate } from './format-ticket-date';
import { isEtaUrgent } from './is-eta-urgent';
import { parseAssigneeRef } from './parse-assignee-ref';

/** Structural subset of a `supportTicketsPageV3` row that the mapper reads. */
export type ChannelTicketSourceRow = {
  id: string;
  xyneId?: string | null;
  title?: string | null;
  conversationId?: string | null;
  channelId?: string | null;
  boardId?: string | null;
  statusV2?: TicketStatusV2 | string | null;
  priority?: TicketPriority | string | null;
  stageName?: string | null;
  assignedTo?: string | null;
  eta?: number | null;
  createdAt?: number | null;
  isArchived?: boolean | null;
  ticketType?: string | null;
};

export type MapChannelTicketRowsOptions = {
  /** Injected for deterministic Age / urgency in tests. */
  now: number;
};

/** True when the row should be hidden: archived, or a desk (Support) ticket. */
export function isHiddenChannelTicket(row: ChannelTicketSourceRow): boolean {
  if (row.isArchived) return true;
  return (row.ticketType ?? null) === BaseTicketType.Support;
}

export function mapChannelTicketRow(
  row: ChannelTicketSourceRow,
  options: MapChannelTicketRowsOptions,
): ChannelTicketRow {
  const createdAt = row.createdAt ?? 0;
  const eta = row.eta ?? null;
  const statusV2 = (row.statusV2 ?? null) as TicketStatusV2 | null;

  return {
    id: row.id,
    xyneId: (row.xyneId ?? '').trim() || row.id,
    title: (row.title ?? '').trim() || 'Untitled ticket',
    conversationId: row.conversationId ?? '',
    channelId: row.channelId ?? '',
    boardId: row.boardId ?? '',
    statusV2,
    priority: (row.priority ?? null) as TicketPriority | null,
    stageName: (row.stageName ?? '').trim() || null,
    assignee: parseAssigneeRef(row.assignedTo),
    eta,
    createdAt,
    createdAtLabel: formatTicketDate(createdAt),
    ageLabel: formatTicketAge(createdAt, options.now),
    dueDateLabel: formatTicketDate(eta),
    isDueUrgent: isEtaUrgent(eta, statusV2, options.now),
  };
}

/**
 * Pure map from query rows → table rows. Drops hidden rows, de-duplicates by id,
 * preserves server order (the query already orders newest first).
 */
export function mapChannelTicketRows(
  rows: readonly ChannelTicketSourceRow[] | null | undefined,
  options: MapChannelTicketRowsOptions,
): ChannelTicketRow[] {
  const seen = new Set<string>();
  const items: ChannelTicketRow[] = [];

  for (const row of rows ?? []) {
    if (!row.id || seen.has(row.id)) continue;
    if (isHiddenChannelTicket(row)) continue;
    seen.add(row.id);
    items.push(mapChannelTicketRow(row, options));
  }

  return items;
}

/** Client-side board scoping (the pinned query has no board argument). */
export function filterChannelTicketRowsByBoard(
  rows: readonly ChannelTicketRow[],
  boardIds: readonly string[],
): ChannelTicketRow[] {
  if (boardIds.length === 0) return [...rows];
  const allowed = new Set(boardIds);
  return rows.filter(row => allowed.has(row.boardId));
}
