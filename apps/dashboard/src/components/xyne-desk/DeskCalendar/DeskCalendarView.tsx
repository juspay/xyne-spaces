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

type SupportTicketsArgs = Parameters<typeof queries.supportTicketsPageV3>[0];

/** Row cap for one rendered span — supportTicketsPageV3's `limit` is required. */
const RANGE_LIMIT = 50000;

/** Mounted keyed by its query args so a span change never serves a stale span's cached rows. */
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

/** Drives the toolbar/views directly (not the `CalendarView` wrapper) so it can own currentDate. */
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

  const step = viewMode === 'month' ? addMonths : viewMode === 'week' ? addWeeks : addDays;
  const handleNavigate = (direction: 'prev' | 'next' | 'today'): void =>
    setCurrentDate(prev =>
      direction === 'today' ? new Date() : step(prev, direction === 'prev' ? -1 : 1),
    );

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
    // Omitted on a non-overlapping span, since the zod refine throws on an inverted range.
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
