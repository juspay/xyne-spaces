import { ReactElement, ReactNode, useEffect, useRef, useState } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { format } from 'date-fns';
import { Tooltip } from '../../components/ui/Tooltip/Tooltip';
import { DndContext, useDraggable, useDroppable, type DragStartEvent } from '@dnd-kit/core';
import { MeetingStatus } from '@xyne/shared';
import { Call, isGoogleCalendarCall, isMicrosoftCalendarCall } from './callHistoryItem.utils';
import { GoogleCalendarIcon, MicrosoftIcon } from './CalendarIcons';
import { cn } from '../../utils/classNames';
import CalendarCallPopup from './CalendarCallPopup';
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
  getCallPillVariant,
  getCallPillVariantClasses,
  isCallJoinableNow,
  dayKey,
  computeEventPositions,
  isCallDraggable,
  buildDayEventPool,
  ALWAYS_VISIBLE_JOIN_MIN_WIDTH_PERCENTAGE,
  COMPACT_METADATA_MIN_WIDTH_PERCENTAGE,
  HATCH_BACKGROUND,
} from './CalenderViewUtils';
import { CalendarTimeSlotCell } from './CalendarTimeSlotCell';
import { usePlatform } from '../../hooks/usePlatform';
import type { OtherUserCalls } from '../../hooks/useOtherUserCalls';
import { OtherUserEventBlock } from './OtherUserEventBlock';
import {
  ChannelScopeIcon,
  type XyneCalendarCallPillVariant,
} from '../../components/Chat/XyneCalendarSidebar/XyneCalendarCallPill';
import type { XyneCalendarChannelPresentation } from '../../components/Chat/XyneCalendarSidebar/xyneCalendarSidebar.utils';

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
  /** Channel label/type per channelId, e.g. from XyneCalendarSidebar — omit to hide channel chips. */
  channelPresentationsById?: Map<string, XyneCalendarChannelPresentation>;
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
  variant: XyneCalendarCallPillVariant;
  joinable: boolean;
  channel?: XyneCalendarChannelPresentation;
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
  variant,
  joinable,
  channel,
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
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: call.id,
    disabled: !draggable,
  });

  const meetingStatus = getCurrentUserMeetingStatus(call, currentUserId);
  const isDeclined = variant === 'declined';
  const isMaybe = meetingStatus === MeetingStatus.MAYBE;
  const compact = height < 40;
  const showCompactMetadata = widthPct >= COMPACT_METADATA_MIN_WIDTH_PERCENTAGE;
  const showJoinByDefault = widthPct >= ALWAYS_VISIBLE_JOIN_MIN_WIDTH_PERCENTAGE;
  const showSecondaryInformation = !compact || showCompactMetadata;
  const timeRange = `${formatTime(call.startsAt)}${call.endsAt ? ` – ${formatTime(call.endsAt)}` : ''}`;
  const secondaryTextClass =
    variant === 'highlighted' ? 'text-primary-foreground/90' : 'text-muted-foreground';

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
          className={cn(
            'group absolute right-1 overflow-hidden rounded-lg border text-left z-[5] transition-colors focus:outline-none',
            getCallPillVariantClasses(variant),
          )}
          style={{
            top,
            height,
            left: `calc(${leftPct}% + 1px)`,
            width: `calc(${widthPct}% - 2px)`,
            opacity: isDragging || isBeingResized ? 0.3 : 1,
            cursor: draggable ? 'grab' : 'pointer',
            userSelect: 'none',
            touchAction: 'none',
          }}
        >
          {isMaybe && variant !== 'past' && (
            <div className='pointer-events-none absolute inset-0 overflow-hidden'>
              <div className='absolute inset-0' style={{ backgroundImage: HATCH_BACKGROUND }} />
            </div>
          )}
          <div
            className={cn(
              'px-1.5 py-1 h-full flex flex-row gap-1.5 justify-start overflow-hidden',
              isBeingResized && 'invisible',
            )}
          >
            <div className='flex flex-col flex-1 overflow-hidden'>
              <span className='flex min-w-0 items-center gap-1'>
                {joinable && (
                  <span className='flex shrink-0 items-center gap-1' aria-hidden='true'>
                    <span
                      className={cn(
                        'block size-1.5 flex-none rounded-full motion-safe:animate-pulse',
                        variant === 'highlighted' ? 'bg-primary-foreground' : 'bg-status-success',
                      )}
                    />
                    {showJoinByDefault && !compact && (
                      <span
                        className={cn(
                          'text-[10px] font-semibold leading-none',
                          variant === 'highlighted' ? 'text-primary-foreground/90' : 'text-primary',
                        )}
                      >
                        Live
                      </span>
                    )}
                  </span>
                )}
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate text-xs font-semibold leading-tight max-sm:whitespace-normal max-sm:overflow-visible max-sm:break-words',
                    isDeclined && 'line-through',
                  )}
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
              </span>
              {showSecondaryInformation && (
                <span className='mt-0.5 flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap'>
                  <span
                    className={cn('shrink-0 text-xs font-normal leading-tight', secondaryTextClass)}
                  >
                    {timeRange}
                  </span>
                  {channel && (
                    <span
                      className={cn(
                        'flex min-w-0 shrink items-center gap-1 text-xs font-normal leading-tight',
                        secondaryTextClass,
                      )}
                    >
                      <ChannelScopeIcon channel={channel} />
                      <span className='truncate'>{channel.label}</span>
                    </span>
                  )}
                </span>
              )}
            </div>
          </div>
          {draggable && (
            <div
              role='none'
              className='absolute bottom-0.5 left-0 right-0 h-3 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity'
              style={{ cursor: 'ns-resize', touchAction: 'none' }}
              onPointerDown={e => onResizePointerDown(e, call)}
              onClick={e => e.stopPropagation()}
              onKeyDown={e => e.stopPropagation()}
              data-track-category='CALLS'
              data-track-name='calendar-resize-handle'
            >
              <div className='w-12 h-1 rounded-full bg-primary-foreground' />
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
  isWeekend: boolean;
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
  isWeekend,
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
        isWeekend && !isToday && 'bg-muted/50',
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
}: {
  dragPreview: DragPreview;
  columnDateKey: string;
}): ReactElement | null {
  if (dragPreview.targetDateKey !== columnDateKey) return null;
  return (
    <CalendarEventGhost
      compact
      top={topPxForMinutes(dragPreview.newStartMins)}
      height={Math.max(
        MIN_EVENT_HEIGHT,
        topPxForMinutes((dragPreview.newEndsAt - dragPreview.newStartsAt) / 60_000),
      )}
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
  channelPresentationsById,
}: CalendarWeekViewProps): ReactElement => {
  const { isMobile } = usePlatform();
  const timeGutterWidth = isMobile ? 48 : TIME_GUTTER_WIDTH;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => new Date());
  const [openCallId, setOpenCallId] = useState<string | null>(initialOpenCallId ?? null);

  const {
    sensors,
    dragPreview,
    onDragStart,
    onDragMove,
    onDragEnd,
    onDragCancel,
    dialogOpen: rescheduleDialogOpen,
    confirm: confirmReschedule,
    cancel: cancelReschedule,
    pendingChange: pendingRescheduleChange,
  } = useDragReschedule(calls);

  const {
    resizePreview,
    activeResizeCallId,
    onResizePointerDown,
    dialogOpen: resizeDialogOpen,
    confirm: confirmResize,
    cancel: cancelResize,
    pendingChange: pendingResizeChange,
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

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <div className='w-full h-full flex flex-col border-x border-y border-border overflow-hidden'>
        {/* Day header row */}
        <div className='flex shrink-0 items-center border-b border-border'>
          <div style={{ width: timeGutterWidth }} className='shrink-0' />
          {weekDays.map((day, i) => {
            const isToday = isSameDay(day, today);
            const dayCallCount = callsByDay.get(dayKey(day))?.length ?? 0;
            const title = `${format(day, 'EEEE')} ${day.getDate()} · ${
              dayCallCount === 0
                ? 'no calls'
                : `${dayCallCount} call${dayCallCount === 1 ? '' : 's'}`
            }`;
            return (
              <button
                key={i}
                type='button'
                title={title}
                aria-label={title}
                className='flex flex-1 flex-col items-center gap-0.5 pb-2 pt-[7px]'
              >
                <span className='text-[10px] font-semibold uppercase tracking-[0.5px] text-muted-foreground'>
                  {DAY_NAMES[day.getDay()]}
                </span>
                <span
                  className={cn(
                    'flex size-[21px] items-center justify-center rounded-full text-[12.5px] font-semibold',
                    isToday ? 'bg-primary text-primary-foreground' : 'text-foreground',
                  )}
                >
                  {day.getDate()}
                </span>
                <span
                  className={cn(
                    'size-1 rounded-full',
                    dayCallCount > 0 ? 'bg-muted-foreground' : 'bg-transparent',
                  )}
                />
              </button>
            );
          })}
        </div>

        {/* Scrollable time grid */}
        <div ref={scrollRef} className='flex-1 min-h-0 overflow-y-auto'>
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
                  const isWeekend = day.getDay() === 0 || day.getDay() === 6;

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

                  const positions = computeEventPositions(allEvents, day);

                  return (
                    <DroppableDayColumn
                      key={i}
                      date={day}
                      isToday={isToday}
                      isWeekend={isWeekend}
                      isPopoverOpen={openCallId !== null}
                      onCreateCallAtSlot={onCreateCallAtSlot}
                      onDragCreatePointerDown={onDragCreatePointerDown}
                      consumeDragEnd={consumeDragEnd}
                    >
                      {/* Move-drag ghost */}
                      {dragPreview && (
                        <DropGhost dragPreview={dragPreview} columnDateKey={colDateKey} />
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
                        const variant = getCallPillVariant(call, currentUserId, now);
                        const joinable = isCallJoinableNow(call, variant, now);
                        const channel = call.channelId
                          ? channelPresentationsById?.get(call.channelId)
                          : undefined;

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
                            variant={variant}
                            joinable={joinable}
                            {...(channel ? { channel } : {})}
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
};

export default CalendarWeekView;
