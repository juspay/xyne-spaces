import { ReactElement, useState } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { X } from 'lucide-react';
import { CallStatus, MeetingStatus } from '@xyne/shared';
import { Call } from './callHistoryItem.utils';
import { cn } from '../../utils/classNames';
import CalendarCallPopup from './CalendarCallPopup';
import {
  POPOVER_CONTENT_CLASS,
  DAY_NAMES,
  isSameDay,
  formatTime,
  getCurrentUserMeetingStatus,
} from './CalenderViewUtils';

interface CalendarMonthViewProps {
  calls: Call[];
  currentMonth: Date;
  currentUserId?: string | undefined;
  onCallClick: (call: Call) => void;
  onGotoMessage: (call: Call) => void;
  onDownloadTranscript: (call: Call) => void;
  onEditClick?: (call: Call) => void;
}

const DAYS_OF_WEEK = DAY_NAMES;
const MAX_EVENTS_PER_CELL = 4;

function formatDayLabel(date: Date): string {
  return `${DAY_NAMES[date.getDay()]} ${date.getDate()}`;
}

function buildCalendarWeeks(year: number, month: number): (Date | null)[][] {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const days: (Date | null)[] = [];

  for (let i = 0; i < firstDay.getDay(); i++) days.push(null);
  for (let d = 1; d <= lastDay.getDate(); d++) days.push(new Date(year, month, d));
  while (days.length % 7 !== 0) days.push(null);

  const weeks: (Date | null)[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return weeks;
}

const CalendarMonthView = ({
  calls,
  currentMonth,
  currentUserId,
  onCallClick,
  onGotoMessage,
  onDownloadTranscript,
  onEditClick,
}: CalendarMonthViewProps): ReactElement => {
  const today = new Date();
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const weeks = buildCalendarWeeks(year, month);

  const [openCallId, setOpenCallId] = useState<string | null>(null);
  const [openOverflowDay, setOpenOverflowDay] = useState<string | null>(null);
  const [openOverflowCallId, setOpenOverflowCallId] = useState<string | null>(null);

  // Group calls by day-of-month for the current month
  const callsByDay = new Map<number, Call[]>();
  calls.forEach(call => {
    if (!call.startsAt) return;
    const d = new Date(call.startsAt);
    if (d.getFullYear() !== year || d.getMonth() !== month) return;
    const day = d.getDate();
    if (!callsByDay.has(day)) callsByDay.set(day, []);
    callsByDay.get(day)!.push(call);
  });

  callsByDay.forEach(dayCalls => {
    dayCalls.sort(
      (a, b) => new Date(a.startsAt ?? 0).getTime() - new Date(b.startsAt ?? 0).getTime(),
    );
  });

  return (
    <div className='w-full border border-border rounded-xl overflow-hidden'>
      {/* Day-of-week header */}
      <div className='grid grid-cols-7 bg-muted/20 border-b border-border shrink-0'>
        {DAYS_OF_WEEK.map(day => (
          <div
            key={day}
            className='py-2.5 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider border-r last:border-r-0 border-border'
          >
            {day}
          </div>
        ))}
      </div>

      {/* Weeks */}
      <div className='overflow-y-auto' style={{ maxHeight: 'calc(100dvh - 278px)' }}>
        {weeks.map((week, wi) => (
          <div key={wi} className='grid grid-cols-7 border-b last:border-b-0 border-border'>
            {week.map((day, di) => {
              const isToday = day ? isSameDay(day, today) : false;
              const dayCalls = day ? (callsByDay.get(day.getDate()) ?? []) : [];
              const visible = dayCalls.slice(0, MAX_EVENTS_PER_CELL);
              const overflow = dayCalls.length - visible.length;
              const dayKey = day ? `${year}-${month}-${day.getDate()}` : null;

              return (
                <div
                  key={di}
                  className={cn(
                    'border-r last:border-r-0 border-border p-1.5 min-h-[120px] flex flex-col',
                    !day && 'bg-muted/10',
                  )}
                >
                  {day && (
                    <>
                      {/* Events */}
                      <div className='flex flex-col gap-0.5 flex-1'>
                        {visible.map(call => {
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
                                  className={cn(
                                    'relative flex items-center gap-1 text-left w-full px-1 py-0.5 rounded transition-colors cursor-pointer focus:outline-none',
                                    meetingStatus === MeetingStatus.ACCEPTED && 'bg-primary/10',
                                  )}
                                >
                                  {isMaybe && !isEnded && (
                                    <div className='pointer-events-none absolute inset-0 overflow-hidden'>
                                      <div className='absolute inset-0 call-stripe-pattern' />
                                    </div>
                                  )}
                                  <div className='w-0.5 h-3.5 rounded-full shrink-0 bg-primary' />
                                  <span
                                    className='truncate flex-1 min-w-0 leading-tight text-foreground'
                                    style={{
                                      fontSize: '12px',
                                      lineHeight: '18px',
                                      fontWeight: 500,
                                      textDecorationLine: isDeclined ? 'line-through' : 'none',
                                    }}
                                  >
                                    {call.title ?? 'Call'}
                                  </span>
                                  {call.startsAt && (
                                    <span
                                      className='shrink-0 tabular-nums ml-1 text-muted-foreground'
                                      style={{
                                        fontSize: '10px',
                                        lineHeight: '14px',
                                        opacity: 0.7,
                                        textDecorationLine: isDeclined ? 'line-through' : 'none',
                                      }}
                                    >
                                      {formatTime(call.startsAt)}
                                    </span>
                                  )}
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

                        {overflow > 0 && dayKey && day && (
                          <PopoverPrimitive.Root
                            open={openOverflowDay === dayKey}
                            onOpenChange={open => {
                              setOpenOverflowDay(open ? dayKey : null);
                              if (!open) setOpenOverflowCallId(null);
                            }}
                          >
                            <PopoverPrimitive.Trigger asChild>
                              <button className='text-[11px] font-medium px-1 cursor-pointer hover:underline text-left focus:outline-none text-action-primary'>
                                +{overflow} more
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
                                {/* Header */}
                                <div className='flex items-center justify-between px-4 pt-4 pb-3'>
                                  <div className='flex items-center gap-2'>
                                    <span className='text-sm font-semibold text-foreground'>
                                      {formatDayLabel(day)}
                                    </span>
                                    <span className='text-xs text-muted-foreground'>
                                      · {dayCalls.length} Calls
                                    </span>
                                  </div>
                                  <button
                                    onClick={() => {
                                      setOpenOverflowDay(null);
                                      setOpenOverflowCallId(null);
                                    }}
                                    data-track-category='Calls'
                                    data-track-name='calendar-overflow-close'
                                    className='text-muted-foreground hover:text-foreground transition-colors p-0.5 cursor-pointer'
                                  >
                                    <X className='size-4' />
                                  </button>
                                </div>

                                {/* Call list */}
                                <div className='flex flex-col pb-3'>
                                  {dayCalls.map(call => {
                                    const meetingStatus = getCurrentUserMeetingStatus(
                                      call,
                                      currentUserId,
                                    );
                                    const isDeclined = meetingStatus === MeetingStatus.DECLINED;
                                    const isMaybe = meetingStatus === MeetingStatus.MAYBE;

                                    return (
                                      <PopoverPrimitive.Root
                                        key={call.id}
                                        open={openOverflowCallId === call.id}
                                        onOpenChange={open =>
                                          setOpenOverflowCallId(open ? call.id : null)
                                        }
                                      >
                                        <PopoverPrimitive.Trigger asChild>
                                          <button className='relative flex items-center gap-2 w-full px-4 py-2 hover:bg-muted/50 transition-colors text-left focus:outline-none'>
                                            {isMaybe && call.status !== CallStatus.ENDED && (
                                              <div className='pointer-events-none absolute inset-0 overflow-hidden'>
                                                <div className='absolute inset-0 call-stripe-pattern' />
                                              </div>
                                            )}
                                            <div className='w-0.5 h-4 rounded-full shrink-0 bg-primary' />
                                            <span
                                              className='flex-1 min-w-0 truncate text-sm font-medium text-foreground'
                                              style={{
                                                textDecorationLine: isDeclined
                                                  ? 'line-through'
                                                  : 'none',
                                              }}
                                            >
                                              {call.title ?? 'Call'}
                                            </span>
                                            {call.startsAt && (
                                              <span
                                                className='shrink-0 text-xs text-muted-foreground tabular-nums'
                                                style={{
                                                  textDecorationLine: isDeclined
                                                    ? 'line-through'
                                                    : 'none',
                                                }}
                                              >
                                                {formatTime(call.startsAt)}
                                              </span>
                                            )}
                                          </button>
                                        </PopoverPrimitive.Trigger>
                                        <PopoverPrimitive.Portal>
                                          <PopoverPrimitive.Content
                                            side='right'
                                            sideOffset={8}
                                            avoidCollisions
                                            collisionPadding={16}
                                            onOpenAutoFocus={e => e.preventDefault()}
                                            className={POPOVER_CONTENT_CLASS}
                                          >
                                            <CalendarCallPopup
                                              call={call}
                                              currentUserId={currentUserId}
                                              onClose={() => setOpenOverflowCallId(null)}
                                              onJoinCall={() => {
                                                setOpenOverflowCallId(null);
                                                setOpenOverflowDay(null);
                                                onCallClick(call);
                                              }}
                                              onGotoMessage={() => {
                                                setOpenOverflowCallId(null);
                                                setOpenOverflowDay(null);
                                                onGotoMessage(call);
                                              }}
                                              onDownloadTranscript={() => {
                                                setOpenOverflowCallId(null);
                                                setOpenOverflowDay(null);
                                                onDownloadTranscript(call);
                                              }}
                                              onEditClick={
                                                onEditClick
                                                  ? () => {
                                                      setOpenOverflowCallId(null);
                                                      setOpenOverflowDay(null);
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
                              </PopoverPrimitive.Content>
                            </PopoverPrimitive.Portal>
                          </PopoverPrimitive.Root>
                        )}
                      </div>

                      {/* Date number */}
                      <div className='flex justify-end mt-1'>
                        <span
                          className={cn(
                            'text-xs w-6 h-6 flex items-center justify-center font-medium',
                            isToday
                              ? 'bg-action-primary text-action-primary-foreground rounded'
                              : 'text-muted-foreground',
                          )}
                        >
                          {day.getDate()}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
};

export default CalendarMonthView;
