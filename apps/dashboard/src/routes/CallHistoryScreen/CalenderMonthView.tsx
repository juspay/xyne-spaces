import { ReactElement, useState } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { X } from 'lucide-react';
import { CallStatus, MeetingStatus } from '@xyne/shared';
import { Call, isGoogleCalendarCall, isMicrosoftCalendarCall } from './callHistoryItem.utils';
import { GoogleCalendarIcon, MicrosoftIcon } from './CalendarIcons';
import { cn } from '../../utils/classNames';
import CalendarCallPopup from './CalendarCallPopup';
import {
  POPOVER_CONTENT_CLASS,
  DAY_NAMES,
  isSameDay,
  formatTime,
  getCurrentUserMeetingStatus,
} from './CalenderViewUtils';
import { usePlatform } from '../../hooks/usePlatform';
import type { OtherUserCalls } from '../../hooks/useOtherUserCalls';

function MonthOtherUserEventRow({
  color,
  title,
  startsAt,
  variant = 'cell',
}: {
  color: string;
  title: string | undefined;
  startsAt: number | undefined;
  variant?: 'cell' | 'overflow';
}) {
  if (variant === 'overflow') {
    return (
      <div className='flex items-center gap-2 w-full px-4 py-2'>
        <div className={`w-0.5 h-4 rounded-full shrink-0 bg-[${color}]`} />
        <span className='flex-1 min-w-0 truncate text-sm font-medium text-foreground'>
          {title ?? 'Busy'}
        </span>
        {startsAt && (
          <span className='shrink-0 text-xs text-muted-foreground tabular-nums'>
            {formatTime(startsAt)}
          </span>
        )}
      </div>
    );
  }
  return (
    <div className='flex items-center gap-1 text-left w-full px-1 py-0.5 rounded'>
      <div className={`w-0.5 h-3.5 rounded-full shrink-0 bg-[${color}]`} />
      <span className='truncate flex-1 min-w-0 leading-tight text-foreground text-[12px] font-medium'>
        {title ?? 'Busy'}
      </span>
      {startsAt && (
        <span className='shrink-0 tabular-nums ml-1 text-muted-foreground text-[10px] opacity-70'>
          {formatTime(startsAt)}
        </span>
      )}
    </div>
  );
}

interface CalendarMonthViewProps {
  calls: Call[];
  currentMonth: Date;
  currentUserId?: string | undefined;
  onCallClick: (call: Call) => void;
  onGotoMessage: (call: Call) => void;
  onDownloadTranscript: (call: Call) => void;
  onEditClick?: (call: Call) => void;
  onDeleteClick?: (call: Call) => void;
  onHideClick?: (call: Call, options?: { isSeries?: boolean }) => void;
  onCreateCall?: (date: Date) => void;
  otherUsersCalls?: OtherUserCalls[];
  initialOpenCallId?: string | null;
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
  onDeleteClick,
  onHideClick,
  onCreateCall,
  otherUsersCalls = [],
  initialOpenCallId,
}: CalendarMonthViewProps): ReactElement => {
  const { isMobile } = usePlatform();

  const today = new Date();
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const weeks = buildCalendarWeeks(year, month);

  const [openCallId, setOpenCallId] = useState<string | null>(initialOpenCallId ?? null);
  const [openOverflowDay, setOpenOverflowDay] = useState<string | null>(null);
  const [openOverflowCallId, setOpenOverflowCallId] = useState<string | null>(null);

  type OwnEvent = { kind: 'own'; call: Call; startsAt: number };
  type OtherEvent = {
    kind: 'other';
    slot: { startsAt: number; endsAt: number | null; title?: string };
    color: string;
    userName: string;
    startsAt: number;
  };
  type DayEvent = OwnEvent | OtherEvent;

  // Group own calls by day
  const callsByDay = new Map<number, Call[]>();
  calls.forEach(call => {
    if (!call.startsAt) return;
    const d = new Date(call.startsAt);
    if (d.getFullYear() !== year || d.getMonth() !== month) return;
    const day = d.getDate();
    if (!callsByDay.has(day)) callsByDay.set(day, []);
    callsByDay.get(day)!.push(call);
  });

  // Build merged sorted event list per day
  const eventsByDay = new Map<number, DayEvent[]>();
  for (let d = 1; d <= new Date(year, month + 1, 0).getDate(); d++) {
    const own: OwnEvent[] = (callsByDay.get(d) ?? []).map(call => ({
      kind: 'own',
      call,
      startsAt:
        typeof call.startsAt === 'number' ? call.startsAt : new Date(call.startsAt ?? 0).getTime(),
    }));
    const others: OtherEvent[] = [];
    otherUsersCalls.forEach(({ user, color, calls: uc }) => {
      uc.forEach(slot => {
        if (!slot.startsAt) return;
        const sd = new Date(slot.startsAt);
        if (sd.getFullYear() === year && sd.getMonth() === month && sd.getDate() === d) {
          others.push({
            kind: 'other',
            slot,
            color,
            userName: user.name ?? user.email ?? 'Someone',
            startsAt: slot.startsAt,
          });
        }
      });
    });
    const merged = [...own, ...others].sort((a, b) => a.startsAt - b.startsAt);
    eventsByDay.set(d, merged);
  }

  return (
    <div className='w-full  flex flex-col border border-border rounded-xl overflow-hidden'>
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
              const dayEvents = day ? (eventsByDay.get(day.getDate()) ?? []) : [];
              const visible = dayEvents.slice(0, MAX_EVENTS_PER_CELL);
              const overflow = dayEvents.length - visible.length;
              const dayKey = day ? `${year}-${month}-${day.getDate()}` : null;

              return (
                <div
                  key={di}
                  role={day && onCreateCall ? 'gridcell' : undefined}
                  tabIndex={day && onCreateCall ? 0 : undefined}
                  className={cn(
                    'border-r last:border-r-0 border-border p-1.5 max-sm:p-0.5 min-h-[120px] flex flex-col overflow-hidden',
                    !day && 'bg-muted/10',
                    day && onCreateCall && 'cursor-pointer',
                  )}
                  onClick={
                    day && onCreateCall
                      ? () => {
                          if (openCallId ?? openOverflowDay) return;
                          onCreateCall(day);
                        }
                      : undefined
                  }
                  onKeyDown={
                    day && onCreateCall
                      ? e => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            if (openCallId ?? openOverflowDay) return;
                            onCreateCall(day);
                          }
                        }
                      : undefined
                  }
                  data-track-category={day && onCreateCall ? 'Calls' : undefined}
                  data-track-name={day && onCreateCall ? 'calendar-month-cell-create' : undefined}
                >
                  {day && (
                    <>
                      {/* Events — own and other users' merged and sorted by time */}
                      <div className='flex flex-col gap-0.5 flex-1'>
                        {visible.map((event, ei) => {
                          if (event.kind === 'other') {
                            return (
                              <MonthOtherUserEventRow
                                key={`other-${event.startsAt}-${ei}`}
                                color={event.color}
                                title={event.slot.title}
                                startsAt={event.slot.startsAt}
                              />
                            );
                          }

                          const { call } = event;
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
                                  onClick={e => e.stopPropagation()}
                                  data-track-category='CALLS'
                                  data-track-name='calendar-month-call-pill'
                                  className='relative flex items-center max-sm:items-start gap-1 max-sm:gap-0.5 text-left w-full px-1 max-sm:px-0.5 py-0.5 max-sm:py-px rounded transition-colors cursor-pointer focus:outline-none'
                                  style={{
                                    backgroundColor:
                                      meetingStatus === MeetingStatus.ACCEPTED
                                        ? '#0077FF1A'
                                        : 'transparent',
                                  }}
                                >
                                  {isMaybe && !isEnded && (
                                    <div className='pointer-events-none absolute inset-0 overflow-hidden'>
                                      <div
                                        className='absolute inset-0'
                                        style={{
                                          backgroundImage:
                                            'repeating-linear-gradient(-18deg, rgba(0, 119, 255, 0.1) 0 2px, transparent 2px 4px)',
                                        }}
                                      />
                                    </div>
                                  )}
                                  <div className='w-0.5 h-3.5 rounded-full shrink-0 bg-primary max-sm:mt-0.5 max-sm:hidden' />
                                  <div className='flex min-w-0 flex-1 items-baseline max-sm:flex-col max-sm:items-stretch gap-1 max-sm:gap-0'>
                                    <span
                                      className='truncate min-w-0 leading-tight text-foreground max-sm:w-full'
                                      style={{
                                        fontSize: isMobile ? '8px' : '12px',
                                        lineHeight: '18px',
                                        fontWeight: 500,
                                        textDecorationLine: isDeclined ? 'line-through' : 'none',
                                      }}
                                    >
                                      {isGoogleCalendarCall(call) && (
                                        <span className='inline-block mr-0.5 mb-px'>
                                          <GoogleCalendarIcon size={isMobile ? 8 : 14} />
                                        </span>
                                      )}
                                      {isMicrosoftCalendarCall(call) && (
                                        <span className='inline-block mr-0.5 mb-px'>
                                          <MicrosoftIcon size={isMobile ? 8 : 14} />
                                        </span>
                                      )}
                                      {call.title ?? 'Call'}
                                    </span>
                                    {!isMobile && call.startsAt && (
                                      <span
                                        className='shrink-0 tabular-nums text-muted-foreground'
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
                                    onDeleteClick={
                                      onDeleteClick
                                        ? () => {
                                            setOpenCallId(null);
                                            onDeleteClick(call);
                                          }
                                        : undefined
                                    }
                                    onHideClick={
                                      onHideClick
                                        ? options => {
                                            setOpenCallId(null);
                                            onHideClick(call, options);
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
                              <button
                                onClick={e => e.stopPropagation()}
                                data-track-category='CALLS'
                                data-track-name='calendar-month-overflow'
                                className='text-[11px] max-sm:text-[10px] font-medium max-sm:font-normal px-1 cursor-pointer hover:underline text-left focus:outline-none'
                                style={{ color: '#6276BE' }}
                              >
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
                                      · {dayEvents.length} Events
                                    </span>
                                  </div>
                                  <button
                                    onClick={() => {
                                      setOpenOverflowDay(null);
                                      setOpenOverflowCallId(null);
                                    }}
                                    data-track-category='CALLS'
                                    data-track-name='calendar-overflow-close'
                                    className='text-muted-foreground hover:text-foreground transition-colors p-0.5 cursor-pointer'
                                  >
                                    <X className='size-4' />
                                  </button>
                                </div>

                                {/* Event list */}
                                <div className='flex flex-col pb-3'>
                                  {dayEvents.map((event, ei) => {
                                    if (event.kind === 'other') {
                                      return (
                                        <MonthOtherUserEventRow
                                          key={`overflow-other-${event.startsAt}-${ei}`}
                                          color={event.color}
                                          title={event.slot.title}
                                          startsAt={event.slot.startsAt}
                                          variant='overflow'
                                        />
                                      );
                                    }

                                    const { call } = event;
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
                                                <div
                                                  className='absolute inset-0'
                                                  style={{
                                                    backgroundImage:
                                                      'repeating-linear-gradient(-18deg, rgba(9, 46, 88, 0.55) 0 1px, transparent 1px 4px)',
                                                  }}
                                                />
                                              </div>
                                            )}
                                            <div className='w-0.5 h-4 rounded-full shrink-0 bg-[#0077FF]' />
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
                                                className='shrink-0 text-xs tabular-nums text-muted-foreground'
                                                style={{
                                                  opacity: 0.7,
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
                                            side={isMobile ? 'bottom' : 'right'}
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
                                              onDeleteClick={
                                                onDeleteClick
                                                  ? () => {
                                                      setOpenOverflowCallId(null);
                                                      setOpenOverflowDay(null);
                                                      onDeleteClick(call);
                                                    }
                                                  : undefined
                                              }
                                              onHideClick={
                                                onHideClick
                                                  ? options => {
                                                      setOpenOverflowCallId(null);
                                                      setOpenOverflowDay(null);
                                                      onHideClick(call, options);
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
