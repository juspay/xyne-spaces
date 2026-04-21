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
} from './CalenderViewUtils';
import { CalendarTimeSlotCell } from './CalendarTimeSlotCell';

interface CalendarDayViewProps {
  calls: Call[];
  currentDay: Date;
  currentUserId?: string | undefined;
  onCallClick: (call: Call) => void;
  onGotoMessage: (call: Call) => void;
  onDownloadTranscript: (call: Call) => void;
  onEditClick?: (call: Call) => void;
  onCreateCallAtSlot?: (startsAt: Date, endsAt: Date) => void;
}

const TIME_GUTTER_WIDTH = 90;

// ── Per-call card: drag handle IS the popover trigger button ─────────────────

interface DayViewCallCardProps {
  call: Call;
  draggable: boolean;
  top: number;
  height: number;
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

function DayViewCallCard({
  call,
  draggable,
  top,
  height,
  isBeingResized,
  currentUserId,
  openCallId,
  setOpenCallId,
  onCallClick,
  onGotoMessage,
  onDownloadTranscript,
  onEditClick,
  onResizePointerDown,
}: DayViewCallCardProps): ReactElement {
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
        <button
          ref={setNodeRef}
          {...attributes}
          {...(draggable ? listeners : {})}
          onClick={e => e.stopPropagation()}
          title={call.title ?? 'Call'}
          data-track-category='Calls'
          data-track-name='calendar-day-call-card'
          className='group absolute left-2 right-2 rounded overflow-hidden text-left border-l-[3px] z-[5] focus:outline-none'
          style={{
            top,
            height,
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
          <div className='px-2 py-1.5 h-full flex flex-col justify-start overflow-hidden'>
            <span
              className='leading-tight truncate'
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
                className='leading-tight mt-0.5 whitespace-nowrap'
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

function DroppableDayColumn({
  date,
  children,
  isPopoverOpen,
  onCreateCallAtSlot,
  onDragCreatePointerDown,
  consumeDragEnd,
}: {
  date: Date;
  children: ReactNode;
  isPopoverOpen: boolean;
  onCreateCallAtSlot: ((startsAt: Date, endsAt: Date) => void) | undefined;
  onDragCreatePointerDown:
    | ((e: React.PointerEvent<HTMLDivElement>, date: Date) => void)
    | undefined;
  consumeDragEnd: (() => boolean) | undefined;
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
  onCallClick,
  onGotoMessage,
  onDownloadTranscript,
  onEditClick,
  onCreateCallAtSlot,
}: CalendarDayViewProps): ReactElement => {
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

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <div className='w-full flex flex-col border border-border rounded-xl overflow-hidden'>
        {/* Single day header */}
        <div className='flex shrink-0 border-b border-border bg-background'>
          <div style={{ width: TIME_GUTTER_WIDTH }} className='shrink-0 border-r border-border' />
          <div
            className={cn(
              'flex-1 py-2.5 px-3 text-sm font-medium',
              isDisplayingToday ? 'text-primary bg-primary/5' : 'text-muted-foreground',
            )}
          >
            {DAY_NAMES[currentDay.getDay()]} {currentDay.getDate()}
          </div>
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

            {/* Day column */}
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
                const draggable = isCallDraggable(call, currentUserId);

                return (
                  <DayViewCallCard
                    key={call.id}
                    call={call}
                    draggable={draggable}
                    top={top}
                    height={height}
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
