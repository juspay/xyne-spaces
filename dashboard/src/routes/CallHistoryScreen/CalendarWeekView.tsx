import { ReactElement, ReactNode, useEffect, useRef, useState } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
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
import { CalendarEventGhost } from './CalendarEventGhost';
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
  isCallDraggable,
} from './CalenderViewUtils';

interface CalendarWeekViewProps {
  calls: Call[];
  currentWeekStart: Date;
  currentUserId?: string | undefined;
  onCallClick: (call: Call) => void;
  onGotoMessage: (call: Call) => void;
  onDownloadTranscript: (call: Call) => void;
  onEditClick?: (call: Call) => void;
}

const TIME_GUTTER_WIDTH = 80;

// ── Per-call card: drag handle IS the popover trigger button ─────────────────
// Radix's Slot (asChild) composes refs, so setNodeRef + Radix's internal ref both work.

interface WeekViewCallCardProps {
  call: Call;
  draggable: boolean;
  top: number;
  height: number;
  leftPx: number;
  isBeingResized: boolean;
  currentUserId: string | undefined;
  openCallId: string | null;
  setOpenCallId: (id: string | null) => void;
  onCallClick: (call: Call) => void;
  onGotoMessage: (call: Call) => void;
  onDownloadTranscript: (call: Call) => void;
  onEditClick?: (call: Call) => void;
  onResizePointerDown: (e: React.PointerEvent, call: Call) => void;
}

function WeekViewCallCard({
  call,
  draggable,
  top,
  height,
  leftPx,
  isBeingResized,
  currentUserId,
  openCallId,
  setOpenCallId,
  onCallClick,
  onGotoMessage,
  onDownloadTranscript,
  onEditClick,
  onResizePointerDown,
}: WeekViewCallCardProps): ReactElement {
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
          title={call.title ?? 'Call'}
          className='group absolute right-1 rounded overflow-hidden text-left border-l-[3px] z-[5] focus:outline-none'
          style={{
            top,
            height,
            left: `calc(0.25rem + ${leftPx}px)`,
            backgroundColor: meetingStatus === MeetingStatus.ACCEPTED ? '#0077FF1A' : 'transparent',
            borderLeftColor: '#0077FF',
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
          {draggable && (
            <div
              role='none'
              className='absolute bottom-0 left-0 right-0 h-2 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity'
              style={{ cursor: 'ns-resize', touchAction: 'none' }}
              onPointerDown={e => onResizePointerDown(e, call)}
              onClick={e => e.stopPropagation()}
              onKeyDown={e => e.stopPropagation()}
              data-track-category='Calls'
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
}

function DroppableDayColumn({ date, isToday, children }: DroppableDayColumnProps): ReactElement {
  const { setNodeRef, isOver } = useDroppable({ id: dayKey(date) });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex-1 relative border-r last:border-r-0 border-border',
        isToday && 'bg-primary/[0.02]',
        isOver && 'bg-primary/[0.04]',
      )}
    >
      {children}
    </div>
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
}: CalendarWeekViewProps): ReactElement => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => new Date());
  const [openCallId, setOpenCallId] = useState<string | null>(null);

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
      <div className='w-full flex flex-col border border-border rounded-xl overflow-hidden'>
        {/* Day header row */}
        <div className='flex shrink-0 border-b border-border bg-background'>
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

        {/* Scrollable time grid */}
        <div
          ref={scrollRef}
          className='overflow-y-auto'
          style={{ maxHeight: 'calc(100dvh - 290px)' }}
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
                  style={{ top: hour * HOUR_HEIGHT - 9 }}
                >
                  {hour > 0 && (
                    <span className='text-[11px] text-muted-foreground leading-none'>
                      {formatHourLabel(hour)}
                    </span>
                  )}
                </div>
              ))}
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
                  const overlapInfos = computeOverlapIndices(dayCalls);
                  const isToday = isSameDay(day, today);
                  const colDateKey = dayKey(day);

                  return (
                    <DroppableDayColumn key={i} date={day} isToday={isToday}>
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

                      {dayCalls.map((call, callIdx) => {
                        if (!call.startsAt) return null;
                        const overlapInfo = overlapInfos[callIdx];
                        if (!overlapInfo) return null;

                        const { startMins, endMins, overlapIndex } = overlapInfo;
                        const durationMins = Math.max(15, endMins - startMins);
                        const top = topPxForMinutes(startMins);
                        const height = Math.max(MIN_EVENT_HEIGHT, topPxForMinutes(durationMins));
                        const draggable = isCallDraggable(call, currentUserId);

                        return (
                          <WeekViewCallCard
                            key={call.id}
                            call={call}
                            draggable={draggable}
                            top={top}
                            height={height}
                            leftPx={overlapIndex * OVERLAP_LEFT_MARGIN}
                            isBeingResized={activeResizeCallId === call.id}
                            currentUserId={currentUserId}
                            openCallId={openCallId}
                            setOpenCallId={setOpenCallId}
                            onCallClick={onCallClick}
                            onGotoMessage={onGotoMessage}
                            onDownloadTranscript={onDownloadTranscript}
                            {...(onEditClick ? { onEditClick } : {})}
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
