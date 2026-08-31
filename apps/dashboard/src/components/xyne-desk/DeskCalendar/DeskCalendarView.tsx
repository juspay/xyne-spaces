import { useEffect, useMemo, type ReactElement } from 'react';
import type { Ticket, TicketPriority } from '@xyne/shared';
import { CalendarView } from '../../Tickets/CalendarView';
import { queries } from '../../../zero/queries';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import type { DynamicFieldQueryFilter } from '../../../utils/board/dynamicFieldFilters';

interface DeskCalendarViewProps {
  channelId: string;
  isMember: boolean;
  ticketFilter: {
    assignedTo?: string[] | undefined;
    createdBy?: string[] | undefined;
    priority?: TicketPriority[] | undefined;
    stageName?: string[] | undefined;
    aiCategory?: string[] | undefined;
    conversationIdWhitelist?: string[] | undefined;
    hasAiDraft?: boolean | undefined;
    userGroups?: string[] | undefined;
    lastEmailAtStart?: number | undefined;
    lastEmailAtEnd?: number | undefined;
    createdAtStart?: number | undefined;
    createdAtEnd?: number | undefined;
    dynamicFieldFilters?: DynamicFieldQueryFilter[] | undefined;
    conversationLabelId?: string | undefined;
  };
  onTicketClick: (ticket: Ticket) => void;
  onTicketsLoaded?: (tickets: Ticket[]) => void;
}

/**
 * DeskCalendarView — a full desk view (sibling to Kanban/List/Table) showing this
 * channel's tickets on a calendar. This is a thin data-adapter, nothing more: it fetches
 * tickets the exact same way every other Desk view does (`supportTicketsPageV3` +
 * `ticketFilter`) and hands them to the app's existing, already-built ticket calendar —
 * `components/Tickets/CalendarView` (also used by KanbanBoardScreen's calendar mode) —
 * rather than reimplementing a month grid, day drill-down, or ticket cards from scratch.
 */
export const DeskCalendarView = ({
  channelId,
  isMember,
  ticketFilter,
  onTicketClick,
  onTicketsLoaded,
}: DeskCalendarViewProps): ReactElement => {
  // supportTicketsPageV3's schema has no `conversationIdWhitelist` field — it's
  // `conversationIds`. Every other caller (TicketListView, SupportScreen's own nav
  // queries) renames it before spreading; skipping that here silently drops the
  // "AI Tags" filter for this view since the zod schema just strips the unknown key.
  // The grid groups by createdAt, so the date range must filter on createdAt too.
  const { conversationIdWhitelist, lastEmailAtStart, lastEmailAtEnd, ...restTicketFilter } =
    ticketFilter;

  const [rows, rowsDetails] = useCachedQuery(
    queries.supportTicketsPageV3({
      channelId,
      isMember,
      ...restTicketFilter,
      ...(conversationIdWhitelist !== undefined
        ? { conversationIds: conversationIdWhitelist }
        : {}),
      createdAtStart: ticketFilter.createdAtStart ?? lastEmailAtStart,
      createdAtEnd: ticketFilter.createdAtEnd ?? lastEmailAtEnd,
      limit: 500,
      start: null,
      dir: 'forward',
    }),
    { enabled: !!channelId },
  );
  // Memoized so the identity only changes when the query result does — that keeps the
  // notify-parent effect below honest about its dependencies instead of suppressing them.
  const tickets = useMemo(
    () => (rowsDetails?.type === 'complete' ? ((rows ?? []) as unknown as Ticket[]) : []),
    [rows, rowsDetails?.type],
  );

  useEffect(() => {
    onTicketsLoaded?.(tickets);
  }, [tickets, onTicketsLoaded]);

  return <CalendarView tickets={tickets} onTicketClick={onTicketClick} />;
};
