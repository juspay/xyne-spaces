import { useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  addDays,
  addWeeks,
  addMonths,
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
} from 'date-fns';
import type { Ticket, TicketPriority } from '@xyne/shared';
import {
  CalendarToolbar,
  MonthView,
  WeekView,
  DayView,
  type CalendarViewMode,
} from '../../Tickets/CalendarView';
import { queries } from '../../../zero/queries';
import { useFallbackHydratedQuery } from '@xyne/shared/hooks';
import type { DynamicFieldQueryFilter } from '../../../utils/board/dynamicFieldFilters';

/** Row cap for one rendered span — a 42-cell month at ~120 tickets/day. */
const RANGE_LIMIT = 5000;

type SupportTicketsArgs = Parameters<typeof queries.supportTicketsPageV3>[0];

/**
 * Fetches and renders ONE span, mounted keyed by its query args: useFallbackHydratedQuery
 * holds its REST-seed state per component rather than per query hash, so a single instance
 * would seed only the first span and could serve a previous span's rows as `complete`.
 */
const RangeCalendar = ({
  args,
  enabled,
  currentDate,
  viewMode,
  onTicketClick,
  onTicketsLoaded,
}: {
  args: SupportTicketsArgs;
  enabled: boolean;
  currentDate: Date;
  viewMode: CalendarViewMode;
  onTicketClick: (ticket: Ticket) => void;
  onTicketsLoaded?: (tickets: Ticket[]) => void;
}): ReactElement => {
  const [rows, details] = useFallbackHydratedQuery(queries.supportTicketsPageV3(args), { enabled });
  const tickets = useMemo(
    () => (details?.type === 'complete' ? ((rows ?? []) as unknown as Ticket[]) : []),
    [rows, details?.type],
  );

  useEffect(() => {
    onTicketsLoaded?.(tickets);
  }, [tickets, onTicketsLoaded]);

  const View = viewMode === 'month' ? MonthView : viewMode === 'week' ? WeekView : DayView;
  return <View currentDate={currentDate} tickets={tickets} onTicketClick={onTicketClick} />;
};

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
 * `ticketFilter`) and renders the app's existing calendar pieces — CalendarToolbar and the
 * Month/Week/Day views from `components/Tickets/CalendarView` — rather than reimplementing a
 * month grid, day drill-down, or ticket cards. It drives those directly instead of their
 * `CalendarView` wrapper, which keeps the current date private: rows are ordered by
 * lastEmailAt while the grid buckets by createdAt, so the fetch must be scoped to the span
 * on screen or a page is just the recently active tickets, not the days rendered.
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
  const {
    conversationIdWhitelist,
    lastEmailAtStart,
    lastEmailAtEnd,
    createdAtStart: filterCreatedAtStart,
    createdAtEnd: filterCreatedAtEnd,
    ...restTicketFilter
  } = ticketFilter;

  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<CalendarViewMode>('month');

  const handleNavigate = (direction: 'prev' | 'next' | 'today'): void => {
    const delta = direction === 'prev' ? -1 : 1;
    setCurrentDate(prev => {
      if (direction === 'today') return new Date();
      if (viewMode === 'month') return addMonths(prev, delta);
      if (viewMode === 'week') return addWeeks(prev, delta);
      return addDays(prev, delta);
    });
  };

  // Month pads to whole weeks, matching the cells MonthView builds.
  const visibleRange = useMemo(() => {
    if (viewMode === 'day') return { start: startOfDay(currentDate), end: endOfDay(currentDate) };
    const first = viewMode === 'month' ? startOfMonth(currentDate) : currentDate;
    const last = viewMode === 'month' ? endOfMonth(currentDate) : currentDate;
    return { start: startOfWeek(first), end: endOfWeek(last) };
  }, [currentDate, viewMode]);

  // The toolbar's date filter narrows the visible span; it never widens it.
  const filterStart = filterCreatedAtStart ?? lastEmailAtStart;
  const filterEnd = filterCreatedAtEnd ?? lastEmailAtEnd;
  const createdAtStart = Math.max(visibleRange.start.getTime(), filterStart ?? -Infinity);
  const createdAtEnd = Math.min(visibleRange.end.getTime(), filterEnd ?? Infinity);
  const hasOverlap = createdAtStart <= createdAtEnd;

  const queryArgs: SupportTicketsArgs = {
    channelId,
    isMember,
    ...restTicketFilter,
    ...(conversationIdWhitelist !== undefined ? { conversationIds: conversationIdWhitelist } : {}),
    // Omitted when the span and the filter do not overlap: the zod refine rejects an inverted
    // range by throwing while the query is built, which `enabled` is too late to prevent.
    ...(hasOverlap ? { createdAtStart, createdAtEnd } : {}),
    limit: RANGE_LIMIT,
    start: null,
    dir: 'forward',
  };

  return (
    <div className='flex flex-col h-full bg-background'>
      <CalendarToolbar
        currentDate={currentDate}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onNavigate={handleNavigate}
      />
      <RangeCalendar
        key={JSON.stringify(queryArgs)}
        args={queryArgs}
        enabled={!!channelId && hasOverlap}
        currentDate={currentDate}
        viewMode={viewMode}
        onTicketClick={onTicketClick}
        {...(onTicketsLoaded ? { onTicketsLoaded } : {})}
      />
    </div>
  );
};
