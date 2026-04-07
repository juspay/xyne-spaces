import { ReactElement, useEffect, useRef, useState } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { CallStatus, MeetingStatus } from '@xyne/shared';
import { Call } from './callHistoryItem.utils';
import { cn } from '../../utils/classNames';
import CalendarCallPopup from './CalendarCallPopup';
import {
  POPOVER_CONTENT_CLASS,
  HOUR_HEIGHT,
  MIN_EVENT_HEIGHT,
  DAY_NAMES,
  HOURS,
  OVERLAP_LEFT_MARGIN,
  isSameDay,
  getWeekStartForMonth,
  minutesSinceMidnight,
  topPxForMinutes,
  formatHourLabel,
  formatTime,
  formatCurrentTime,
  getCurrentUserMeetingStatus,
  dayKey,
  computeOverlapIndices,
} from './CalenderViewUtils';

interface CalendarWeekViewProps {
  calls: Call[];
  currentWeekStart: Date; // Sunday of the displayed week
  currentUserId?: string | undefined;
  onCallClick: (call: Call) => void;
  onGotoMessage: (call: Call) => void;
  onDownloadTranscript: (call: Call) => void;
}

const TIME_GUTTER_WIDTH = 80; // px

const CalendarWeekView = ({
  calls,
  currentWeekStart,
  currentUserId,
  onCallClick,
  onGotoMessage,
  onDownloadTranscript,
}: CalendarWeekViewProps): ReactElement => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => new Date());
  const [openCallId, setOpenCallId] = useState<string | null>(null);

  // Update current time every minute
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Scroll to just before current time (or 8 AM) when week changes
  useEffect(() => {
    if (!scrollRef.current) return;
    const targetMinutes = minutesSinceMidnight(now) - 60; // 1 hour before now
    scrollRef.current.scrollTop = Math.max(0, topPxForMinutes(targetMinutes));
  }, [currentWeekStart]); // eslint-disable-line react-hooks/exhaustive-deps

  const today = new Date();
  const clampedWeekStart = getWeekStartForMonth(currentWeekStart);
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(clampedWeekStart);
    d.setDate(d.getDate() + i);
    return d;
  });

  // Group calls by day key
  const callsByDay = new Map<string, Call[]>();
  weekDays.forEach(d => callsByDay.set(dayKey(d), []));
  calls.forEach(call => {
    if (!call.startsAt) return;
    const k = dayKey(new Date(call.startsAt));
    if (callsByDay.has(k)) callsByDay.get(k)!.push(call);
  });

  // Current time indicator
  const isCurrentWeek = weekDays.some(d => isSameDay(d, today));
  const currentTimePx = topPxForMinutes(minutesSinceMidnight(now));
  const todayColIndex = weekDays.findIndex(d => isSameDay(d, today));

  return (
    <div className='w-full flex flex-col border border-border rounded-xl overflow-hidden'>
      {/* ── Day header row ── */}
      <div className='flex shrink-0 border-b border-border bg-background'>
        {/* gutter spacer */}
        <div style={{ width: TIME_GUTTER_WIDTH }} className='shrink-0 border-r border-border' />
        {weekDays.map((day, i) => {
          const isToday = isSameDay(day, today);
          return (
            <div
              key={i}
              className={cn(
                'flex-1 py-2.5 text-center border-r last:border-r-0 border-border',
                isToday && 'bg-primary/5',
              )}
            >
              <span
                className={cn(
                  'text-sm font-medium',
                  isToday ? 'text-primary' : 'text-muted-foreground',
                )}
              >
                {DAY_NAMES[day.getDay()]} {day.getDate()}
              </span>
            </div>
          );
        })}
      </div>

      {/* ── Scrollable time grid ── */}
      <div
        ref={scrollRef}
        className='overflow-y-auto'
        style={{ maxHeight: 'calc(100dvh - 200px)' }}
      >
        <div className='flex' style={{ height: HOUR_HEIGHT * 24 }}>
          {/* Time gutter */}
          <div
            style={{ width: TIME_GUTTER_WIDTH }}
            className='shrink-0 border-r border-border relative select-none'
          >
            {HOURS.map(hour => (
              <div
                key={hour}
                className='absolute left-0 right-0 flex justify-end pr-2'
                style={{ top: hour * HOUR_HEIGHT - 9 }} // -9 to vertically center label on the hour line
              >
                {hour > 0 && (
                  <span className='text-[11px] text-muted-foreground leading-none'>
                    {formatHourLabel(hour)}
                  </span>
                )}
              </div>
            ))}

            {/* Current time badge */}
            {isCurrentWeek && (
              <div
                className='absolute left-0 right-0 flex justify-end pr-2 z-20 pointer-events-none'
                style={{ top: currentTimePx - 9 }}
              >
                <span className='text-[10px] font-semibold text-red-500 bg-background border border-red-300 dark:border-red-700 rounded px-1 py-0.5 whitespace-nowrap leading-none'>
                  {formatCurrentTime(now)}
                </span>
              </div>
            )}
          </div>

          {/* Day columns */}
          <div className='flex flex-1 relative'>
            {/* Hour grid lines */}
            {HOURS.map(hour => (
              <div
                key={hour}
                className='absolute left-0 right-0 border-t border-border/60'
                style={{ top: hour * HOUR_HEIGHT }}
              />
            ))}

            {/* Current time line */}
            {isCurrentWeek && todayColIndex >= 0 && (
              <div
                className='absolute z-10 pointer-events-none'
                style={{
                  top: currentTimePx,
                  left: `calc(${(todayColIndex / 7) * 100}%)`,
                  right: `calc(${((6 - todayColIndex) / 7) * 100}%)`,
                }}
              >
                {/* Left dot anchored to today's column */}
                <div
                  className='absolute top-1/2 -translate-y-1/2 size-2 rounded-full bg-red-500'
                  style={{ left: '0px' }}
                />
                {/* Horizontal line from today's column to the right */}
                <div
                  className='absolute h-px bg-red-500'
                  style={{
                    left: '4px',
                    right: 0,
                  }}
                />
              </div>
            )}

            {/* Events per day */}
            <div className='absolute inset-0 flex'>
              {weekDays.map((day, i) => {
                const dayCalls = callsByDay.get(dayKey(day)) ?? [];
                const overlapInfos = computeOverlapIndices(dayCalls);
                const isToday = isSameDay(day, today);
                return (
                  <div
                    key={i}
                    className={cn(
                      'flex-1 relative border-r last:border-r-0 border-border',
                      isToday && 'bg-primary/[0.02]',
                    )}
                  >
                    {dayCalls.map((call, callIdx) => {
                      if (!call.startsAt) return null;

                      const overlapInfo = overlapInfos[callIdx];
                      if (!overlapInfo) return null;

                      const startMins = overlapInfo.startMins;
                      const endMins = overlapInfo.endMins;
                      const durationMins = Math.max(15, endMins - startMins);

                      const top = topPxForMinutes(startMins);
                      const height = Math.max(MIN_EVENT_HEIGHT, topPxForMinutes(durationMins));
                      const leftPx = overlapInfo.overlapIndex * OVERLAP_LEFT_MARGIN;
                      const isEnded = call.status === CallStatus.ENDED;
                      const meetingStatus = getCurrentUserMeetingStatus(call, currentUserId);
                      const isDeclined = meetingStatus === MeetingStatus.DECLINED;
                      const isMaybe = meetingStatus === MeetingStatus.MAYBE;

                      return (
                        <PopoverPrimitive.Root
                          key={call.id}
                          open={openCallId === call.id}
                          onOpenChange={open => setOpenCallId(open ? call.id : null)}
                        >
                          <PopoverPrimitive.Trigger asChild>
                            <button
                              title={call.title ?? 'Call'}
                              className='absolute right-1 rounded overflow-hidden text-left transition-colors border-l-[3px] cursor-pointer z-[5] focus:outline-none'
                              style={{
                                top,
                                height,
                                left: `calc(0.25rem + ${leftPx}px)`,
                                backgroundColor: isEnded
                                  ? meetingStatus === MeetingStatus.ACCEPTED
                                    ? '#0077FF1A'
                                    : 'transparent'
                                  : meetingStatus === MeetingStatus.ACCEPTED
                                    ? '#0077FF1A'
                                    : 'transparent',
                                borderLeftColor: '#0077FF',
                              }}
                            >
                              {isMaybe && !isEnded && (
                                <div className='pointer-events-none absolute inset-0 overflow-hidden'>
                                  <div
                                    className='absolute inset-0'
                                    style={{
                                      backgroundImage:
                                        'repeating-linear-gradient(-18deg, rgba(9, 46, 88, 0.55) 0 1px, transparent 1px 4px)',
                                    }}
                                  />
                                </div>
                              )}
                              <div className='px-1.5 py-1 h-full flex flex-col justify-start overflow-hidden'>
                                <span
                                  className='truncate'
                                  style={{
                                    color: isEnded ? 'hsl(var(--foreground))' : '#092E58',
                                    fontSize: '12px',
                                    lineHeight: '18px',
                                    fontWeight: 500,
                                    textDecorationLine: isDeclined ? 'line-through' : 'none',
                                  }}
                                >
                                  {call.title ?? 'Call'}
                                </span>
                                {height >= 40 && (
                                  <span
                                    className='mt-0.5 whitespace-nowrap'
                                    style={{
                                      color: isEnded ? 'hsl(var(--muted-foreground))' : '#092E58',
                                      fontSize: '10px',
                                      lineHeight: '14px',
                                      opacity: 0.7,
                                      textDecorationLine: isDeclined ? 'line-through' : 'none',
                                    }}
                                  >
                                    {formatTime(call.startsAt)}
                                    {call.endsAt && ` - ${formatTime(call.endsAt)}`}
                                  </span>
                                )}
                              </div>
                            </button>
                          </PopoverPrimitive.Trigger>
                          <PopoverPrimitive.Portal>
                            <PopoverPrimitive.Content
                              sideOffset={6}
                              avoidCollisions
                              collisionPadding={16}
                              onOpenAutoFocus={e => e.preventDefault()}
                              className={POPOVER_CONTENT_CLASS}
                            >
                              <CalendarCallPopup
                                call={call}
                                currentUserId={currentUserId}
                                onClose={() => setOpenCallId(null)}
                                onJoinCall={() => {
                                  setOpenCallId(null);
                                  onCallClick(call);
                                }}
                                onGotoMessage={() => {
                                  setOpenCallId(null);
                                  onGotoMessage(call);
                                }}
                                onDownloadTranscript={() => {
                                  setOpenCallId(null);
                                  onDownloadTranscript(call);
                                }}
                              />
                            </PopoverPrimitive.Content>
                          </PopoverPrimitive.Portal>
                        </PopoverPrimitive.Root>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CalendarWeekView;
