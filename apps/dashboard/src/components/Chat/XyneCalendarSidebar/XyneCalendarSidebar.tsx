import { memo, type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from '@xstate/react';
import {
  ChevronLeft,
  ChevronRight,
  MultipleCrossCancelDefault,
  PlusDefault,
  ThreeDotsMenuVertical,
} from '@xyne/icons';
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isSameWeek,
  isToday,
  isTomorrow,
  isWithinInterval,
  isYesterday,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { CallStatus, MeetingStatus } from '@xyne/shared';
import {
  xyneCalendarActor,
  globalXyneCalendarPanelRef,
  type CalendarViewMode,
} from '../../../machines/xyneCalendarMachine';
import {
  getXyneCalendarChannelPresentation,
  XYNE_CALENDAR_SIDEBAR_MAX_SIZE,
} from './xyneCalendarSidebar.utils';
import { cn } from '../../../utils/classNames';
import { Button } from '../../ui/Button/Button';
import { DatePicker } from '../../ui/DatePicker/DatePicker';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import { useAuth } from '../../../hooks/useAuth';
import { useAllChannels, useAllVisibleChannels } from '../../../hooks/useChannels';
import { useUsersById } from '../../../hooks/useUsers';
import { useCallHistory } from '../../../routes/CallHistoryScreen/useCallHistory';
import {
  type Call,
  isScheduledCallJoinable,
} from '../../../routes/CallHistoryScreen/callHistoryItem.utils';
import {
  computeEventPositions,
  createSlotClickHandler,
  getCalendarCreateSlot,
  getCallsOverlappingDay,
  getCurrentUserMeetingStatus,
  isSameDay,
  minutesFromTopPx,
} from '../../../routes/CallHistoryScreen/CalenderViewUtils';
import { useDragCreate } from '../../../routes/CallHistoryScreen/useDragCreate';
import { XyneCalendarCallPill, type XyneCalendarCallPillVariant } from './XyneCalendarCallPill';
import CallDetailSidebarView from './CallDetailSidebarView';
import CalendarWeekView from '../../../routes/CallHistoryScreen/CalendarWeekView';
import CalendarMonthView from '../../../routes/CallHistoryScreen/CalenderMonthView';
import { ScheduleCallModal } from '../../Call/ScheduleCallModal/ScheduleCallModal';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import { formatWeekRangeLabel } from '../../../utils/dateUtils';
import { DeleteCallModal } from '../../Call/DeleteCallModal';
import { roomActor } from '../../../machines/roomMachine';

const TIMELINE_HOUR_HEIGHT = 72;
const TIMELINE_HOURS = Array.from({ length: 25 }, (_, hour) => hour);
const TIMELINE_DAY_MINUTES = 24 * 60;
const MINIMUM_CALL_PILL_HEIGHT = 20;
const CALL_PILL_VERTICAL_INSET = 2;
const ALWAYS_VISIBLE_JOIN_MIN_WIDTH_PERCENTAGE = 75;
const COMPACT_METADATA_MIN_WIDTH_PERCENTAGE = 75;
const CREATE_SLOT_DURATION_MINUTES = 30;
const CREATE_SLOT_SNAP_MINUTES = 15;

// Bare 'yyyy-MM-dd' is parsed as UTC per spec; appending a local time-of-day
// avoids a day shift in negative-UTC-offset timezones.
const dateToIso = (date: Date): string => format(date, 'yyyy-MM-dd');
const isoToDate = (iso: string): Date => new Date(`${iso}T00:00:00`);

const XyneCalendarSidebarComponent = (): ReactElement => {
  const selectedDateIso = useSelector(xyneCalendarActor, state => state.context.selectedDate);
  const selectedCallId = useSelector(xyneCalendarActor, state => state.context.selectedCallId);
  const selectedCallFallback = useSelector(
    xyneCalendarActor,
    state => state.context.selectedCallFallback,
  );
  const viewMode = useSelector(xyneCalendarActor, state => state.context.viewMode);
  const selectedDate = useMemo(() => isoToDate(selectedDateIso), [selectedDateIso]);

  const handleViewModeChange = useCallback((mode: CalendarViewMode): void => {
    xyneCalendarActor.send({ type: 'SET_VIEW_MODE', mode });
  }, []);

  const preMaxWidthRef = useRef<number | null>(null);
  const isMaxedRef = useRef(false);

  useEffect(() => {
    const rafId = window.requestAnimationFrame(() => {
      const panel = globalXyneCalendarPanelRef.current;
      if (!panel) return;

      if (viewMode === 'week' || viewMode === 'month') {
        if (!isMaxedRef.current) {
          preMaxWidthRef.current = panel.getSize().asPercentage;
          isMaxedRef.current = true;
        }
        panel.resize(`${XYNE_CALENDAR_SIDEBAR_MAX_SIZE}%`);
      } else if (isMaxedRef.current) {
        isMaxedRef.current = false;
        if (preMaxWidthRef.current !== null) panel.resize(`${preMaxWidthRef.current}%`);
      }
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [viewMode]);

  useEffect(() => {
    return () => {
      if (isMaxedRef.current && preMaxWidthRef.current !== null) {
        globalXyneCalendarPanelRef.current?.resize(`${preMaxWidthRef.current}%`);
      }
    };
  }, []);

  const handleDateChange = useCallback((date: Date): void => {
    xyneCalendarActor.send({ type: 'SELECT_DATE', date: dateToIso(date) });
  }, []);

  // Steps by whatever unit the active view shows a page of.
  const handlePreviousDay = useCallback((): void => {
    const previous =
      viewMode === 'week'
        ? addDays(selectedDate, -7)
        : viewMode === 'month'
          ? addMonths(selectedDate, -1)
          : addDays(selectedDate, -1);
    xyneCalendarActor.send({ type: 'SELECT_DATE', date: dateToIso(previous) });
  }, [selectedDate, viewMode]);

  const handleNextDay = useCallback((): void => {
    const next =
      viewMode === 'week'
        ? addDays(selectedDate, 7)
        : viewMode === 'month'
          ? addMonths(selectedDate, 1)
          : addDays(selectedDate, 1);
    xyneCalendarActor.send({ type: 'SELECT_DATE', date: dateToIso(next) });
  }, [selectedDate, viewMode]);

  const handleToday = useCallback((): void => {
    xyneCalendarActor.send({ type: 'SELECT_DATE', date: dateToIso(startOfDay(new Date())) });
  }, []);

  const handleSelectCall = useCallback((callId: string): void => {
    xyneCalendarActor.send({ type: 'SELECT_CALL', callId });
  }, []);

  const handleClearSelectedCall = useCallback((): void => {
    xyneCalendarActor.send({ type: 'SELECT_CALL', callId: null });
  }, []);

  return (
    <aside aria-label='Calendar' className='flex h-full w-full flex-col bg-transparent'>
      <XyneCalendarSidebarTimeline
        selectedDate={selectedDate}
        selectedCallId={selectedCallId}
        selectedCallFallback={selectedCallFallback}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
        onSelectCall={handleSelectCall}
        onClearSelectedCall={handleClearSelectedCall}
        onDateChange={handleDateChange}
        onPreviousDay={handlePreviousDay}
        onNextDay={handleNextDay}
        onToday={handleToday}
      />
    </aside>
  );
};

export const XyneCalendarSidebar = memo(XyneCalendarSidebarComponent);

XyneCalendarSidebar.displayName = 'XyneCalendarSidebar';

interface XyneCalendarSidebarHeaderProps {
  selectedDate: Date;
  viewMode: CalendarViewMode;
  onViewModeChange: (mode: CalendarViewMode) => void;
  onDateChange: (date: Date) => void;
  onPreviousDay: () => void;
  onNextDay: () => void;
  onToday: () => void;
  markedDates: Date[];
  callCount: number;
  liveCount: number;
  scheduledCount: number;
  endedCount: number;
}

const VIEW_MODE_OPTIONS: ReadonlyArray<{ mode: CalendarViewMode; label: string }> = [
  { mode: 'day', label: 'Day View' },
  { mode: 'week', label: 'Week View' },
  { mode: 'month', label: 'Month View' },
];

const XyneCalendarSidebarHeader = memo(
  ({
    selectedDate,
    viewMode,
    onViewModeChange,
    onDateChange,
    onPreviousDay,
    onNextDay,
    onToday,
    markedDates,
    callCount,
    liveCount,
    scheduledCount,
    endedCount,
  }: XyneCalendarSidebarHeaderProps): ReactElement => {
    const handleDateSelect = (date: Date | null): void => {
      if (!date) return;
      onDateChange(startOfDay(date));
    };

    const dateDisplayLabel =
      viewMode === 'week'
        ? formatWeekRangeLabel(selectedDate)
        : viewMode === 'month'
          ? format(selectedDate, 'MMMM yyyy')
          : undefined;

    const todayButtonLabel =
      viewMode === 'week' ? 'This Week' : viewMode === 'month' ? 'This Month' : 'Today';
    const isViewingCurrentPeriod =
      viewMode === 'week'
        ? isSameWeek(selectedDate, new Date(), { weekStartsOn: 0 })
        : viewMode === 'month'
          ? isSameMonth(selectedDate, new Date())
          : isToday(selectedDate);

    const today = new Date();
    const nearPeriodPhrase =
      viewMode === 'week'
        ? isSameWeek(selectedDate, today, { weekStartsOn: 0 })
          ? 'this week'
          : isSameWeek(selectedDate, addDays(today, -7), { weekStartsOn: 0 })
            ? 'last week'
            : isSameWeek(selectedDate, addDays(today, 7), { weekStartsOn: 0 })
              ? 'next week'
              : null
        : viewMode === 'month'
          ? isSameMonth(selectedDate, today)
            ? 'this month'
            : isSameMonth(selectedDate, addMonths(today, -1))
              ? 'last month'
              : isSameMonth(selectedDate, addMonths(today, 1))
                ? 'next month'
                : null
          : isToday(selectedDate)
            ? 'today'
            : isYesterday(selectedDate)
              ? 'yesterday'
              : isTomorrow(selectedDate)
                ? 'tomorrow'
                : null;

    const callWord = callCount === 1 ? 'call' : 'calls';
    const callCountLabel =
      callCount === 0
        ? 'No calls scheduled'
        : nearPeriodPhrase
          ? `${callCount} ${callWord} ${nearPeriodPhrase}`
          : liveCount > 0
            ? `${callCount} ${callWord} · ${liveCount} live now`
            : scheduledCount === callCount
              ? `${callCount} ${callWord} scheduled`
              : endedCount === callCount
                ? `${callCount} ${callWord} ended`
                : `${callCount} ${callWord}`;

    return (
      <header className='shrink-0'>
        <div className='flex items-center gap-1 py-3 pl-2 pr-3'>
          <div className='flex-1 min-w-0 px-1.5'>
            <span className='whitespace-nowrap text-foreground font-semibold font-sans tracking-[-0.32px] leading-7 text-base'>
              Calendar
            </span>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant='ghost'
                size='sm'
                title='Calendar view'
                aria-label='Calendar view options'
                data-track-category='Calendar'
                data-track-name='CALENDAR_VIEW_MENU'
                className='h-7 w-7 rounded-lg shrink-0 text-muted-foreground hover:text-foreground'
              >
                <ThreeDotsMenuVertical size={16} aria-hidden='true' />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' className='rounded-xl'>
              {VIEW_MODE_OPTIONS.map(option => (
                <DropdownMenuItem
                  key={option.mode}
                  onSelect={() => onViewModeChange(option.mode)}
                  className={cn(
                    viewMode === option.mode && 'bg-accent text-accent-foreground',
                    'rounded-lg',
                  )}
                  data-track-category='Calendar'
                  data-track-name={`VIEW_${option.mode.toUpperCase()}`}
                >
                  {option.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant='ghost'
            size='sm'
            title='Close'
            aria-label='Close Calendar sidebar'
            onClick={() => xyneCalendarActor.send({ type: 'CLOSE' })}
            data-track-category='Calendar'
            data-track-name='CLOSE_CALENDAR_SIDEBAR'
            className='h-7 w-7 rounded-lg shrink-0 text-muted-foreground hover:text-foreground'
          >
            <MultipleCrossCancelDefault size={16} aria-hidden='true' />
          </Button>
        </div>

        <div className='relative z-10 flex h-14 items-center gap-1.5 border-b border-border px-3 shadow-sm '>
          <Button
            variant='outline'
            size='iconSm'
            title={`Previous ${viewMode}`}
            aria-label={`Previous ${viewMode}`}
            onClick={onPreviousDay}
            data-track-category='Calendar'
            data-track-name='PREVIOUS_DAY'
            className='size-7 rounded-lg'
          >
            <ChevronLeft className='size-4' strokeWidth={2} aria-hidden='true' />
          </Button>
          <Button
            variant='outline'
            size='iconSm'
            title={`Next ${viewMode}`}
            aria-label={`Next ${viewMode}`}
            onClick={onNextDay}
            data-track-category='Calendar'
            data-track-name='NEXT_DAY'
            className='size-7 rounded-lg'
          >
            <ChevronRight className='size-4' strokeWidth={2} aria-hidden='true' />
          </Button>

          <DatePicker
            selectedDate={selectedDate}
            onSelect={handleDateSelect}
            showClearButton={false}
            inputClassName='min-w-0 flex-1 border-0 bg-transparent px-2 shadow-none rounded-lg'
            contentClassName='z-50'
            markedDates={markedDates}
            {...(dateDisplayLabel ? { displayLabel: dateDisplayLabel } : {})}
          />

          <span className='shrink-0 whitespace-nowrap text-xs text-muted-foreground'>
            {callCountLabel}
          </span>

          <Button
            variant='outline'
            size='sm'
            onClick={onToday}
            disabled={isViewingCurrentPeriod}
            data-track-category='Calendar'
            data-track-name='TODAY'
            className='rounded-full'
          >
            {todayButtonLabel}
          </Button>
        </div>
      </header>
    );
  },
);

XyneCalendarSidebarHeader.displayName = 'XyneCalendarSidebarHeader';

interface XyneCalendarSidebarTimelineProps {
  selectedDate: Date;
  selectedCallId: string | null;
  selectedCallFallback: Call | null;
  viewMode: CalendarViewMode;
  onViewModeChange: (mode: CalendarViewMode) => void;
  onSelectCall: (callId: string) => void;
  onClearSelectedCall: () => void;
  onDateChange: (date: Date) => void;
  onPreviousDay: () => void;
  onNextDay: () => void;
  onToday: () => void;
}

const formatTimelineHour = (hour: number): string => {
  if (hour === 0 || hour === 24) return '12 AM';
  if (hour === 12) return '12 PM';
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
};

const getTimelineOffset = (minutes: number): number => (minutes * TIMELINE_HOUR_HEIGHT) / 60;

const getMinutesSinceMidnight = (date: Date): number =>
  date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;

const shouldShowCurrentTimeLabel = (date: Date): boolean => {
  const minutesPastHour = getMinutesSinceMidnight(date) % 60;
  const minutesFromNearestHour = Math.min(minutesPastHour, 60 - minutesPastHour);
  return minutesFromNearestHour > 1;
};

interface TimelineInterval {
  startMins: number;
  endMins: number;
}

const getBestTimelineWindowStart = (
  intervals: TimelineInterval[],
  visibleMinutes: number,
  currentMinutes?: number,
): number => {
  const maximumStart = Math.max(0, TIMELINE_DAY_MINUTES - visibleMinutes);
  const clampStart = (start: number): number => Math.min(maximumStart, Math.max(0, start));
  const preferredCenter = currentMinutes ?? intervals[0]?.startMins ?? 8 * 60;
  const candidates = new Set<number>([clampStart(preferredCenter - visibleMinutes / 2)]);

  for (const interval of intervals) {
    candidates.add(clampStart(interval.startMins));
    candidates.add(clampStart(interval.endMins - visibleMinutes));
    candidates.add(clampStart((interval.startMins + interval.endMins - visibleMinutes) / 2));
  }

  let bestStart = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const windowStart of candidates) {
    const windowEnd = windowStart + visibleMinutes;
    let visibleCallCount = 0;
    let visibleCallMinutes = 0;

    for (const interval of intervals) {
      const overlap = Math.max(
        0,
        Math.min(interval.endMins, windowEnd) - Math.max(interval.startMins, windowStart),
      );
      if (overlap > 0) visibleCallCount += 1;
      visibleCallMinutes += overlap;
    }

    const containsCurrentTime =
      currentMinutes !== undefined && currentMinutes >= windowStart && currentMinutes <= windowEnd;
    const score =
      visibleCallCount * TIMELINE_DAY_MINUTES +
      visibleCallMinutes +
      (containsCurrentTime ? TIMELINE_DAY_MINUTES / 2 : 0);
    const distance = Math.abs(windowStart + visibleMinutes / 2 - preferredCenter);

    if (score > bestScore || (score === bestScore && distance < bestDistance)) {
      bestStart = windowStart;
      bestScore = score;
      bestDistance = distance;
    }
  }

  return bestStart;
};

const getCallPillVariant = (
  call: Call,
  currentUserId: string | undefined,
  currentTime: Date,
): XyneCalendarCallPillVariant => {
  if (currentUserId && call.createdByUserId === currentUserId) {
    return 'highlighted';
  }

  if (hasCallEnded(call, currentTime)) return 'past';

  const meetingStatus = getCurrentUserMeetingStatus(call, currentUserId);

  if (meetingStatus === MeetingStatus.DECLINED || meetingStatus === MeetingStatus.HIDDEN) {
    return 'declined';
  }

  return isScheduledCallJoinable(call, currentTime.getTime()) ? 'joinable' : 'scheduled';
};

const hasCallEnded = (call: Call, currentTime: Date): boolean =>
  call.status === CallStatus.ENDED ||
  (call.endsAt !== null &&
    call.endsAt !== undefined &&
    new Date(call.endsAt).getTime() < currentTime.getTime());

const XyneCalendarSidebarTimeline = memo(
  ({
    selectedDate,
    selectedCallId,
    selectedCallFallback,
    viewMode,
    onViewModeChange,
    onSelectCall,
    onClearSelectedCall,
    onDateChange,
    onPreviousDay,
    onNextDay,
    onToday,
  }: XyneCalendarSidebarTimelineProps): ReactElement => {
    const { user } = useAuth();
    const {
      calls,
      calendarScheduledCalls,
      isLoading,
      isScheduledCallsLoading,
      handleCallRowClick,
      getGotoTranscriptHandler,
      handleGotoTranscript,
      handleDownloadTranscript,
      handleEditClick,
      editModalOpen,
      editModalCall,
      closeEditModal,
      handleDeleteClick,
      deleteModalOpen,
      deleteModalCall,
      handleDeleteConfirm,
      closeDeleteModal,
    } = useCallHistory(user?.id);
    const channels = useAllChannels();
    const visibleChannels = useAllVisibleChannels();
    const usersById = useUsersById();
    const currentRoomExternalId = useSelector(roomActor, state => state.context.externalId);
    const isRoomSessionActive = useSelector(
      roomActor,
      state =>
        state.matches('joining') || state.matches('connecting') || state.matches('connected'),
    );
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const timelineSurfaceRef = useRef<HTMLDivElement>(null);
    const focusedDateRef = useRef<number | null>(null);
    const selectedCallSnapshotRef = useRef<Call | null>(null);
    const [now, setNow] = useState(() => new Date());
    const [hoverCreateSlot, setHoverCreateSlot] = useState<{
      startMins: number;
      endMins: number;
    } | null>(null);
    const [scheduleInitialTime, setScheduleInitialTime] = useState<{
      startsAt: Date;
      endsAt: Date;
    } | null>(null);

    const isCallDetailOpen = selectedCallId !== null;
    const defaultCallTitle = useMemo(() => {
      const displayName = getUserDisplayName(user);
      return displayName !== 'Unknown' ? `${displayName.split(' ')[0]}'s Call` : '';
    }, [user]);

    const upcomingCallDates = useMemo(() => {
      const dates = new Set<number>();
      const nowTime = now.getTime();

      for (const call of calendarScheduledCalls ?? []) {
        if (!call.startsAt) continue;
        const startsAt = new Date(call.startsAt).getTime();
        if (startsAt > nowTime) dates.add(startOfDay(new Date(startsAt)).getTime());
      }

      return Array.from(dates, date => new Date(date));
    }, [calendarScheduledCalls, now]);

    const handleCreateCallAtSlot = useCallback((startsAt: Date, endsAt: Date): void => {
      setHoverCreateSlot(null);
      setScheduleInitialTime({ startsAt, endsAt });
    }, []);

    // Month view only gives a day, not a slot — default to an 11am-noon block on it.
    const handleCreateCallOnDay = useCallback(
      (date: Date): void => {
        const start = new Date(date);
        start.setHours(11, 0, 0, 0);
        handleCreateCallAtSlot(start, new Date(start.getTime() + 60 * 60 * 1000));
      },
      [handleCreateCallAtSlot],
    );

    // Week/month aren't day-scoped, so they need the full pool `dailyCalls` filters down from.
    const allCalls = useMemo(() => {
      const callsById = new Map<string, Call>();
      for (const call of [...(calls ?? []), ...(calendarScheduledCalls ?? [])]) {
        callsById.set(call.id, call);
      }
      return Array.from(callsById.values());
    }, [calls, calendarScheduledCalls]);

    const { dragCreatePreview, onDragCreatePointerDown, consumeDragEnd } = useDragCreate(
      scrollContainerRef,
      handleCreateCallAtSlot,
      {
        coordinateRef: timelineSurfaceRef,
        hourHeight: TIMELINE_HOUR_HEIGHT,
        minimumDurationMins: CREATE_SLOT_DURATION_MINUTES,
        snapIntervalMins: CREATE_SLOT_SNAP_MINUTES,
      },
    );

    const handleTimelinePointerMove = useCallback(
      (event: React.PointerEvent<HTMLDivElement>): void => {
        if (scheduleInitialTime || (event.target as HTMLElement).closest('button')) {
          setHoverCreateSlot(null);
          return;
        }

        const rawMins = minutesFromTopPx(
          event.clientY - event.currentTarget.getBoundingClientRect().top,
          TIMELINE_HOUR_HEIGHT,
        );
        const { startMins, endMins } = getCalendarCreateSlot(selectedDate, rawMins, {
          clampToDay: true,
          durationMins: CREATE_SLOT_DURATION_MINUTES,
          snapMode: 'nearest',
          snapIntervalMins: CREATE_SLOT_SNAP_MINUTES,
        });

        setHoverCreateSlot(currentSlot =>
          currentSlot?.startMins === startMins ? currentSlot : { startMins, endMins },
        );
      },
      [scheduleInitialTime, selectedDate],
    );

    const handleTimelineClick = createSlotClickHandler(
      selectedDate,
      scheduleInitialTime !== null,
      consumeDragEnd,
      handleCreateCallAtSlot,
      {
        clampToDay: true,
        durationMins: CREATE_SLOT_DURATION_MINUTES,
        hourHeight: TIMELINE_HOUR_HEIGHT,
        snapMode: 'nearest',
        snapIntervalMins: CREATE_SLOT_SNAP_MINUTES,
      },
    );

    const handleTimelineKeyDown = useCallback(
      (event: React.KeyboardEvent<HTMLDivElement>): void => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();

        const rawStartMins =
          hoverCreateSlot?.startMins ??
          (isToday(selectedDate) ? getMinutesSinceMidnight(now) : 8 * 60);
        const { startsAt, endsAt } = getCalendarCreateSlot(selectedDate, rawStartMins, {
          clampToDay: true,
          durationMins: CREATE_SLOT_DURATION_MINUTES,
          snapMode: 'nearest',
          snapIntervalMins: CREATE_SLOT_SNAP_MINUTES,
        });
        handleCreateCallAtSlot(startsAt, endsAt);
      },
      [handleCreateCallAtSlot, hoverCreateSlot?.startMins, now, selectedDate],
    );

    useEffect(() => setHoverCreateSlot(null), [selectedDate]);

    useEffect(() => {
      const intervalId = window.setInterval(() => setNow(new Date()), 12_000);
      return (): void => window.clearInterval(intervalId);
    }, []);

    const dailyCalls = useMemo(() => {
      const callsById = new Map<string, Call>();

      for (const call of getCallsOverlappingDay(
        [...(calls ?? []), ...(calendarScheduledCalls ?? [])],
        selectedDate,
      )) {
        callsById.set(call.id, call);
      }

      return Array.from(callsById.values()).sort(
        (firstCall, secondCall) =>
          new Date(firstCall.startsAt ?? 0).getTime() -
          new Date(secondCall.startsAt ?? 0).getTime(),
      );
    }, [calendarScheduledCalls, calls, selectedDate]);

    // Header count badge — Day reuses dailyCalls; Week/Month filter the full pool
    // (dailyCalls excludes them, being scoped + startsAt-required for the timeline grid).
    const viewPeriodCalls = useMemo(() => {
      if (viewMode === 'day') return dailyCalls;
      const [rangeStart, rangeEnd] =
        viewMode === 'week'
          ? [
              startOfWeek(selectedDate, { weekStartsOn: 0 }),
              endOfWeek(selectedDate, { weekStartsOn: 0 }),
            ]
          : [startOfMonth(selectedDate), endOfMonth(selectedDate)];
      return allCalls.filter(
        call =>
          call.startsAt &&
          isWithinInterval(new Date(call.startsAt), { start: rangeStart, end: rangeEnd }),
      );
    }, [viewMode, dailyCalls, allCalls, selectedDate]);

    const { liveCount, scheduledCount, endedCount } = useMemo(
      () => ({
        liveCount: viewPeriodCalls.filter(call => call.status === CallStatus.ACTIVE).length,
        scheduledCount: viewPeriodCalls.filter(call => call.status === CallStatus.SCHEDULED).length,
        endedCount: viewPeriodCalls.filter(call => call.status === CallStatus.ENDED).length,
      }),
      [viewPeriodCalls],
    );

    const callPositions = useMemo(
      () => computeEventPositions(dailyCalls, selectedDate),
      [dailyCalls, selectedDate],
    );
    const channelPresentationsById = useMemo(
      () =>
        new Map(
          channels.map(channel => [
            channel.id,
            getXyneCalendarChannelPresentation(channel, user?.id ?? '', usersById),
          ]),
        ),
      [channels, user?.id, usersById],
    );
    const accessibleChannelIds = useMemo(
      () => new Set(visibleChannels.map(channel => channel.id)),
      [visibleChannels],
    );

    // Scroll to the selected date when it changes, if user isn't focused on it.
    useEffect(() => {
      if (isCallDetailOpen) {
        focusedDateRef.current = null;
        return;
      }

      const selectedDateKey = startOfDay(selectedDate).getTime();
      if (focusedDateRef.current === selectedDateKey || isLoading || isScheduledCallsLoading) {
        return;
      }

      const frameId = window.requestAnimationFrame(() => {
        const scrollContainer = scrollContainerRef.current;
        if (!scrollContainer) return;

        const visibleMinutes = Math.min(
          TIMELINE_DAY_MINUTES,
          (scrollContainer.clientHeight / TIMELINE_HOUR_HEIGHT) * 60,
        );
        const currentMinutes = isToday(selectedDate)
          ? getMinutesSinceMidnight(new Date())
          : undefined;
        const windowStart = getBestTimelineWindowStart(
          Array.from(callPositions.values()),
          visibleMinutes,
          currentMinutes,
        );

        scrollContainer.scrollTop = getTimelineOffset(windowStart);
        focusedDateRef.current = selectedDateKey;
      });

      return (): void => window.cancelAnimationFrame(frameId);
    }, [callPositions, isCallDetailOpen, isLoading, isScheduledCallsLoading, selectedDate]);

    // Not `dailyCalls`: that list requires `startsAt` (getCallsOverlappingDay) and only
    // covers SCHEDULED/ended-history statuses — selectedCallFallback covers what neither finds.
    const queriedSelectedCall = useMemo(() => {
      if (!selectedCallId) return null;
      return (
        calls?.find(call => call.id === selectedCallId) ??
        calendarScheduledCalls?.find(call => call.id === selectedCallId) ??
        (selectedCallFallback?.id === selectedCallId ? selectedCallFallback : null)
      );
    }, [calls, calendarScheduledCalls, selectedCallId, selectedCallFallback]);

    useEffect(() => {
      if (queriedSelectedCall) selectedCallSnapshotRef.current = queriedSelectedCall;
    }, [queriedSelectedCall]);

    const selectedCallSnapshot = selectedCallSnapshotRef.current;
    const isMatchingRoomSession =
      isRoomSessionActive &&
      selectedCallSnapshot?.id === selectedCallId &&
      selectedCallSnapshot.externalId === currentRoomExternalId;
    const selectedCall =
      queriedSelectedCall ?? (isMatchingRoomSession ? selectedCallSnapshot : null);

    const visibleCreatePreview = dragCreatePreview ?? hoverCreateSlot;
    const visibleCreateDates = visibleCreatePreview
      ? getCalendarCreateSlot(selectedDate, visibleCreatePreview.startMins, {
          clampToDay: true,
          durationMins: visibleCreatePreview.endMins - visibleCreatePreview.startMins,
          snapMode: 'nearest',
          snapIntervalMins: CREATE_SLOT_SNAP_MINUTES,
        })
      : null;

    // A selected call can vanish (cancelled, hidden, rescheduled off this day) —
    // fall back once queries settle, except during its scheduled-to-active transition.
    useEffect(() => {
      if (selectedCallId === null || selectedCall !== null) return;
      if (isLoading || isScheduledCallsLoading) return;
      onClearSelectedCall();
    }, [isLoading, isScheduledCallsLoading, onClearSelectedCall, selectedCall, selectedCallId]);

    const sharedHeader = (
      <XyneCalendarSidebarHeader
        selectedDate={selectedDate}
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
        onDateChange={onDateChange}
        onPreviousDay={onPreviousDay}
        onNextDay={onNextDay}
        onToday={onToday}
        markedDates={upcomingCallDates}
        callCount={viewPeriodCalls.length}
        liveCount={liveCount}
        scheduledCount={scheduledCount}
        endedCount={endedCount}
      />
    );

    let mainContent: ReactElement;

    if (selectedCall) {
      const threadChannelId = selectedCall.callUpdatesChannel ?? selectedCall.channelId;
      const selectedChannel = selectedCall.channelId
        ? channelPresentationsById.get(selectedCall.channelId)
        : undefined;
      const hasThreadAccess = !!threadChannelId && accessibleChannelIds.has(threadChannelId);

      mainContent = (
        <CallDetailSidebarView
          call={selectedCall}
          currentUserId={user?.id}
          dayLabel={isToday(selectedDate) ? 'Today' : format(selectedDate, 'EEE, MMM d')}
          channel={selectedChannel}
          onBack={onClearSelectedCall}
          onClose={() => xyneCalendarActor.send({ type: 'CLOSE' })}
          onJoinCall={() => handleCallRowClick(selectedCall)}
          onOpenCallThread={hasThreadAccess ? getGotoTranscriptHandler(selectedCall) : undefined}
          onDownloadTranscript={() => handleDownloadTranscript(selectedCall)}
          onEditCall={() => handleEditClick(selectedCall)}
          onDeleteCall={() => handleDeleteClick(selectedCall)}
        />
      );
    } else if (viewMode === 'week') {
      mainContent = (
        <>
          {sharedHeader}
          <div className='min-h-0 flex-1 overflow-hidden'>
            <CalendarWeekView
              calls={allCalls}
              currentWeekStart={selectedDate}
              currentUserId={user?.id}
              onCallClick={handleCallRowClick}
              onGotoMessage={handleGotoTranscript}
              onDownloadTranscript={handleDownloadTranscript}
              onEditClick={handleEditClick}
              onDeleteClick={handleDeleteClick}
              onCreateCallAtSlot={handleCreateCallAtSlot}
            />
          </div>
        </>
      );
    } else if (viewMode === 'month') {
      mainContent = (
        <>
          {sharedHeader}
          <div className='min-h-0 flex-1 overflow-hidden'>
            <CalendarMonthView
              calls={allCalls}
              currentMonth={selectedDate}
              currentUserId={user?.id}
              onCallClick={handleCallRowClick}
              onGotoMessage={handleGotoTranscript}
              onDownloadTranscript={handleDownloadTranscript}
              onEditClick={handleEditClick}
              onDeleteClick={handleDeleteClick}
              onCreateCall={handleCreateCallOnDay}
            />
          </div>
        </>
      );
    } else {
      mainContent = (
        <>
          {sharedHeader}
          <div ref={scrollContainerRef} className='min-h-0 flex-1 overflow-y-auto px-3 pb-7 pt-1'>
            <div
              className='relative min-w-0'
              style={{ height: TIMELINE_HOUR_HEIGHT * 24 }}
              aria-label='Calendar day timeline'
            >
              {TIMELINE_HOURS.map(hour => (
                <div
                  key={hour}
                  className='absolute left-0 right-0 flex -translate-y-1/2 items-center gap-4'
                  style={{ top: hour * TIMELINE_HOUR_HEIGHT }}
                >
                  <span className='w-10 shrink-0 text-right text-xs font-mono leading-none text-muted-foreground/80'>
                    {formatTimelineHour(hour)}
                  </span>
                  <span className='h-px flex-1 bg-muted-foreground/15 rounded' aria-hidden='true' />
                </div>
              ))}

              <div
                ref={timelineSurfaceRef}
                role='gridcell'
                tabIndex={0}
                className='absolute bottom-0 left-16 right-0 top-0 cursor-crosshair'
                onClick={handleTimelineClick}
                onKeyDown={handleTimelineKeyDown}
                onPointerDown={event => onDragCreatePointerDown(event, selectedDate)}
                onPointerMove={handleTimelinePointerMove}
                onPointerLeave={() => setHoverCreateSlot(null)}
                data-track-category='Calendar'
                data-track-name='CREATE_SCHEDULE_FROM_SIDEBAR'
              >
                {isToday(selectedDate) && (
                  <div
                    className='pointer-events-none absolute left-0 right-0 z-0 flex -translate-y-1/2 items-center'
                    style={{
                      top: getTimelineOffset(getMinutesSinceMidnight(now)),
                    }}
                    aria-label={`Current time ${format(now, 'h:mm a')}`}
                  >
                    {shouldShowCurrentTimeLabel(now) && (
                      <span className='absolute right-full mr-3 inline-flex whitespace-nowrap rounded-md bg-primary px-1 py-0.5 font-mono text-xs font-semibold leading-none text-primary-foreground shadow-sm'>
                        {format(now, 'h:mm a')}
                      </span>
                    )}
                    <span className='z-10 -ml-1 size-2 shrink-0 rounded-full bg-primary ring-2 ring-background' />
                    <span className='h-0.5 flex-1 rounded bg-primary ring-1 ring-background' />
                  </div>
                )}

                {visibleCreatePreview && visibleCreateDates && (
                  <div
                    className={
                      dragCreatePreview
                        ? 'pointer-events-none absolute left-1 right-1  overflow-hidden rounded-lg border border-primary/70 bg-primary px-3 py-1 text-primary-foreground shadow-[0_8px_24px_-8px_hsl(var(--destructive)/0.65)]'
                        : 'pointer-events-none absolute left-1 right-1 flex items-center rounded-lg border border-primary/60 bg-background px-3 text-primary shadow-sm'
                    }
                    style={{
                      top:
                        getTimelineOffset(visibleCreatePreview.startMins) +
                        CALL_PILL_VERTICAL_INSET,
                      height: Math.max(
                        MINIMUM_CALL_PILL_HEIGHT,
                        getTimelineOffset(
                          visibleCreatePreview.endMins - visibleCreatePreview.startMins,
                        ) -
                          CALL_PILL_VERTICAL_INSET * 2,
                      ),
                    }}
                    aria-hidden='true'
                  >
                    {dragCreatePreview ? (
                      <div className='flex h-full min-w-0 flex-col justify-start overflow-hidden'>
                        <span className='truncate text-sm font-semibold leading-4'>
                          {defaultCallTitle}
                        </span>
                        <span className='truncate text-xs leading-4'>
                          {format(visibleCreateDates.startsAt, 'h:mm a')} –{' '}
                          {format(visibleCreateDates.endsAt, 'h:mm a')}
                        </span>
                      </div>
                    ) : (
                      <span className='truncate text-xs font-semibold flex gap-1.5 items-center'>
                        <PlusDefault
                          className='size-3 shrink-0'
                          strokeWidth={3}
                          aria-hidden='true'
                        />
                        New call · {format(visibleCreateDates.startsAt, 'h:mm a')} –{' '}
                        {format(visibleCreateDates.endsAt, 'h:mm a')}
                      </span>
                    )}
                  </div>
                )}

                {dailyCalls.map(call => {
                  const position = callPositions.get(call.id);
                  if (!position || !call.startsAt) return null;

                  const callHasEnded = hasCallEnded(call, now);
                  const variant = getCallPillVariant(call, user?.id, now);
                  const joinable =
                    !callHasEnded &&
                    (variant === 'joinable' ||
                      (variant === 'highlighted' && isScheduledCallJoinable(call, now.getTime())));
                  const continuesFromPreviousDay = !isSameDay(
                    new Date(call.startsAt),
                    selectedDate,
                  );
                  const continuesToNextDay =
                    !!call.endsAt && !isSameDay(new Date(call.endsAt), selectedDate);
                  const topInset = continuesFromPreviousDay ? 0 : CALL_PILL_VERTICAL_INSET;
                  const bottomInset = continuesToNextDay ? 0 : CALL_PILL_VERTICAL_INSET;
                  const top = getTimelineOffset(position.startMins) + topInset;
                  const height = Math.max(
                    MINIMUM_CALL_PILL_HEIGHT,
                    getTimelineOffset(position.endMins - position.startMins) -
                      topInset -
                      bottomInset,
                  );
                  const channel = call.channelId
                    ? channelPresentationsById.get(call.channelId)
                    : undefined;
                  return (
                    <div
                      key={call.id}
                      className='absolute z-10 pr-1'
                      style={{
                        top,
                        height,
                        left: `${position.leftPct}%`,
                        width: `${position.widthPct}%`,
                      }}
                    >
                      <XyneCalendarCallPill
                        title={call.title ?? 'Call'}
                        variant={variant}
                        startsAt={call.startsAt}
                        endsAt={call.endsAt}
                        {...(channel && { channel })}
                        onSelect={() => onSelectCall(call.id)}
                        onJoin={() => handleCallRowClick(call)}
                        joinable={joinable}
                        showJoinByDefault={
                          position.widthPct >= ALWAYS_VISIBLE_JOIN_MIN_WIDTH_PERCENTAGE
                        }
                        past={callHasEnded}
                        compact={height < 40}
                        showCompactMetadata={
                          position.widthPct >= COMPACT_METADATA_MIN_WIDTH_PERCENTAGE
                        }
                        continuesFromPreviousDay={continuesFromPreviousDay}
                        continuesToNextDay={continuesToNextDay}
                        className='h-full'
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      );
    }

    return (
      <>
        {mainContent}

        <ScheduleCallModal
          isOpen={editModalOpen}
          onClose={closeEditModal}
          mode='edit'
          initialCall={editModalCall}
          onSuccess={closeEditModal}
        />

        <DeleteCallModal
          isOpen={deleteModalOpen}
          onClose={closeDeleteModal}
          onConfirm={handleDeleteConfirm}
          callLabel={
            deleteModalCall
              ? `${deleteModalCall.title ?? 'Scheduled Call'}${
                  deleteModalCall.startsAt
                    ? ` | ${new Date(deleteModalCall.startsAt).toLocaleDateString('en-US', {
                        weekday: 'short',
                      })} ${new Date(deleteModalCall.startsAt).toLocaleTimeString('en-US', {
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: false,
                      })}`
                    : ''
                }`
              : ''
          }
          isRecurring={!!deleteModalCall?.recurringSeriesId}
        />

        <ScheduleCallModal
          isOpen={scheduleInitialTime !== null}
          onClose={() => setScheduleInitialTime(null)}
          initialStartsAt={scheduleInitialTime?.startsAt ?? null}
          initialEndsAt={scheduleInitialTime?.endsAt ?? null}
        />
      </>
    );
  },
);

XyneCalendarSidebarTimeline.displayName = 'XyneCalendarSidebarTimeline';
