import { memo, type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useSelector } from '@xstate/react';
import { ChevronLeft, ChevronRight, MultipleCrossCancelDefault } from '@xyne/icons';
import { addDays, format, isSameDay, isToday, startOfDay } from 'date-fns';
import { CallStatus, MeetingStatus } from '@xyne/shared';
import {
  closeXyneCalendarSidebar,
  getXyneCalendarChannelPresentation,
  xyneCalendarSidebarMotionVariants,
} from './xyneCalendarSidebar.utils';
import { Button } from '../../ui/Button/Button';
import { DatePicker } from '../../ui/DatePicker/DatePicker';
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
  getCurrentUserMeetingStatus,
} from '../../../routes/CallHistoryScreen/CalenderViewUtils';
import { XyneCalendarCallPill, type XyneCalendarCallPillVariant } from './XyneCalendarCallPill';
import CallDetailSidebarView from './CallDetailSidebarView';
import { ScheduleCallModal } from '../../Call/ScheduleCallModal/ScheduleCallModal';
import { DeleteCallModal } from '../../Call/DeleteCallModal';
import { roomActor } from '../../../machines/roomMachine';

const TIMELINE_HOUR_HEIGHT = 72;
const TIMELINE_HOURS = Array.from({ length: 25 }, (_, hour) => hour);
const TIMELINE_DAY_MINUTES = 24 * 60;
const MINIMUM_CALL_PILL_HEIGHT = 20;
const CALL_PILL_VERTICAL_INSET = 2;
const ALWAYS_VISIBLE_JOIN_MIN_WIDTH_PERCENTAGE = 75;
const COMPACT_METADATA_MIN_WIDTH_PERCENTAGE = 75;

interface XyneCalendarSidebarProps {
  open: boolean;
}

const XyneCalendarSidebarComponent = ({ open }: XyneCalendarSidebarProps): ReactElement => {
  const shouldReduceMotion = useReducedMotion();
  const [selectedDate, setSelectedDate] = useState<Date>(() => startOfDay(new Date()));
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);

  const handlePreviousDay = useCallback((): void => {
    setSelectedDate(currentDate => addDays(currentDate, -1));
  }, []);

  const handleNextDay = useCallback((): void => {
    setSelectedDate(currentDate => addDays(currentDate, 1));
  }, []);

  const handleToday = useCallback((): void => {
    setSelectedDate(startOfDay(new Date()));
  }, []);

  const handleClearSelectedCall = useCallback((): void => setSelectedCallId(null), []);

  // Re-opening the sidebar should land on the timeline, not the last opened call.
  useEffect(() => {
    if (!open) setSelectedCallId(null);
  }, [open]);

  return (
    <motion.aside
      aria-label='Calendar'
      className='flex h-full w-full flex-col bg-transparent'
      initial={shouldReduceMotion ? false : 'hidden'}
      animate={open ? 'visible' : 'hidden'}
      variants={xyneCalendarSidebarMotionVariants}
    >
      {selectedCallId === null && (
        <XyneCalendarSidebarHeader
          selectedDate={selectedDate}
          onDateChange={setSelectedDate}
          onPreviousDay={handlePreviousDay}
          onNextDay={handleNextDay}
          onToday={handleToday}
        />
      )}
      {open && (
        <XyneCalendarSidebarTimeline
          selectedDate={selectedDate}
          selectedCallId={selectedCallId}
          onSelectCall={setSelectedCallId}
          onClearSelectedCall={handleClearSelectedCall}
        />
      )}
    </motion.aside>
  );
};

export const XyneCalendarSidebar = memo(XyneCalendarSidebarComponent);

XyneCalendarSidebar.displayName = 'XyneCalendarSidebar';

interface XyneCalendarSidebarHeaderProps {
  selectedDate: Date;
  onDateChange: (date: Date) => void;
  onPreviousDay: () => void;
  onNextDay: () => void;
  onToday: () => void;
}

const XyneCalendarSidebarHeader = memo(
  ({
    selectedDate,
    onDateChange,
    onPreviousDay,
    onNextDay,
    onToday,
  }: XyneCalendarSidebarHeaderProps): ReactElement => {
    const handleDateSelect = (date: Date | null): void => {
      if (!date) return;
      onDateChange(startOfDay(date));
    };

    return (
      <header className='shrink-0'>
        <div className='flex h-12 items-center gap-1.5 px-2.5'>
          <h2 className='min-w-0 flex-1 truncate text-sm font-bold text-foreground pl-1 select-none'>Calendar</h2>
          <Button
            variant='ghost'
            size='iconSm'
            title='Close'
            aria-label='Close Calendar sidebar'
            onClick={closeXyneCalendarSidebar}
            data-track-category='Calendar'
            data-track-name='CLOSE_CALENDAR_SIDEBAR'
            className='size-7 rounded-lg text-muted-foreground'
          >
            <MultipleCrossCancelDefault
              className='size-4'
              strokeWidth={2}
              aria-hidden='true'
            />
          </Button>
        </div>

        <div className='relative z-10 flex h-14 items-center gap-1.5 border-b border-border px-3 shadow-sm '>
          <Button
            variant='outline'
            size='iconSm'
            title='Previous day'
            aria-label='Previous day'
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
            title='Next day'
            aria-label='Next day'
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
          />

          <Button
            variant='outline'
            size='sm'
            onClick={onToday}
            disabled={isToday(selectedDate)}
            data-track-category='Calendar'
            data-track-name='TODAY'
            className='rounded-full'
          >
            Today
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
  onSelectCall: (callId: string) => void;
  onClearSelectedCall: () => void;
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
    onSelectCall,
    onClearSelectedCall,
  }: XyneCalendarSidebarTimelineProps): ReactElement => {
    const { user } = useAuth();
    const {
      calls,
      calendarScheduledCalls,
      isLoading,
      isScheduledCallsLoading,
      handleCallRowClick,
      getGotoTranscriptHandler,
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
    const focusedDateRef = useRef<number | null>(null);
    const selectedCallSnapshotRef = useRef<Call | null>(null);
    const [now, setNow] = useState(() => new Date());

    const isCallDetailOpen = selectedCallId !== null;

    useEffect(() => {
      const intervalId = window.setInterval(() => setNow(new Date()), 12_000);
      return (): void => window.clearInterval(intervalId);
    }, []);

    const dailyCalls = useMemo(() => {
      const callsById = new Map<string, Call>();

      for (const call of [...(calls ?? []), ...(calendarScheduledCalls ?? [])]) {
        if (!call.startsAt || !isSameDay(new Date(call.startsAt), selectedDate)) continue;
        callsById.set(call.id, call);
      }

      return Array.from(callsById.values()).sort(
        (firstCall, secondCall) =>
          new Date(firstCall.startsAt ?? 0).getTime() -
          new Date(secondCall.startsAt ?? 0).getTime(),
      );
    }, [calendarScheduledCalls, calls, selectedDate]);

    const callPositions = useMemo(() => computeEventPositions(dailyCalls), [dailyCalls]);
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

    const queriedSelectedCall = useMemo(
      () => dailyCalls.find(call => call.id === selectedCallId) ?? null,
      [dailyCalls, selectedCallId],
    );

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

    if (selectedCall) {
      const threadChannelId = selectedCall.callUpdatesChannel ?? selectedCall.channelId;
      const selectedChannel = selectedCall.channelId
        ? channelPresentationsById.get(selectedCall.channelId)
        : undefined;
      const hasThreadAccess = !!threadChannelId && accessibleChannelIds.has(threadChannelId);

      return (
        <>
          <CallDetailSidebarView
            call={selectedCall}
            currentUserId={user?.id}
            dayLabel={isToday(selectedDate) ? 'Today' : format(selectedDate, 'EEE, MMM d')}
            channel={selectedChannel}
            onBack={onClearSelectedCall}
            onClose={closeXyneCalendarSidebar}
            onJoinCall={() => handleCallRowClick(selectedCall)}
            onOpenCallThread={
              hasThreadAccess ? getGotoTranscriptHandler(selectedCall) : undefined
            }
            onDownloadTranscript={() => handleDownloadTranscript(selectedCall)}
            onEditCall={() => handleEditClick(selectedCall)}
            onDeleteCall={() => handleDeleteClick(selectedCall)}
          />

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
        </>
      );
    }

    return (
      <div ref={scrollContainerRef} className='min-h-0 flex-1 overflow-y-auto px-3 pb-7 pt-1'>
        <div
          className='relative min-w-0'
          style={{ height: TIMELINE_HOUR_HEIGHT * 24 }}
          aria-label='Calendar day timeline'
        >
          {TIMELINE_HOURS.map(hour => (
            <div
              key={hour}
              className='absolute left-0 right-0 flex items-center gap-4'
              style={{ top: hour * TIMELINE_HOUR_HEIGHT }}
            >
              <span className='w-16 shrink-0 text-right text-xs font-mono leading-none text-muted-foreground/80'>
                {formatTimelineHour(hour)}
              </span>
              <span className='h-px flex-1 bg-muted-foreground/15 rounded' aria-hidden='true' />
            </div>
          ))}

          <div className='absolute bottom-0 left-20 right-0 top-0'>
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

            {dailyCalls.map(call => {
              const position = callPositions.get(call.id);
              if (!position || !call.startsAt) return null;

              const callHasEnded = hasCallEnded(call, now);
              const variant = getCallPillVariant(call, user?.id, now);
              const joinable =
                !callHasEnded &&
                (variant === 'joinable' ||
                  (variant === 'highlighted' && isScheduledCallJoinable(call, now.getTime())));

              const top = getTimelineOffset(position.startMins) + CALL_PILL_VERTICAL_INSET;
              const height = Math.max(
                MINIMUM_CALL_PILL_HEIGHT,
                getTimelineOffset(position.endMins - position.startMins) -
                  CALL_PILL_VERTICAL_INSET * 2,
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
                    showCompactMetadata={position.widthPct >= COMPACT_METADATA_MIN_WIDTH_PERCENTAGE}
                    className='h-full'
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  },
);

XyneCalendarSidebarTimeline.displayName = 'XyneCalendarSidebarTimeline';
