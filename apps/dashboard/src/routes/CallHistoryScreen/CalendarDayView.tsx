import { ReactElement, ReactNode, useEffect, useRef, useState } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Call, isGoogleCalendarCall, isMicrosoftCalendarCall } from './callHistoryItem.utils';
import { GoogleCalendarIcon, MicrosoftIcon } from './CalendarIcons';
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  type DragStartEvent,
} from '@dnd-kit/core';
import { CallStatus, MeetingStatus } from '@xyne/shared';
import { cn } from '../../utils/classNames';
import CalendarCallPopup from './CalendarCallPopup';
import DragOverlayCard from './DragOverlayCard';
import RecurringRescheduleDialog from './RecurringRescheduleDialog';
import { useDragReschedule, type DragPreview } from './useDragReschedule';
import { useResizeEndTime, type ResizePreview } from './useResizeEndTime';
import { useDragCreate } from './useDragCreate';
import { CalendarEventGhost } from './CalendarEventGhost';
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
  dayKey,
  isCallDraggable,
  computeEventPositions,
  buildDayEventPool,
} from './CalenderViewUtils';
import { CalendarTimeSlotCell } from './CalendarTimeSlotCell';
import type { OtherUserCalls } from '../../hooks/useOtherUserCalls';
import Avatar from '../../components/ui/Avatar/Avatar';
import { getUserDisplayName } from '../../utils/userDisplayName';
import { OtherUserEventBlock } from './OtherUserEventBlock';

interface CalendarDayViewProps {
  calls: Call[];
  currentDay: Date;
  currentUserId?: string | undefined;
  currentUser?: {
    id?: string;
    name?: string | null;
    email?: string | null;
    displayName?: string | null;
  } | null;
  onCallClick: (call: Call) => void;
  onGotoMessage: (call: Call) => void;
  onDownloadTranscript: (call: Call) => void;
  onEditClick?: (call: Call) => void;
  onDeleteClick?: (call: Call) => void;
  onHideClick?: (call: Call, options?: { isSeries?: boolean }) => void;
  onCreateCallAtSlot?: (startsAt: Date, endsAt: Date) => void;
  otherUsersCalls?: OtherUserCalls[];
  initialOpenCallId?: string | null;
}

// ── Per-call card: drag handle IS the popover trigger button ─────────────────

interface DayViewCallCardProps {
  call: Call;
  draggable: boolean;
  top: number;
  height: number;
  leftPct: number;
  widthPct: number;
  isBeingResized: boolean;
  currentUserId: string | undefined;
  openCallId: string | null;
  setOpenCallId: (id: string | null) => void;
  onCallClick: (call: Call) => void;
  onGotoMessage: (call: Call) => void;
  onDownloadTranscript: (call: Call) => void;
  onEditClick?: (call: Call) => void;
  onDeleteClick?: (call: Call) => void;
  onHideClick?: (call: Call, options?: { isSeries?: boolean }) => void;
  onResizePointerDown: (e: React.PointerEvent, call: Call) => void;
}

function DayViewCallCard({
  call,
  draggable,
  top,
  height,
  leftPct,
  widthPct,
  isBeingResized,
  currentUserId,
  openCallId,
  setOpenCallId,
  onCallClick,
  onGotoMessage,
  onDownloadTranscript,
  onEditClick,
  onDeleteClick,
  onHideClick,
  onResizePointerDown,
}: DayViewCallCardProps): ReactElement {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: call.id,
    disabled: !draggable,
  });

  const isEnded = call.status === CallStatus.ENDED;
  const meetingStatus = getCurrentUserMeetingStatus(call, currentUserId);
  const isDeclined =
    meetingStatus === MeetingStatus.DECLINED || meetingStatus === MeetingStatus.HIDDEN;
  const isMaybe = meetingStatus === MeetingStatus.MAYBE;

  return (
    <PopoverPrimitive.Root
      open={openCallId === call.id}
      onOpenChange={open => setOpenCallId(open ? call.id : null)}
    >
      <PopoverPrimitive.Trigger asChild>
        <button
          ref={setNodeRef}
          {...attributes}
          {...(draggable ? listeners : {})}
          onClick={e => e.stopPropagation()}
          title={call.title ?? 'Call'}
          data-track-category='CALLS'
          data-track-name='calendar-day-call-card'
          className='group absolute left-2 right-2 rounded overflow-hidden text-left z-[5] focus:outline-none'
          style={{
            top,
            height,
            left: `calc(${leftPct}% + 2px)`,
            width: `calc(${widthPct}% - 4px)`,
            backgroundColor: meetingStatus === MeetingStatus.ACCEPTED ? '#0077FF1A' : 'transparent',
            opacity: isDragging || isBeingResized ? 0.3 : 1,
            cursor: draggable ? 'grab' : 'pointer',
            userSelect: 'none',
            touchAction: 'none',
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
          <div className='px-1 py-1.5 h-full flex flex-row gap-1 justify-start overflow-hidden'>
            <div className='w-0.5 rounded-full shrink-0 bg-primary self-stretch max-sm:hidden' />
            <div className='flex flex-col flex-1 overflow-hidden'>
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
          </div>
          {draggable && (
            <div
              role='none'
              className='absolute bottom-0 left-0 right-0 h-2 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity'
              style={{ cursor: 'ns-resize', touchAction: 'none' }}
              onPointerDown={e => onResizePointerDown(e, call)}
              onClick={e => e.stopPropagation()}
              onKeyDown={e => e.stopPropagation()}
              data-track-category='CALLS'
              data-track-name='calendar-resize-handle'
            >
              <div className='w-6 h-0.5 rounded-full bg-blue-500' />
            </div>
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
}

// ── Droppable day column ──────────────────────────────────────────────────────

function DroppableDayColumn({
  date,
  children,
  isPopoverOpen,
  onCreateCallAtSlot,
  onDragCreatePointerDown,
  consumeDragEnd,
  className,
}: {
  date: Date;
  children: ReactNode;
  isPopoverOpen: boolean;
  onCreateCallAtSlot: ((startsAt: Date, endsAt: Date) => void) | undefined;
  onDragCreatePointerDown:
    | ((e: React.PointerEvent<HTMLDivElement>, date: Date) => void)
    | undefined;
  consumeDragEnd: (() => boolean) | undefined;
  className?: string;
}): ReactElement {
  const { setNodeRef } = useDroppable({ id: dayKey(date) });

  return (
    <CalendarTimeSlotCell
      setNodeRef={setNodeRef}
      date={date}
      isPopoverOpen={isPopoverOpen}
      onCreateCallAtSlot={onCreateCallAtSlot}
      onDragCreatePointerDown={onDragCreatePointerDown}
      consumeDragEnd={consumeDragEnd}
      trackName='calendar-day-slot-create'
      {...(className !== undefined ? { className } : {})}
    >
      {children}
    </CalendarTimeSlotCell>
  );
}

// ── Drop-zone ghost (move drag) ───────────────────────────────────────────────

function DropGhost({
  dragPreview,
  durationMins,
}: {
  dragPreview: DragPreview;
  durationMins: number;
}): ReactElement {
  return (
    <CalendarEventGhost
      top={topPxForMinutes(dragPreview.newStartMins)}
      height={Math.max(MIN_EVENT_HEIGHT, topPxForMinutes(durationMins))}
      formattedTime={dragPreview.formattedTime}
    />
  );
}

// ── Resize ghost (end-time drag) ──────────────────────────────────────────────

function ResizeGhost({ resizePreview }: { resizePreview: ResizePreview }): ReactElement {
  return (
    <CalendarEventGhost
      top={topPxForMinutes(resizePreview.startMins)}
      height={Math.max(
        MIN_EVENT_HEIGHT,
        topPxForMinutes(resizePreview.newEndMins - resizePreview.startMins),
      )}
      formattedTime={resizePreview.formattedTime}
    />
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const CalendarDayView = ({
  calls,
  currentDay,
  currentUserId,
  currentUser,
  onCallClick,
  onGotoMessage,
  onDownloadTranscript,
  onEditClick,
  onDeleteClick,
  onHideClick,
  onCreateCallAtSlot,
  otherUsersCalls = [],
  initialOpenCallId,
}: CalendarDayViewProps): ReactElement => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => new Date());
  const [openCallId, setOpenCallId] = useState<string | null>(initialOpenCallId ?? null);

  const {
    sensors,
    dragPreview,
    activeCall,
    onDragStart,
    onDragMove,
    onDragEnd,
    onDragCancel,
    recurringDialogOpen,
    confirmReschedule,
    cancelReschedule,
    singleDialogOpen,
    confirmSingleReschedule,
    cancelSingleReschedule,
  } = useDragReschedule(calls);

  const {
    resizePreview,
    activeResizeCallId,
    onResizePointerDown,
    recurringResizeDialogOpen,
    confirmResize,
    cancelResize,
    singleResizeDialogOpen,
    confirmSingleResize,
    cancelSingleResize,
  } = useResizeEndTime(scrollRef);

  const { dragCreatePreview, onDragCreatePointerDown, consumeDragEnd } = useDragCreate(
    scrollRef,
    onCreateCallAtSlot,
  );

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!scrollRef.current) return;
    const today = new Date();
    const targetMinutes = isSameDay(currentDay, today) ? minutesSinceMidnight(today) - 60 : 8 * 60;
    scrollRef.current.scrollTop = Math.max(0, topPxForMinutes(targetMinutes));
  }, [currentDay]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDragStart = (event: DragStartEvent): void => {
    setOpenCallId(null);
    onDragStart(event);
  };

  const today = new Date();
  const isDisplayingToday = isSameDay(currentDay, today);
  const currentTimePx = topPxForMinutes(minutesSinceMidnight(now));
  const isMultiPerson = otherUsersCalls.length > 0;

  const dayCalls = calls
    .filter(call => call.startsAt && isSameDay(new Date(call.startsAt), currentDay))
    .sort((a, b) => new Date(a.startsAt ?? 0).getTime() - new Date(b.startsAt ?? 0).getTime());

  const activeDurationMins =
    activeCall?.startsAt && activeCall?.endsAt
      ? Math.max(
          15,
          minutesSinceMidnight(new Date(activeCall.endsAt)) -
            minutesSinceMidnight(new Date(activeCall.startsAt)),
        )
      : 60;

  const currentUserDisplayName = getUserDisplayName(currentUser);
  const currentUserFirstName =
    currentUserDisplayName !== 'Unknown' ? (currentUserDisplayName.split(' ')[0] ?? 'You') : 'You';

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <div className='w-full h-full flex flex-col border border-border rounded-xl overflow-hidden'>
        {/* Day header */}
        <div className='flex shrink-0 border-b border-border bg-background'>
          {!isMultiPerson ? (
            /* Single-person: simple date label */
            <>
              <div className='w-[50px] sm:w-[90px] shrink-0 border-r border-border' />
              <div
                className={cn(
                  'flex-1 py-2.5 px-3 text-sm font-medium',
                  isDisplayingToday ? 'text-primary bg-primary/5' : 'text-muted-foreground',
                )}
              >
                {DAY_NAMES[currentDay.getDay()]} {currentDay.getDate()}
              </div>
            </>
          ) : (
            /* Multi-person: date in gutter, per-person column headers */
            <>
              <div className='w-[50px] sm:w-[90px] shrink-0 border-r border-border flex flex-col items-center justify-center py-2 gap-0.5'>
                <span className='text-[11px] uppercase text-muted-foreground leading-none tracking-wide'>
                  {(DAY_NAMES[currentDay.getDay()] ?? '').slice(0, 3)}
                </span>
                <span
                  className={cn(
                    'text-2xl font-light leading-none',
                    isDisplayingToday ? 'text-primary' : 'text-muted-foreground',
                  )}
                >
                  {currentDay.getDate()}
                </span>
              </div>
              <div className='flex flex-1'>
                {/* Own column header */}
                <div className='flex-1 flex flex-col items-center justify-center py-2 gap-1 border-r border-border'>
                  <Avatar
                    userId={currentUserId ?? null}
                    size='sm'
                    showActiveStatus={false}
                    rounded
                  />
                  <span className='text-xs font-medium text-foreground truncate max-w-full px-1'>
                    {currentUserFirstName}
                  </span>
                </div>
                {/* Other user column headers */}
                {otherUsersCalls.map(({ user }) => (
                  <div
                    key={user.id}
                    className='flex-1 flex flex-col items-center justify-center py-2 gap-1 border-r last:border-r-0 border-border'
                  >
                    <Avatar userId={user.id} size='sm' showActiveStatus={false} rounded />
                    <span className='text-xs font-medium text-foreground truncate max-w-full px-1'>
                      {(() => {
                        const dn = getUserDisplayName(user);
                        return dn.split(' ')[0] ?? dn;
                      })()}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Scrollable time grid */}
        <div
          ref={scrollRef}
          className='overflow-y-auto'
          style={{ maxHeight: 'calc(100dvh - 290px)' }}
        >
          <div className='flex' style={{ height: HOUR_HEIGHT * 24 }}>
            {/* Time gutter */}
            <div className='w-[50px] sm:w-[90px] shrink-0 border-r border-border relative select-none'>
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
              {isDisplayingToday && (
                <div
                  className='absolute left-0 right-0 z-20 pointer-events-none hidden sm:flex items-center justify-center'
                  style={{ top: currentTimePx - 10, height: 20 }}
                >
                  <span className='text-[10px] font-semibold text-red-500 border border-red-400 dark:border-red-600 rounded-full px-2 py-0.5 bg-background leading-none whitespace-nowrap'>
                    {formatCurrentTime(now)}
                  </span>
                </div>
              )}
            </div>

            {!isMultiPerson ? (
              /* ── Single-person: one droppable column ── */
              <DroppableDayColumn
                date={currentDay}
                isPopoverOpen={openCallId !== null}
                onCreateCallAtSlot={onCreateCallAtSlot}
                onDragCreatePointerDown={onDragCreatePointerDown}
                consumeDragEnd={consumeDragEnd}
              >
                {/* Hour grid lines */}
                {HOURS.map(hour => (
                  <div
                    key={hour}
                    className='absolute left-0 right-0 border-t border-border/60'
                    style={{ top: hour * HOUR_HEIGHT }}
                  />
                ))}

                {isDisplayingToday && (
                  <div
                    className='absolute left-0 right-0 h-px bg-red-500 z-10 pointer-events-none'
                    style={{ top: currentTimePx }}
                  />
                )}

                {/* Move-drag ghost */}
                {dragPreview && (
                  <DropGhost dragPreview={dragPreview} durationMins={activeDurationMins} />
                )}

                {/* Resize ghost */}
                {resizePreview && <ResizeGhost resizePreview={resizePreview} />}

                {/* Drag-create ghost */}
                {dragCreatePreview && (
                  <CalendarEventGhost
                    top={topPxForMinutes(dragCreatePreview.startMins)}
                    height={Math.max(
                      MIN_EVENT_HEIGHT,
                      topPxForMinutes(dragCreatePreview.endMins - dragCreatePreview.startMins),
                    )}
                    formattedTime={dragCreatePreview.formattedTime}
                  />
                )}

                {/* All events — own calls + other users' slots — in one unified pool */}
                {(() => {
                  const { allEvents, otherSlotMap } = buildDayEventPool(
                    dayCalls,
                    otherUsersCalls,
                    slot => !!slot.startsAt && isSameDay(new Date(slot.startsAt), currentDay),
                  );
                  const positions = computeEventPositions(allEvents);

                  return allEvents.map(event => {
                    const pos = positions.get(event.id);
                    if (!pos) return null;
                    const { startMins, endMins, leftPct, widthPct } = pos;
                    const durationMins = Math.max(15, endMins - startMins);
                    const top = topPxForMinutes(startMins);
                    const height = Math.max(MIN_EVENT_HEIGHT, topPxForMinutes(durationMins));

                    const otherMeta = otherSlotMap.get(event.id);
                    if (otherMeta) {
                      return (
                        <OtherUserEventBlock
                          key={event.id}
                          top={top}
                          height={height}
                          leftPct={leftPct}
                          widthPct={widthPct}
                          color={otherMeta.color}
                          title={otherMeta.title}
                          startsAt={otherMeta.startsAt}
                          endsAt={otherMeta.endsAt}
                        />
                      );
                    }

                    const call = dayCalls.find(c => c.id === event.id);
                    if (!call) return null;
                    const draggable = isCallDraggable(call, currentUserId);
                    return (
                      <DayViewCallCard
                        key={call.id}
                        call={call}
                        draggable={draggable}
                        top={top}
                        height={height}
                        leftPct={leftPct}
                        widthPct={widthPct}
                        isBeingResized={activeResizeCallId === call.id}
                        currentUserId={currentUserId}
                        openCallId={openCallId}
                        setOpenCallId={setOpenCallId}
                        onCallClick={onCallClick}
                        onGotoMessage={onGotoMessage}
                        onDownloadTranscript={onDownloadTranscript}
                        {...(onEditClick ? { onEditClick } : {})}
                        {...(onDeleteClick ? { onDeleteClick } : {})}
                        {...(onHideClick ? { onHideClick } : {})}
                        onResizePointerDown={onResizePointerDown}
                      />
                    );
                  });
                })()}
              </DroppableDayColumn>
            ) : (
              /* ── Multi-person: one column per person ── */
              <div className='flex flex-1 relative'>
                {/* Hour grid lines spanning all columns */}
                {HOURS.map(hour => (
                  <div
                    key={hour}
                    className='absolute left-0 right-0 border-t border-border/60 pointer-events-none'
                    style={{ top: hour * HOUR_HEIGHT }}
                  />
                ))}

                {/* Current time line spanning all columns */}
                {isDisplayingToday && (
                  <div
                    className='absolute left-0 right-0 h-px bg-red-500 z-10 pointer-events-none'
                    style={{ top: currentTimePx }}
                  />
                )}

                {/* Own column — droppable, with overlap algorithm */}
                <DroppableDayColumn
                  date={currentDay}
                  className='border-r border-border'
                  isPopoverOpen={openCallId !== null}
                  onCreateCallAtSlot={onCreateCallAtSlot}
                  onDragCreatePointerDown={onDragCreatePointerDown}
                  consumeDragEnd={consumeDragEnd}
                >
                  {dragPreview && (
                    <DropGhost dragPreview={dragPreview} durationMins={activeDurationMins} />
                  )}
                  {resizePreview && <ResizeGhost resizePreview={resizePreview} />}
                  {(() => {
                    const positions = computeEventPositions(dayCalls);
                    return dayCalls.map(call => {
                      if (!call.startsAt) return null;
                      const pos = positions.get(call.id);
                      if (!pos) return null;
                      const { startMins, endMins, leftPct, widthPct } = pos;
                      const durationMins = Math.max(15, endMins - startMins);
                      const top = topPxForMinutes(startMins);
                      const height = Math.max(MIN_EVENT_HEIGHT, topPxForMinutes(durationMins));
                      const draggable = isCallDraggable(call, currentUserId);
                      return (
                        <DayViewCallCard
                          key={call.id}
                          call={call}
                          draggable={draggable}
                          top={top}
                          height={height}
                          leftPct={leftPct}
                          widthPct={widthPct}
                          isBeingResized={activeResizeCallId === call.id}
                          currentUserId={currentUserId}
                          openCallId={openCallId}
                          setOpenCallId={setOpenCallId}
                          onCallClick={onCallClick}
                          onGotoMessage={onGotoMessage}
                          onDownloadTranscript={onDownloadTranscript}
                          {...(onEditClick ? { onEditClick } : {})}
                          {...(onDeleteClick ? { onDeleteClick } : {})}
                          {...(onHideClick ? { onHideClick } : {})}
                          onResizePointerDown={onResizePointerDown}
                        />
                      );
                    });
                  })()}
                </DroppableDayColumn>

                {/* Other user columns — read-only, with overlap algorithm per column */}
                {otherUsersCalls.map(({ user, color, calls: userCalls }) => {
                  const daySlots = userCalls.filter(
                    slot => slot.startsAt && isSameDay(new Date(slot.startsAt), currentDay),
                  );
                  const slotEvents = daySlots.map(slot => ({
                    id: `other-${user.id}-${slot.id ?? slot.startsAt}`,
                    startsAt: slot.startsAt,
                    endsAt: slot.endsAt,
                    slot,
                  }));
                  const positions = computeEventPositions(slotEvents);
                  return (
                    <div
                      key={user.id}
                      className='flex-1 relative border-r last:border-r-0 border-border'
                    >
                      {slotEvents.map(({ id, slot }) => {
                        const pos = positions.get(id);
                        if (!pos) return null;
                        const { startMins, endMins, leftPct, widthPct } = pos;
                        const durationMins = Math.max(15, endMins - startMins);
                        const top = topPxForMinutes(startMins);
                        const height = Math.max(MIN_EVENT_HEIGHT, topPxForMinutes(durationMins));
                        return (
                          <OtherUserEventBlock
                            key={id}
                            top={top}
                            height={height}
                            leftPct={leftPct}
                            widthPct={widthPct}
                            color={color}
                            title={slot.title}
                            startsAt={slot.startsAt}
                            endsAt={slot.endsAt}
                            zClass='z-[5]'
                          />
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Floating clone that follows the cursor */}
      <DragOverlay dropAnimation={null}>
        {activeCall && dragPreview && (
          <DragOverlayCard
            call={activeCall}
            formattedTime={dragPreview.formattedTime}
            width={dragPreview.overlayWidth}
            height={dragPreview.overlayHeight}
          />
        )}
      </DragOverlay>

      <RecurringRescheduleDialog
        isOpen={recurringDialogOpen}
        onConfirm={confirmReschedule}
        onCancel={cancelReschedule}
      />
      <RecurringRescheduleDialog
        isOpen={recurringResizeDialogOpen}
        onConfirm={confirmResize}
        onCancel={cancelResize}
      />
      <RecurringRescheduleDialog
        isOpen={singleDialogOpen}
        onConfirm={confirmSingleReschedule}
        onCancel={cancelSingleReschedule}
        title='Reschedule this call?'
        description='This will update the call time for all participants.'
      />
      <RecurringRescheduleDialog
        isOpen={singleResizeDialogOpen}
        onConfirm={confirmSingleResize}
        onCancel={cancelSingleResize}
        title='Reschedule this call?'
        description='This will update the call time for all participants.'
      />
    </DndContext>
  );
};

export default CalendarDayView;
