import { ReactElement, useEffect, useRef, useState } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Call, isGoogleCalendarCall, isMicrosoftCalendarCall } from './callHistoryItem.utils';
import { GoogleCalendarIcon, MicrosoftIcon } from './CalendarIcons';
import { cn } from '../../utils/classNames';
import CalendarCallPopup from './CalendarCallPopup';
import {
  POPOVER_CONTENT_CLASS,
  HOUR_HEIGHT,
  MIN_EVENT_HEIGHT,
  DAY_NAMES,
  HOURS,
  isSameDay,
  minutesSinceMidnight,
  topPxForMinutes,
  formatHourLabel,
  formatTime,
  formatCurrentTime,
  getCurrentUserMeetingStatus,
} from './CalenderViewUtils';
import { CallStatus, MeetingStatus } from '@xyne/shared';

interface CalendarDayViewProps {
  calls: Call[];
  currentDay: Date; // midnight of the displayed day
  currentUserId?: string | undefined;
  onCallClick: (call: Call) => void;
  onGotoMessage: (call: Call) => void;
  onDownloadTranscript: (call: Call) => void;
  onEditClick?: (call: Call) => void;
}

const TIME_GUTTER_WIDTH = 90; // slightly wider to fit the time pill

const CalendarDayView = ({
  calls,
  currentDay,
  currentUserId,
  onCallClick,
  onGotoMessage,
  onDownloadTranscript,
  onEditClick,
}: CalendarDayViewProps): ReactElement => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => new Date());
  const [openCallId, setOpenCallId] = useState<string | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Scroll to 1 hour before current time (or 8 AM) when day changes
  useEffect(() => {
    if (!scrollRef.current) return;
    const today = new Date();
    const targetMinutes = isSameDay(currentDay, today) ? minutesSinceMidnight(today) - 60 : 8 * 60; // default to 8 AM for non-today days
    scrollRef.current.scrollTop = Math.max(0, topPxForMinutes(targetMinutes));
  }, [currentDay]); // eslint-disable-line react-hooks/exhaustive-deps

  const today = new Date();
  const isDisplayingToday = isSameDay(currentDay, today);

  // Filter calls for the current day
  const dayCalls = calls.filter(call => {
    if (!call.startsAt) return false;
    return isSameDay(new Date(call.startsAt), currentDay);
  });

  // Sort by start time
  dayCalls.sort(
    (a, b) => new Date(a.startsAt ?? 0).getTime() - new Date(b.startsAt ?? 0).getTime(),
  );

  const currentTimePx = topPxForMinutes(minutesSinceMidnight(now));
  const dayName = DAY_NAMES[currentDay.getDay()];
  const dayNumber = currentDay.getDate();

  return (
    <div className='w-full flex flex-col border border-border rounded-xl overflow-hidden'>
      {/* ── Single day header ── */}
      <div className='flex shrink-0 border-b border-border bg-background'>
        <div style={{ width: TIME_GUTTER_WIDTH }} className='shrink-0 border-r border-border' />
        <div
          className={cn(
            'flex-1 py-2.5 px-3 text-sm font-medium',
            isDisplayingToday ? 'text-primary bg-primary/5' : 'text-muted-foreground',
          )}
        >
          {dayName} {dayNumber}
        </div>
      </div>

      {/* ── Scrollable time grid ── */}
      <div
        ref={scrollRef}
        className='overflow-y-auto'
        style={{ maxHeight: 'calc(100dvh - 290px)' }}
      >
        <div className='flex' style={{ height: HOUR_HEIGHT * 24 }}>
          {/* ── Time gutter ── */}
          <div
            style={{ width: TIME_GUTTER_WIDTH }}
            className='shrink-0 border-r border-border relative select-none'
          >
            {/* Hour labels */}
            {HOURS.map(hour => (
              <div
                key={hour}
                className='absolute left-0 right-0 flex justify-end pr-2'
                style={{ top: hour * HOUR_HEIGHT - 9 }}
              >
                {hour > 0 && (
                  <span className='text-[11px] text-muted-foreground leading-none'>
                    {formatHourLabel(hour)}
                  </span>
                )}
              </div>
            ))}

            {/* Current time pill badge */}
            {isDisplayingToday && (
              <div
                className='absolute left-0 right-0 z-20 pointer-events-none flex items-center justify-center'
                style={{ top: currentTimePx - 10, height: 20 }}
              >
                <span className='text-[10px] font-semibold text-red-500 border border-red-400 dark:border-red-600 rounded-full px-2 py-0.5 bg-background leading-none whitespace-nowrap'>
                  {formatCurrentTime(now)}
                </span>
              </div>
            )}
          </div>

          {/* ── Day content column ── */}
          <div className='flex-1 relative'>
            {/* Hour grid lines */}
            {HOURS.map(hour => (
              <div
                key={hour}
                className='absolute left-0 right-0 border-t border-border/60'
                style={{ top: hour * HOUR_HEIGHT }}
              />
            ))}

            {/* Current time horizontal line */}
            {isDisplayingToday && (
              <div
                className='absolute left-0 right-0 h-px bg-red-500 z-10 pointer-events-none'
                style={{ top: currentTimePx }}
              />
            )}

            {/* Call event blocks */}
            {dayCalls.map(call => {
              if (!call.startsAt) return null;

              const startMins = minutesSinceMidnight(new Date(call.startsAt));
              const endMins = call.endsAt
                ? minutesSinceMidnight(new Date(call.endsAt))
                : startMins + 60;
              const durationMins = Math.max(15, endMins - startMins);

              const top = topPxForMinutes(startMins);
              const height = Math.max(MIN_EVENT_HEIGHT, topPxForMinutes(durationMins));
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
                      className={cn(
                        'absolute left-2 right-2 rounded overflow-hidden text-left transition-colors border-l-[3px] cursor-pointer z-[5] focus:outline-none border-l-primary',
                        meetingStatus === MeetingStatus.ACCEPTED && 'bg-primary/10',
                      )}
                      style={{
                        top,
                        height,
                      }}
                    >
                      {isMaybe && !isEnded && (
                        <div className='pointer-events-none absolute inset-0 overflow-hidden'>
                          <div className='absolute inset-0 call-stripe-pattern' />
                        </div>
                      )}
                      <div className='px-2 py-1.5 h-full flex flex-col justify-start overflow-hidden'>
                        <span
                          className='leading-tight truncate text-foreground'
                          style={{
                            fontSize: '12px',
                            lineHeight: '18px',
                            fontWeight: 500,
                            textDecorationLine: isDeclined ? 'line-through' : 'none',
                          }}
                        >
                          {isGoogleCalendarCall(call) && (
                            <span className='inline-block mr-0.5 mb-px'>
                              <GoogleCalendarIcon size={14} />
                            </span>
                          )}
                          {isMicrosoftCalendarCall(call) && (
                            <span className='inline-block mr-0.5 mb-px'>
                              <MicrosoftIcon size={14} />
                            </span>
                          )}
                          {call.title ?? 'Call'}
                        </span>
                        {height >= 40 && (
                          <span
                            className='leading-tight mt-0.5 whitespace-nowrap text-muted-foreground'
                            style={{
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
                        onEditClick={
                          onEditClick
                            ? () => {
                                setOpenCallId(null);
                                onEditClick(call);
                              }
                            : undefined
                        }
                      />
                    </PopoverPrimitive.Content>
                  </PopoverPrimitive.Portal>
                </PopoverPrimitive.Root>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CalendarDayView;
