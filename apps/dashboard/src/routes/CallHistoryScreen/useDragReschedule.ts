import { useCallback, useRef, useState } from 'react';
import {
  useSensor,
  useSensors,
  MouseSensor,
  TouchSensor,
  type DragStartEvent,
  type DragMoveEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { type Call } from './callHistoryItem.utils';
import { callService } from '../../services/Call/callService';
import {
  HOUR_HEIGHT,
  minutesSinceMidnight,
  snapMinutes,
  parseDayKey,
  dayKey,
  formatTime,
  isSameDay,
  getVisibleMinutesForDay,
} from './CalenderViewUtils';

export interface DragPreview {
  callId: string;
  /** Snapped minutes since midnight — used to position the drop-zone ghost */
  newStartMins: number;
  /** Full ms timestamp for the new start */
  newStartsAt: number;
  /** Full ms timestamp for the new end */
  newEndsAt: number;
  /** dayKey of the column showing the ghost */
  targetDateKey: string;
  /** Human-readable time range shown on the ghost, e.g. "10:15 am – 11:15 am" */
  formattedTime: string;
}

interface DragState {
  call: Call;
  originalStartMins: number;
  originalDurationMins: number;
  originalDateKey: string;
}

interface PendingReschedule {
  externalId: string;
  newStartsAt: number;
  newEndsAt: number;
}

/** Everything the confirmation dialog needs to show a before/after summary. */
export interface PendingCallChange {
  call: Call;
  currentStartsAt: number;
  currentEndsAt: number;
  newStartsAt: number;
  newEndsAt: number;
}

interface UseDragRescheduleReturn {
  sensors: ReturnType<typeof useSensors>;
  /** Reactive value — drives the drop-zone ghost */
  dragPreview: DragPreview | null;
  /** The call card currently being dragged */
  activeCall: Call | null;
  onDragStart: (event: DragStartEvent) => void;
  onDragMove: (event: DragMoveEvent) => void;
  onDragEnd: (event: DragEndEvent) => void;
  onDragCancel: () => void;
  dialogOpen: boolean;
  confirm: () => void;
  cancel: () => void;
  pendingChange: PendingCallChange | null;
}

function buildPreview(state: DragState, newStartMins: number, targetDateKey: string): DragPreview {
  const targetDate = parseDayKey(targetDateKey);
  const newStartDate = new Date(targetDate);
  newStartDate.setHours(Math.floor(newStartMins / 60), newStartMins % 60, 0, 0);
  const newStartsAt = newStartDate.getTime();
  const newEndsAt = newStartsAt + state.originalDurationMins * 60_000;

  return {
    callId: state.call.id,
    newStartMins,
    newStartsAt,
    newEndsAt,
    targetDateKey,
    formattedTime: `${formatTime(newStartsAt)} – ${formatTime(newEndsAt)}`,
  };
}

export function useDragReschedule(
  calls: Call[],
  hourHeight: number = HOUR_HEIGHT,
  referenceDay?: Date,
): UseDragRescheduleReturn {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  // ── Refs: always hold the latest value, safe to read inside any callback ──

  /** Internal drag state — not reactive, only used inside callbacks */
  const dragStateRef = useRef<DragState | null>(null);

  /**
   * Mirror of dragPreview state, kept in sync.
   * Read in onDragEnd to avoid a stale closure — state captured in a useCallback
   * dependency might be one render behind when @dnd-kit fires the event.
   */
  const dragPreviewRef = useRef<DragPreview | null>(null);

  /**
   * Set when a recurring call is dropped. Read in confirmReschedule so it
   * never sees a stale value regardless of when the button is clicked.
   */
  const pendingRescheduleRef = useRef<PendingReschedule | null>(null);

  // ── State: drives re-renders / UI visibility ──

  const [activeCall, setActiveCall] = useState<Call | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingChange, setPendingChange] = useState<PendingCallChange | null>(null);

  // ── Helpers ──

  const setPreview = useCallback((preview: DragPreview | null): void => {
    dragPreviewRef.current = preview;
    setDragPreview(preview);
  }, []);

  const cleanup = useCallback((): void => {
    dragStateRef.current = null;
    setActiveCall(null);
    setPreview(null);
  }, [setPreview]);

  const openDialogFor = useCallback((change: PendingCallChange): void => {
    setPendingChange(change);
    setDialogOpen(true);
  }, []);

  // ── DndContext handlers ──

  const onDragStart = useCallback(
    (event: DragStartEvent): void => {
      const call = calls.find(c => c.id === event.active.id);
      if (!call?.startsAt) return;

      const day = referenceDay ?? new Date(call.startsAt);
      const { startMins, endMins } = getVisibleMinutesForDay(call, day);

      const state: DragState = {
        call,
        originalStartMins: startMins,
        originalDurationMins: Math.max(15, endMins - startMins),
        originalDateKey: dayKey(day),
      };
      dragStateRef.current = state;
      setActiveCall(call);
      setPreview(buildPreview(state, startMins, state.originalDateKey));
    },
    [calls, referenceDay, setPreview],
  );

  const onDragMove = useCallback(
    (event: DragMoveEvent): void => {
      const state = dragStateRef.current;
      if (!state) return;

      const targetDateKey =
        typeof event.over?.id === 'string' ? event.over.id : state.originalDateKey;

      const deltaMinutes = (event.delta.y / hourHeight) * 60;
      const rawStartMins = state.originalStartMins + deltaMinutes;
      const maxStartMins = 24 * 60 - state.originalDurationMins;

      const minStartMins = isSameDay(parseDayKey(targetDateKey), new Date())
        ? Math.ceil(minutesSinceMidnight(new Date()) / 15) * 15
        : 0;
      const snappedStartMins = Math.max(
        minStartMins,
        Math.min(maxStartMins, snapMinutes(rawStartMins, 15)),
      );

      setPreview(buildPreview(state, snappedStartMins, targetDateKey));
    },
    [hourHeight, setPreview],
  );

  const onDragEnd = useCallback(
    (event: DragEndEvent): void => {
      const state = dragStateRef.current;
      const preview = dragPreviewRef.current;

      cleanup();

      if (!state || !preview) return;

      const originalEndsAt =
        state.call.endsAt ?? state.call.startsAt! + state.originalDurationMins * 60_000;
      if (preview.newStartsAt === state.call.startsAt && preview.newEndsAt === originalEndsAt)
        return;

      if (!event.over) return;

      const { externalId } = state.call;
      const { newStartsAt, newEndsAt } = preview;

      pendingRescheduleRef.current = { externalId, newStartsAt, newEndsAt };
      openDialogFor({
        call: state.call,
        currentStartsAt: state.call.startsAt!,
        currentEndsAt: originalEndsAt,
        newStartsAt,
        newEndsAt,
      });
    },
    [cleanup, openDialogFor],
    // No dragPreview or pendingReschedule in deps — we read from refs instead
  );

  const onDragCancel = useCallback((): void => {
    cleanup();
  }, [cleanup]);

  const confirm = useCallback((): void => {
    const pending = pendingRescheduleRef.current;
    if (!pending) return;
    void callService.updateScheduledCall(pending.externalId, {
      startsAt: pending.newStartsAt,
      endsAt: pending.newEndsAt,
    });
    pendingRescheduleRef.current = null;
    setDialogOpen(false);
  }, []);
  const cancel = useCallback((): void => {
    pendingRescheduleRef.current = null;
    setDialogOpen(false);
  }, []);

  return {
    sensors,
    dragPreview,
    activeCall,
    onDragStart,
    onDragMove,
    onDragEnd,
    onDragCancel,
    dialogOpen,
    confirm,
    cancel,
    pendingChange,
  };
}
