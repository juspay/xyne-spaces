import { ReactElement, ReactNode, useEffect, useRef, useState } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Tooltip } from '../../components/ui/Tooltip/Tooltip';
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  type DragStartEvent,
} from '@dnd-kit/core';
import { CallStatus, MeetingStatus } from '@xyne/shared';
import { Call, isGoogleCalendarCall, isMicrosoftCalendarCall } from './callHistoryItem.utils';
import { GoogleCalendarIcon, MicrosoftIcon } from './CalendarIcons';
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
  getWeekStartForMonth,
  minutesSinceMidnight,
  topPxForMinutes,
  formatHourLabel,
  formatTime,
  formatCurrentTime,
  getCurrentUserMeetingStatus,
  dayKey,
  computeEventPositions,
  isCallDraggable,
  buildDayEventPool,
} from './CalenderViewUtils';
import { CalendarTimeSlotCell } from './CalendarTimeSlotCell';
import { usePlatform } from '../../hooks/usePlatform';
import type { OtherUserCalls } from '../../hooks/useOtherUserCalls';
import { OtherUserEventBlock } from './OtherUserEventBlock';

interface CalendarWeekViewProps {
  calls: Call[];
  currentWeekStart: Date;
  currentUserId?: string | undefined;
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

const TIME_GUTTER_WIDTH = 80;

// ── Per-call card: drag handle IS the popover trigger button ─────────────────
// Radix's Slot (asChild) composes refs, so setNodeRef + Radix's internal ref both work.

interface WeekViewCallCardProps {
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

function WeekViewCallCard({
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
}: WeekViewCallCardProps): ReactElement {
  const { isMobile } = usePlatform();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: call.id,
    disabled: !draggable,
  });

  const isEnded = call.status === CallStatus.ENDED;
  const meetingStatus = getCurrentUserMeetingStatus(call, currentUserId);
  const isDeclined = meetingStatus === MeetingStatus.DECLINED;
  const isMaybe = meetingStatus === MeetingStatus.MAYBE;

  return (
    <PopoverPrimitive.Root
      open={openCallId === call.id}
      onOpenChange={open => setOpenCallId(open ? call.id : null)}
    >
      <PopoverPrimitive.Trigger asChild>
        {/*
         * The button is both the popover trigger AND the @dnd-kit drag handle.
         * Radix's Slot (asChild) merges setNodeRef with its own internal ref.
         * With activationConstraint.distance=5, a plain click still opens the popover.
         */}
        <button
          ref={setNodeRef}
          {...attributes}
          {...(draggable ? listeners : {})}
          onClick={e => e.stopPropagation()}
          title={call.title ?? 'Call'}
          data-track-category='CALLS'
          data-track-name='calendar-week-call-card'
          className='group absolute right-1 rounded overflow-hidden text-left z-[5] focus:outline-none'
          style={{
            top,
            height,
            left: `calc(${leftPct}% + 1px)`,
            width: `calc(${widthPct}% - 2px)`,
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
          <div className='px-1 py-1 h-full flex flex-row gap-1 justify-start overflow-hidden'>
            <div className='w-0.5 rounded-full shrink-0 bg-primary self-stretch max-sm:hidden' />
            <div className='flex flex-col flex-1 overflow-hidden'>
              <span
                className='truncate text-foreground max-sm:whitespace-normal max-sm:overflow-visible max-sm:break-words'
                style={{
                  fontSize: isMobile ? '10px' : '12px',
                  lineHeight: isMobile ? '13px' : '18px',
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
              {height >= 40 && !isMobile && (
                <span
                  className='mt-0.5 whitespace-nowrap text-muted-foreground'
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

interface DroppableDayColumnProps {
  date: Date;
  isToday: boolean;
  children: ReactNode;
  isPopoverOpen: boolean;
  onCreateCallAtSlot: ((startsAt: Date, endsAt: Date) => void) | undefined;
  onDragCreatePointerDown:
    | ((e: React.PointerEvent<HTMLDivElement>, date: Date) => void)
    | undefined;
  consumeDragEnd: (() => boolean) | undefined;
}

function DroppableDayColumn({
  date,
  isToday,
  children,
  isPopoverOpen,
  onCreateCallAtSlot,
  onDragCreatePointerDown,
  consumeDragEnd,
}: DroppableDayColumnProps): ReactElement {
  const { setNodeRef, isOver } = useDroppable({ id: dayKey(date) });

  return (
    <CalendarTimeSlotCell
      setNodeRef={setNodeRef}
      date={date}
      isPopoverOpen={isPopoverOpen}
      onCreateCallAtSlot={onCreateCallAtSlot}
      onDragCreatePointerDown={onDragCreatePointerDown}
      consumeDragEnd={consumeDragEnd}
      trackName='calendar-week-slot-create'
      className={cn(
        'border-r last:border-r-0 border-border',
        isToday && 'bg-primary/[0.02]',
        isOver && 'bg-primary/[0.04]',
      )}
    >
      {children}
    </CalendarTimeSlotCell>
  );
}

// ── Drop-zone ghost (move drag) ───────────────────────────────────────────────

function DropGhost({
  dragPreview,
  columnDateKey,
  durationMins,
}: {
  dragPreview: DragPreview;
  columnDateKey: string;
  durationMins: number;
}): ReactElement | null {
  if (dragPreview.targetDateKey !== columnDateKey) return null;
  return (
    <CalendarEventGhost
      compact
      top={topPxForMinutes(dragPreview.newStartMins)}
      height={Math.max(MIN_EVENT_HEIGHT, topPxForMinutes(durationMins))}
      formattedTime={dragPreview.formattedTime}
    />
  );
}

// ── Resize ghost (end-time drag) ──────────────────────────────────────────────

function ResizeGhost({
  resizePreview,
  columnDateKey,
}: {
  resizePreview: ResizePreview;
  columnDateKey: string;
}): ReactElement | null {
  if (resizePreview.dateKey !== columnDateKey) return null;
  return (
    <CalendarEventGhost
      compact
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

const CalendarWeekView = ({
  calls,
  currentWeekStart,
  currentUserId,
  onCallClick,
  onGotoMessage,
  onDownloadTranscript,
  onEditClick,
  onDeleteClick,
  onHideClick,
  onCreateCallAtSlot,
  otherUsersCalls = [],
  initialOpenCallId,
}: CalendarWeekViewProps): ReactElement => {
  const { isMobile } = usePlatform();
  const timeGutterWidth = isMobile ? 48 : TIME_GUTTER_WIDTH;
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
    const targetMinutes = minutesSinceMidnight(now) - 60;
    scrollRef.current.scrollTop = Math.max(0, topPxForMinutes(targetMinutes));
  }, [currentWeekStart]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDragStart = (event: DragStartEvent): void => {
    setOpenCallId(null); // close any open popover before dragging
    onDragStart(event);
  };

  const today = new Date();
  const clampedWeekStart = getWeekStartForMonth(currentWeekStart);
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(clampedWeekStart);
    d.setDate(d.getDate() + i);
    return d;
  });

  const callsByDay = new Map<string, Call[]>();
  weekDays.forEach(d => callsByDay.set(dayKey(d), []));
  calls.forEach(call => {
    if (!call.startsAt) return;
    const k = dayKey(new Date(call.startsAt));
    if (callsByDay.has(k)) callsByDay.get(k)!.push(call);
  });

  const isCurrentWeek = weekDays.some(d => isSameDay(d, today));
  const currentTimePx = topPxForMinutes(minutesSinceMidnight(now));
  const todayColIndex = weekDays.findIndex(d => isSameDay(d, today));

  const activeDurationMins =
    activeCall?.startsAt && activeCall?.endsAt
      ? Math.max(
          15,
          minutesSinceMidnight(new Date(activeCall.endsAt)) -
            minutesSinceMidnight(new Date(activeCall.startsAt)),
        )
      : 60;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <div className='w-full h-full flex flex-col border border-border rounded-xl overflow-hidden'>
        {/* Day header row */}
        <div className='flex shrink-0 border-b border-border bg-background'>
          <div style={{ width: timeGutterWidth }} className='shrink-0 border-r border-border' />
          {weekDays.map((day, i) => {
            const isToday = isSameDay(day, today);
            return (
              <div
                key={i}
                className={cn(
                  'flex-1 py-2.5 text-center border-r last:border-r-0 border-border flex flex-col items-center justify-center',
                  isToday && 'bg-primary/5',
                )}
              >
                <span
                  className={cn(
                    'text-sm max-sm:text-xs font-medium leading-tight',
                    isToday ? 'text-primary' : 'text-muted-foreground',
                  )}
                >
                  {DAY_NAMES[day.getDay()]}
                </span>
                <span
                  className={cn(
                    'text-sm max-sm:text-xs font-medium leading-tight',
                    isToday ? 'text-primary' : 'text-muted-foreground',
                  )}
                >
                  {day.getDate()}
                </span>
              </div>
            );
          })}
        </div>

        {/* Scrollable time grid */}
        <div
          ref={scrollRef}
          className='overflow-y-auto'
          style={{ maxHeight: isMobile ? 'calc(100dvh - 320px)' : 'calc(100dvh - 290px)' }}
        >
          <div className='flex' style={{ height: HOUR_HEIGHT * 24 }}>
            {/* Time gutter */}
            <div
              style={{ width: timeGutterWidth }}
              className='shrink-0 border-r border-border relative select-none'
            >
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
              {isCurrentWeek && !isMobile && (
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
                  <div
                    className='absolute top-1/2 -translate-y-1/2 size-2 rounded-full bg-red-500'
                    style={{ left: '0px' }}
                  />
                  <div className='absolute h-px bg-red-500' style={{ left: '4px', right: 0 }} />
                </div>
              )}

              {/* Events per day */}
              <div className='absolute inset-0 flex'>
                {weekDays.map((day, i) => {
                  const dayCalls = callsByDay.get(dayKey(day)) ?? [];
                  const colDateKey = dayKey(day);
                  const isToday = isSameDay(day, today);

                  // Merge own calls + other users' slots into one pool so the
                  // cluster algorithm places them side-by-side when they overlap.
                  // Always use a per-user synthetic id so the same underlying call
                  // (shared between current user + selected user, or shared across
                  // multiple selected users) gets its own column in the algorithm.
                  const { allEvents, otherSlotMap } = buildDayEventPool(
                    dayCalls,
                    otherUsersCalls,
                    slot => !!slot.startsAt && dayKey(new Date(slot.startsAt)) === colDateKey,
                  );

                  const positions = computeEventPositions(allEvents);

                  return (
                    <DroppableDayColumn
                      key={i}
                      date={day}
                      isToday={isToday}
                      isPopoverOpen={openCallId !== null}
                      onCreateCallAtSlot={onCreateCallAtSlot}
                      onDragCreatePointerDown={onDragCreatePointerDown}
                      consumeDragEnd={consumeDragEnd}
                    >
                      {/* Move-drag ghost */}
                      {dragPreview && (
                        <DropGhost
                          dragPreview={dragPreview}
                          columnDateKey={colDateKey}
                          durationMins={activeDurationMins}
                        />
                      )}

                      {/* Resize ghost */}
                      {resizePreview && (
                        <ResizeGhost resizePreview={resizePreview} columnDateKey={colDateKey} />
                      )}

                      {/* Drag-create ghost */}
                      {dragCreatePreview?.dateKey === colDateKey && (
                        <CalendarEventGhost
                          compact
                          top={topPxForMinutes(dragCreatePreview.startMins)}
                          height={Math.max(
                            MIN_EVENT_HEIGHT,
                            topPxForMinutes(
                              dragCreatePreview.endMins - dragCreatePreview.startMins,
                            ),
                          )}
                          formattedTime={dragCreatePreview.formattedTime}
                        />
                      )}

                      {/* All events rendered together with unified overlap positions */}
                      {allEvents.map(event => {
                        const pos = positions.get(event.id);
                        if (!pos) return null;

                        const { startMins, endMins, leftPct, widthPct } = pos;
                        const durationMins = Math.max(15, endMins - startMins);
                        const top = topPxForMinutes(startMins);
                        const height = Math.max(MIN_EVENT_HEIGHT, topPxForMinutes(durationMins));

                        const otherMeta = otherSlotMap.get(event.id);
                        if (otherMeta) {
                          const { color, title, startsAt, endsAt } = otherMeta;
                          const timeLabel = endsAt
                            ? `${formatTime(startsAt)} – ${formatTime(endsAt)}`
                            : formatTime(startsAt);
                          return (
                            <Tooltip
                              key={event.id}
                              delayDuration={300}
                              side='top'
                              sideOffset={6}
                              avoidCollisions
                              collisionPadding={8}
                              content={
                                <div className='flex flex-col gap-0.5'>
                                  <span className='font-medium'>{title ?? 'Busy'}</span>
                                  <span className='opacity-75'>{timeLabel}</span>
                                </div>
                              }
                            >
                              <OtherUserEventBlock
                                top={top}
                                height={height}
                                leftPct={leftPct}
                                widthPct={widthPct}
                                color={color}
                                title={title}
                                startsAt={startsAt}
                                endsAt={endsAt}
                                gutterPx={1}
                                zClass='z-[3]'
                                interactive
                                onClick={e => e.stopPropagation()}
                                onPointerDown={e => e.stopPropagation()}
                              />
                            </Tooltip>
                          );
                        }

                        const call = dayCalls.find(c => c.id === event.id);
                        if (!call) return null;
                        const draggable = isCallDraggable(call, currentUserId);

                        return (
                          <WeekViewCallCard
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
                      })}
                    </DroppableDayColumn>
                  );
                })}
              </div>
            </div>
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

export default CalendarWeekView;
