import {
  memo,
  type ReactElement,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useSelector } from '@xstate/react';
import { DndContext, useDraggable, useDroppable } from '@dnd-kit/core';
import {
  ChevronLeft,
  ChevronRight,
  MultipleCrossCancelDefault,
  PlusDefault,
  Refresh,
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
  isWithinInterval,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import {
  xyneCalendarActor,
  globalXyneCalendarPanelRef,
  type CalendarViewMode,
} from '../../../machines/xyneCalendarMachine';
import {
  getNearPeriodPhrase,
  getPeriodCallCounts,
  getPeriodCallCountLabel,
  getXyneCalendarChannelPresentation,
  useXyneCalendarChannelPresentations,
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
import { useAllVisibleChannels } from '../../../hooks/useChannels';
import { useCallHistory } from '../../../routes/CallHistoryScreen/useCallHistory';
import { type Call } from '../../../routes/CallHistoryScreen/callHistoryItem.utils';
import {
  ALWAYS_VISIBLE_JOIN_MIN_WIDTH_PERCENTAGE,
  COMPACT_METADATA_MIN_WIDTH_PERCENTAGE,
  computeEventPositions,
  createSlotClickHandler,
  dayKey,
  formatHourLabel,
  getCalendarCreateSlot,
  getCallPillVariant,
  getCallsOverlappingDay,
  hasCallEnded,
  isCallDraggable,
  isCallJoinableNow,
  isSameDay,
  mergeCallsById,
  minutesSinceMidnight,
  minutesFromTopPx,
  topPxForMinutes,
} from '../../../routes/CallHistoryScreen/CalenderViewUtils';
import { DAY_MINUTES, useDragCreate } from '../../../routes/CallHistoryScreen/useDragCreate';
import { useDragReschedule } from '../../../routes/CallHistoryScreen/useDragReschedule';
import { useResizeEndTime } from '../../../routes/CallHistoryScreen/useResizeEndTime';
import RecurringRescheduleDialog from '../../../routes/CallHistoryScreen/RecurringRescheduleDialog';
import { CalendarEventGhost } from '../../../routes/CallHistoryScreen/CalendarEventGhost';
import { XyneCalendarCallPill, type XyneCalendarCallPillVariant } from './XyneCalendarCallPill';
import CallDetailSidebarView from './CallDetailSidebarView';
import CalendarWeekView from '../../../routes/CallHistoryScreen/CalendarWeekView';
import CalendarMonthView from '../../../routes/CallHistoryScreen/CalenderMonthView';
import { GoogleCalendarIcon, MicrosoftIcon } from '../../../routes/CallHistoryScreen/CalendarIcons';
import { ScheduleCallModal } from '../../Call/ScheduleCallModal/ScheduleCallModal';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import { dateToIso, isoToDate, formatWeekRangeLabel } from '../../../utils/dateUtils';
import { DeleteCallModal } from '../../Call/DeleteCallModal';
import { roomActor } from '../../../machines/roomMachine';
import { useCalendarSync } from '../../../hooks/useCalendarSync';

const XyneCalendarSidebarComponent = (): ReactElement => {
  const { user } = useAuth();
  const { calendarProvider, isSyncing, syncMessage, reauthCountdown, syncCalendar } =
    useCalendarSync(user?.id);
  const selectedDateIso = useSelector(xyneCalendarActor, state => state.context.selectedDate);
  const selectedCallId = useSelector(xyneCalendarActor, state => state.context.selectedCallId);
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
  const stepPeriod = useCallback(
    (direction: 1 | -1): void => {
      const nextDate =
        viewMode === 'week'
          ? addDays(selectedDate, direction * 7)
          : viewMode === 'month'
            ? addMonths(selectedDate, direction)
            : addDays(selectedDate, direction);
      xyneCalendarActor.send({ type: 'SELECT_DATE', date: dateToIso(nextDate) });
    },
    [selectedDate, viewMode],
  );

  const handlePreviousDay = useCallback((): void => stepPeriod(-1), [stepPeriod]);
  const handleNextDay = useCallback((): void => stepPeriod(1), [stepPeriod]);

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
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
        onSelectCall={handleSelectCall}
        onClearSelectedCall={handleClearSelectedCall}
        onDateChange={handleDateChange}
        onPreviousDay={handlePreviousDay}
        onNextDay={handleNextDay}
        onToday={handleToday}
      />
      {calendarProvider && (
        <button
          onClick={syncCalendar}
          disabled={isSyncing}
          data-track-category='Calendar'
          data-track-name='CALENDAR_SYNC'
          title={`Sync ${calendarProvider === 'GOOGLE' ? 'Google' : 'Microsoft'} Calendar`}
          className={cn(
            'flex shrink-0 items-center gap-2 border-t border-border px-3 py-2.5 text-left text-sm transition-colors disabled:opacity-60',
            syncMessage?.reauth
              ? 'text-destructive hover:bg-destructive/10'
              : 'text-muted-foreground hover:bg-muted',
          )}
        >
          {isSyncing ? (
            <Refresh className='size-3.5 shrink-0 animate-spin' aria-hidden='true' />
          ) : calendarProvider === 'GOOGLE' ? (
            <GoogleCalendarIcon size={14} />
          ) : (
            <MicrosoftIcon size={14} />
          )}
          <span className='truncate'>
            {reauthCountdown
              ? `Need calendar access, redirecting for authorization in ${reauthCountdown.count}s…`
              : syncMessage
                ? syncMessage.text
                : isSyncing
                  ? 'Syncing…'
                  : `Sync ${calendarProvider === 'GOOGLE' ? 'Google' : 'Microsoft'} Calendar`}
          </span>
        </button>
      )}
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
  isLoading: boolean;
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
    isLoading,
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

    const nearPeriodPhrase = getNearPeriodPhrase(viewMode, selectedDate, new Date());
    const callCountLabel = getPeriodCallCountLabel(
      { callCount, liveCount, scheduledCount, endedCount },
      nearPeriodPhrase,
      isLoading,
    );

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
  viewMode: CalendarViewMode;
  onViewModeChange: (mode: CalendarViewMode) => void;
  onSelectCall: (callId: string) => void;
  onClearSelectedCall: () => void;
  onDateChange: (date: Date) => void;
  onPreviousDay: () => void;
  onNextDay: () => void;
  onToday: () => void;
}

// ── Day view ─────────────────────────────────────────────────────────────────

const TIMELINE_HOUR_HEIGHT = 72;
const TIMELINE_HOURS = Array.from({ length: 25 }, (_, hour) => hour);
const MINIMUM_CALL_PILL_HEIGHT = 20;
const CALL_PILL_VERTICAL_INSET = 2;
const CREATE_SLOT_DURATION_MINUTES = 30;
const CREATE_SLOT_SNAP_MINUTES = 15;
const CREATE_SLOT_OPTIONS = {
  clampToDay: true,
  snapMode: 'nearest' as const,
  snapIntervalMins: CREATE_SLOT_SNAP_MINUTES,
};

const getTimelineOffset = (minutes: number): number =>
  topPxForMinutes(minutes, TIMELINE_HOUR_HEIGHT);

const shouldShowCurrentTimeLabel = (date: Date): boolean => {
  const minutesPastHour = minutesSinceMidnight(date) % 60;
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
  const maximumStart = Math.max(0, DAY_MINUTES - visibleMinutes);
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
      visibleCallCount * DAY_MINUTES +
      visibleCallMinutes +
      (containsCurrentTime ? DAY_MINUTES / 2 : 0);
    const distance = Math.abs(windowStart + visibleMinutes / 2 - preferredCenter);

    if (score > bestScore || (score === bestScore && distance < bestDistance)) {
      bestStart = windowStart;
      bestScore = score;
      bestDistance = distance;
    }
  }

  return bestStart;
};

interface XyneCalendarDraggableDayPillProps {
  call: Call;
  draggable: boolean;
  isBeingResized: boolean;
  top: number;
  height: number;
  leftPct: number;
  widthPct: number;
  variant: XyneCalendarCallPillVariant;
  channel?: ReturnType<typeof getXyneCalendarChannelPresentation>;
  onSelect: (callId: string) => void;
  onJoin: (callId: string) => void;
  joinable: boolean;
  /** True once the user's room session already holds this call's externalId. */
  joinDisabled: boolean;
  showJoinByDefault: boolean;
  past: boolean;
  compact: boolean;
  showCompactMetadata: boolean;
  continuesFromPreviousDay: boolean;
  continuesToNextDay: boolean;
  onResizePointerDown: (e: React.PointerEvent, call: Call) => void;
}

function XyneCalendarDraggableDayPill({
  call,
  draggable,
  isBeingResized,
  top,
  height,
  leftPct,
  widthPct,
  variant,
  channel,
  onSelect,
  onJoin,
  joinable,
  joinDisabled,
  showJoinByDefault,
  past,
  compact,
  showCompactMetadata,
  continuesFromPreviousDay,
  continuesToNextDay,
  onResizePointerDown,
}: XyneCalendarDraggableDayPillProps): ReactElement {
  const { listeners, setNodeRef, isDragging } = useDraggable({
    id: call.id,
    disabled: !draggable,
  });

  return (
    <div
      ref={setNodeRef}
      {...(draggable ? listeners : {})}
      data-calendar-pill='true'
      className='group absolute z-10 pr-1'
      style={{
        top,
        height,
        left: `${leftPct}%`,
        width: `${widthPct}%`,
        opacity: isDragging || isBeingResized ? 0.3 : 1,
        cursor: draggable ? 'grab' : undefined,
        userSelect: 'none',
        touchAction: 'none',
      }}
    >
      <XyneCalendarCallPill
        callId={call.id}
        title={call.title ?? 'Call'}
        variant={variant}
        startsAt={call.startsAt}
        endsAt={call.endsAt}
        {...(channel && { channel })}
        onSelect={onSelect}
        onJoin={onJoin}
        joinable={joinable}
        joinDisabled={joinDisabled}
        showJoinByDefault={showJoinByDefault}
        past={past}
        compact={compact}
        showCompactMetadata={showCompactMetadata}
        continuesFromPreviousDay={continuesFromPreviousDay}
        continuesToNextDay={continuesToNextDay}
        className='h-full'
      />
      {draggable && (
        <div
          role='none'
          className='absolute bottom-0 left-2 right-2 z-20 h-2.5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity'
          style={{ cursor: 'ns-resize', touchAction: 'none' }}
          onPointerDown={e => onResizePointerDown(e, call)}
          onClick={e => e.stopPropagation()}
          onKeyDown={e => e.stopPropagation()}
          data-track-category='Calendar'
          data-track-name='calendar-day-resize-handle'
        >
          <div className='w-6 h-0.5 rounded-full bg-primary-foreground' />
        </div>
      )}
    </div>
  );
}

interface XyneCalendarDayTimelineSurfaceProps {
  currentDay: Date;
  surfaceRef: RefObject<HTMLDivElement | null>;
  onClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerLeave: () => void;
  children: ReactNode;
}

function XyneCalendarDayTimelineSurface({
  currentDay,
  surfaceRef,
  onClick,
  onKeyDown,
  onPointerDown,
  onPointerMove,
  onPointerLeave,
  children,
}: XyneCalendarDayTimelineSurfaceProps): ReactElement {
  const { setNodeRef } = useDroppable({ id: dayKey(currentDay) });
  const setMergedRef = useCallback(
    (node: HTMLDivElement | null): void => {
      surfaceRef.current = node;
      setNodeRef(node);
    },
    [setNodeRef, surfaceRef],
  );

  return (
    <div
      ref={setMergedRef}
      role='gridcell'
      tabIndex={0}
      className='absolute bottom-0 left-16 right-0 top-0 cursor-crosshair'
      onClick={onClick}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      data-track-category='Calendar'
      data-track-name='CREATE_SCHEDULE_FROM_SIDEBAR'
    >
      {children}
    </div>
  );
}

interface XyneCalendarDayViewProps {
  calls: Call[];
  currentDay: Date;
  currentUserId: string | undefined;
  defaultCallTitle: string;
  isLoading: boolean;
  isScheduledCallsLoading: boolean;
  isCreatingCall: boolean;
  onSelectCall: (callId: string) => void;
  onCallClick: (call: Call) => void;
  onCreateCallAtSlot: (startsAt: Date, endsAt: Date) => void;
  channelPresentationsById: Map<string, ReturnType<typeof getXyneCalendarChannelPresentation>>;
}

const XyneCalendarDayView = memo(
  ({
    calls,
    currentDay,
    currentUserId,
    defaultCallTitle,
    isLoading,
    isScheduledCallsLoading,
    isCreatingCall,
    onSelectCall,
    onCallClick,
    onCreateCallAtSlot,
    channelPresentationsById,
  }: XyneCalendarDayViewProps): ReactElement => {
    const currentRoomExternalId = useSelector(roomActor, state => state.context.externalId);
    const isRoomSessionActive = useSelector(
      roomActor,
      state =>
        state.matches('joining') || state.matches('connecting') || state.matches('connected'),
    );
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const timelineSurfaceRef = useRef<HTMLDivElement>(null);
    const focusedDateRef = useRef<number | null>(null);
    const [now, setNow] = useState(() => new Date());
    const [hoverCreateSlot, setHoverCreateSlot] = useState<{
      startMins: number;
      endMins: number;
    } | null>(null);

    useEffect(() => {
      const intervalId = window.setInterval(() => setNow(new Date()), 12_000);
      return (): void => window.clearInterval(intervalId);
    }, []);

    const handleCreateCallAtSlot = useCallback(
      (startsAt: Date, endsAt: Date): void => {
        setHoverCreateSlot(null);
        onCreateCallAtSlot(startsAt, endsAt);
      },
      [onCreateCallAtSlot],
    );

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

    const dailyCalls = useMemo(
      () =>
        mergeCallsById(getCallsOverlappingDay(calls, currentDay)).sort(
          (firstCall, secondCall) =>
            new Date(firstCall.startsAt ?? 0).getTime() -
            new Date(secondCall.startsAt ?? 0).getTime(),
        ),
      [calls, currentDay],
    );

    const {
      sensors,
      dragPreview,
      activeCall,
      onDragStart,
      onDragMove,
      onDragEnd,
      onDragCancel,
      dialogOpen: rescheduleDialogOpen,
      confirm: confirmReschedule,
      cancel: cancelReschedule,
      pendingChange: pendingRescheduleChange,
    } = useDragReschedule(dailyCalls, TIMELINE_HOUR_HEIGHT, currentDay);

    const {
      resizePreview,
      activeResizeCallId,
      onResizePointerDown,
      dialogOpen: resizeDialogOpen,
      confirm: confirmResize,
      cancel: cancelResize,
      pendingChange: pendingResizeChange,
    } = useResizeEndTime(scrollContainerRef, TIMELINE_HOUR_HEIGHT, currentDay);

    useEffect(() => {
      const surface = timelineSurfaceRef.current;
      if (!surface) return;
      surface.style.cursor = activeCall ? 'grabbing' : activeResizeCallId ? 'ns-resize' : '';
    }, [activeCall, activeResizeCallId]);

    const handleTimelinePointerMove = useCallback(
      (event: React.PointerEvent<HTMLDivElement>): void => {
        if (
          isCreatingCall ||
          dragPreview ||
          resizePreview ||
          (event.target as HTMLElement).closest('button, [data-calendar-pill]')
        ) {
          setHoverCreateSlot(null);
          return;
        }

        const rawMins = minutesFromTopPx(
          event.clientY - event.currentTarget.getBoundingClientRect().top,
          TIMELINE_HOUR_HEIGHT,
        );
        const { startMins, endMins } = getCalendarCreateSlot(currentDay, rawMins, {
          ...CREATE_SLOT_OPTIONS,
          durationMins: CREATE_SLOT_DURATION_MINUTES,
        });

        setHoverCreateSlot(currentSlot =>
          currentSlot?.startMins === startMins ? currentSlot : { startMins, endMins },
        );
      },
      [currentDay, dragPreview, isCreatingCall, resizePreview],
    );

    const handleTimelineClick = createSlotClickHandler(
      currentDay,
      isCreatingCall,
      consumeDragEnd,
      handleCreateCallAtSlot,
      {
        ...CREATE_SLOT_OPTIONS,
        durationMins: CREATE_SLOT_DURATION_MINUTES,
        hourHeight: TIMELINE_HOUR_HEIGHT,
      },
    );

    const handleTimelineKeyDown = useCallback(
      (event: React.KeyboardEvent<HTMLDivElement>): void => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();

        const rawStartMins =
          hoverCreateSlot?.startMins ?? (isToday(currentDay) ? minutesSinceMidnight(now) : 8 * 60);
        const { startsAt, endsAt } = getCalendarCreateSlot(currentDay, rawStartMins, {
          ...CREATE_SLOT_OPTIONS,
          durationMins: CREATE_SLOT_DURATION_MINUTES,
        });
        handleCreateCallAtSlot(startsAt, endsAt);
      },
      [currentDay, handleCreateCallAtSlot, hoverCreateSlot?.startMins, now],
    );

    useEffect(() => setHoverCreateSlot(null), [currentDay]);

    const handleJoinPill = useCallback(
      (callId: string): void => {
        const call = dailyCalls.find(candidate => candidate.id === callId);
        if (call) onCallClick(call);
      },
      [dailyCalls, onCallClick],
    );

    const callPositions = useMemo(
      () => computeEventPositions(dailyCalls, currentDay),
      [dailyCalls, currentDay],
    );

    // Scroll the timeline to show the current time (or the best window of calls) when the day changes, but only if the user hasn't already scrolled to a different time.
    useEffect(() => {
      const selectedDateKey = startOfDay(currentDay).getTime();
      if (focusedDateRef.current === selectedDateKey || isLoading || isScheduledCallsLoading) {
        return;
      }

      const frameId = window.requestAnimationFrame(() => {
        const scrollContainer = scrollContainerRef.current;
        if (!scrollContainer) return;

        const visibleMinutes = Math.min(
          DAY_MINUTES,
          (scrollContainer.clientHeight / TIMELINE_HOUR_HEIGHT) * 60,
        );
        const currentMinutes = isToday(currentDay) ? minutesSinceMidnight(new Date()) : undefined;
        const windowStart = getBestTimelineWindowStart(
          Array.from(callPositions.values()),
          visibleMinutes,
          currentMinutes,
        );

        scrollContainer.scrollTop = getTimelineOffset(windowStart);
        focusedDateRef.current = selectedDateKey;
      });

      return (): void => window.cancelAnimationFrame(frameId);
    }, [callPositions, isLoading, isScheduledCallsLoading, currentDay]);

    const visibleCreatePreview = dragCreatePreview ?? hoverCreateSlot;
    const visibleCreateDates = visibleCreatePreview
      ? getCalendarCreateSlot(currentDay, visibleCreatePreview.startMins, {
          ...CREATE_SLOT_OPTIONS,
          durationMins: visibleCreatePreview.endMins - visibleCreatePreview.startMins,
        })
      : null;

    return (
      <DndContext
        sensors={sensors}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        <div ref={scrollContainerRef} className='min-h-0 flex-1 overflow-y-auto px-3 pb-7'>
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
                  {formatHourLabel(hour)}
                </span>
                <span className='h-px flex-1 bg-muted-foreground/15 rounded' aria-hidden='true' />
              </div>
            ))}

            <XyneCalendarDayTimelineSurface
              currentDay={currentDay}
              surfaceRef={timelineSurfaceRef}
              onClick={event => {
                if ((event.target as HTMLElement).closest('[data-calendar-pill]')) return;
                handleTimelineClick(event);
              }}
              onKeyDown={handleTimelineKeyDown}
              onPointerDown={event => {
                if ((event.target as HTMLElement).closest('[data-calendar-pill]')) return;
                onDragCreatePointerDown(event, currentDay);
              }}
              onPointerMove={handleTimelinePointerMove}
              onPointerLeave={() => setHoverCreateSlot(null)}
            >
              {isToday(currentDay) && (
                <div
                  className='pointer-events-none absolute left-0 right-0 z-0 flex -translate-y-1/2 items-center'
                  style={{
                    top: getTimelineOffset(minutesSinceMidnight(now)),
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

              {/* Move-drag ghost — shows the proposed drop time */}
              {dragPreview && (
                <CalendarEventGhost
                  top={getTimelineOffset(dragPreview.newStartMins)}
                  height={Math.max(
                    MINIMUM_CALL_PILL_HEIGHT,
                    getTimelineOffset(
                      Math.max(15, (dragPreview.newEndsAt - dragPreview.newStartsAt) / 60_000),
                    ),
                  )}
                  formattedTime={dragPreview.formattedTime}
                />
              )}

              {resizePreview && (
                <CalendarEventGhost
                  top={getTimelineOffset(resizePreview.startMins)}
                  height={Math.max(
                    MINIMUM_CALL_PILL_HEIGHT,
                    getTimelineOffset(resizePreview.newEndMins - resizePreview.startMins),
                  )}
                  formattedTime={resizePreview.formattedTime}
                />
              )}

              {visibleCreatePreview && visibleCreateDates && (
                <div
                  className={
                    dragCreatePreview
                      ? 'pointer-events-none absolute left-1 right-1 overflow-hidden rounded-lg border border-primary/70 bg-primary px-3 py-1 text-primary-foreground shadow-[0_8px_24px_-8px_hsl(var(--destructive)/0.65)]'
                      : 'pointer-events-none absolute left-1 right-1 flex items-center rounded-lg border border-primary/60 bg-background px-3 text-primary shadow-sm'
                  }
                  style={{
                    top:
                      getTimelineOffset(visibleCreatePreview.startMins) + CALL_PILL_VERTICAL_INSET,
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
                      <PlusDefault className='size-3 shrink-0' strokeWidth={3} aria-hidden='true' />
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
                const variant = getCallPillVariant(call, currentUserId, now);
                const joinable = isCallJoinableNow(call, variant, now);
                const continuesFromPreviousDay = !isSameDay(new Date(call.startsAt), currentDay);
                const continuesToNextDay =
                  !!call.endsAt && !isSameDay(new Date(call.endsAt), currentDay);
                const topInset = continuesFromPreviousDay ? 0 : CALL_PILL_VERTICAL_INSET;
                const bottomInset = continuesToNextDay ? 0 : CALL_PILL_VERTICAL_INSET;
                const top = getTimelineOffset(position.startMins) + topInset;
                const height = Math.max(
                  MINIMUM_CALL_PILL_HEIGHT,
                  getTimelineOffset(position.endMins - position.startMins) - topInset - bottomInset,
                );
                const channel = call.channelId
                  ? channelPresentationsById.get(call.channelId)
                  : undefined;
                const joinDisabled =
                  isRoomSessionActive && currentRoomExternalId === call.externalId;
                return (
                  <XyneCalendarDraggableDayPill
                    key={call.id}
                    call={call}
                    draggable={isCallDraggable(call, currentUserId)}
                    isBeingResized={activeResizeCallId === call.id}
                    top={top}
                    height={height}
                    leftPct={position.leftPct}
                    widthPct={position.widthPct}
                    variant={variant}
                    {...(channel && { channel })}
                    onSelect={onSelectCall}
                    onJoin={handleJoinPill}
                    joinable={joinable}
                    joinDisabled={joinDisabled}
                    showJoinByDefault={
                      position.widthPct >= ALWAYS_VISIBLE_JOIN_MIN_WIDTH_PERCENTAGE
                    }
                    past={callHasEnded}
                    compact={height < 40}
                    showCompactMetadata={position.widthPct >= COMPACT_METADATA_MIN_WIDTH_PERCENTAGE}
                    continuesFromPreviousDay={continuesFromPreviousDay}
                    continuesToNextDay={continuesToNextDay}
                    onResizePointerDown={onResizePointerDown}
                  />
                );
              })}
            </XyneCalendarDayTimelineSurface>
          </div>
        </div>

        <RecurringRescheduleDialog
          isOpen={rescheduleDialogOpen}
          onConfirm={confirmReschedule}
          onCancel={cancelReschedule}
          pendingChange={pendingRescheduleChange}
          isRecurring={Boolean(pendingRescheduleChange?.call.recurringSeriesId)}
          confirmLabel='Confirm move'
        />
        <RecurringRescheduleDialog
          isOpen={resizeDialogOpen}
          onConfirm={confirmResize}
          onCancel={cancelResize}
          pendingChange={pendingResizeChange}
          isRecurring={Boolean(pendingResizeChange?.call.recurringSeriesId)}
          confirmLabel='Confirm resize'
        />
      </DndContext>
    );
  },
);

XyneCalendarDayView.displayName = 'XyneCalendarDayView';

const XyneCalendarSidebarTimeline = memo(
  ({
    selectedDate,
    selectedCallId,
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
    const visibleChannels = useAllVisibleChannels();
    const currentRoomExternalId = useSelector(roomActor, state => state.context.externalId);
    const isRoomSessionActive = useSelector(
      roomActor,
      state =>
        state.matches('joining') || state.matches('connecting') || state.matches('connected'),
    );
    const selectedCallSnapshotRef = useRef<Call | null>(null);
    const [now, setNow] = useState(() => new Date());
    const [scheduleInitialTime, setScheduleInitialTime] = useState<{
      startsAt: Date;
      endsAt: Date;
    } | null>(null);

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
    const allCalls = useMemo(
      () => mergeCallsById([...(calls ?? []), ...(calendarScheduledCalls ?? [])]),
      [calls, calendarScheduledCalls],
    );

    useEffect(() => {
      const intervalId = window.setInterval(() => setNow(new Date()), 12_000);
      return (): void => window.clearInterval(intervalId);
    }, []);

    const dailyCalls = useMemo(
      () =>
        mergeCallsById(
          getCallsOverlappingDay(
            [...(calls ?? []), ...(calendarScheduledCalls ?? [])],
            selectedDate,
          ),
        ).sort(
          (firstCall, secondCall) =>
            new Date(firstCall.startsAt ?? 0).getTime() -
            new Date(secondCall.startsAt ?? 0).getTime(),
        ),
      [calendarScheduledCalls, calls, selectedDate],
    );

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
      () => getPeriodCallCounts(viewPeriodCalls),
      [viewPeriodCalls],
    );

    const channelPresentationsById = useXyneCalendarChannelPresentations(user?.id);
    const accessibleChannelIds = useMemo(
      () => new Set(visibleChannels.map(channel => channel.id)),
      [visibleChannels],
    );

    // Not `dailyCalls`: that list requires `startsAt` (getCallsOverlappingDay) and only
    // covers SCHEDULED/ended-history statuses.
    const queriedSelectedCall = useMemo(() => {
      if (!selectedCallId) return null;
      return (
        calls?.find(call => call.id === selectedCallId) ??
        calendarScheduledCalls?.find(call => call.id === selectedCallId) ??
        null
      );
    }, [calls, calendarScheduledCalls, selectedCallId]);

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
        isLoading={isLoading || isScheduledCallsLoading}
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
              channelPresentationsById={channelPresentationsById}
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
          <XyneCalendarDayView
            calls={allCalls}
            currentDay={selectedDate}
            currentUserId={user?.id}
            defaultCallTitle={defaultCallTitle}
            isLoading={isLoading}
            isScheduledCallsLoading={isScheduledCallsLoading}
            isCreatingCall={scheduleInitialTime !== null}
            onSelectCall={onSelectCall}
            onCallClick={handleCallRowClick}
            onCreateCallAtSlot={handleCreateCallAtSlot}
            channelPresentationsById={channelPresentationsById}
          />
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
