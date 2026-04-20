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
  snapTo15,
  parseDayKey,
  dayKey,
  formatTime,
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
  /** Human-readable time range shown on the overlay and ghost, e.g. "10:15 am – 11:15 am" */
  formattedTime: string;
  /** Dimensions captured from the dragged element's bounding rect — used to size the DragOverlay */
  overlayWidth: number;
  overlayHeight: number;
}

interface DragState {
  call: Call;
  originalStartMins: number;
  originalDurationMins: number;
  originalDateKey: string;
  overlayWidth: number;
  overlayHeight: number;
}

interface PendingReschedule {
  externalId: string;
  newStartsAt: number;
  newEndsAt: number;
}

interface UseDragRescheduleReturn {
  sensors: ReturnType<typeof useSensors>;
  /** Reactive value — drives the drop-zone ghost and DragOverlay label */
  dragPreview: DragPreview | null;
  /** The call card currently being dragged — drives DragOverlay rendering */
  activeCall: Call | null;
  onDragStart: (event: DragStartEvent) => void;
  onDragMove: (event: DragMoveEvent) => void;
  onDragEnd: (event: DragEndEvent) => void;
  onDragCancel: () => void;
  recurringDialogOpen: boolean;
  confirmReschedule: () => void;
  cancelReschedule: () => void;
  singleDialogOpen: boolean;
  confirmSingleReschedule: () => void;
  cancelSingleReschedule: () => void;
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
    overlayWidth: state.overlayWidth,
    overlayHeight: state.overlayHeight,
  };
}

export function useDragReschedule(calls: Call[]): UseDragRescheduleReturn {
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
  const [recurringDialogOpen, setRecurringDialogOpen] = useState(false);
  const [singleDialogOpen, setSingleDialogOpen] = useState(false);

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

  // ── DndContext handlers ──

  const onDragStart = useCallback(
    (event: DragStartEvent): void => {
      const call = calls.find(c => c.id === event.active.id);
      if (!call?.startsAt) return;

      const rect = event.active.rect.current.initial;
      const startMins = minutesSinceMidnight(new Date(call.startsAt));
      const endMins = call.endsAt ? minutesSinceMidnight(new Date(call.endsAt)) : startMins + 60;

      const state: DragState = {
        call,
        originalStartMins: startMins,
        originalDurationMins: Math.max(15, endMins - startMins),
        originalDateKey: dayKey(new Date(call.startsAt)),
        overlayWidth: rect?.width ?? 120,
        overlayHeight: rect?.height ?? 40,
      };
      dragStateRef.current = state;
      setActiveCall(call);
      setPreview(buildPreview(state, startMins, state.originalDateKey));
    },
    [calls, setPreview],
  );

  const onDragMove = useCallback(
    (event: DragMoveEvent): void => {
      const state = dragStateRef.current;
      if (!state) return;

      const deltaMinutes = (event.delta.y / HOUR_HEIGHT) * 60;
      const rawStartMins = state.originalStartMins + deltaMinutes;
      const maxStartMins = 24 * 60 - state.originalDurationMins;
      const snappedStartMins = Math.max(0, Math.min(maxStartMins, snapTo15(rawStartMins)));

      const targetDateKey =
        typeof event.over?.id === 'string' ? event.over.id : state.originalDateKey;

      setPreview(buildPreview(state, snappedStartMins, targetDateKey));
    },
    [setPreview],
  );

  const onDragEnd = useCallback(
    (event: DragEndEvent): void => {
      const state = dragStateRef.current;
      // Read from ref — always has the latest value, no stale closure risk
      const preview = dragPreviewRef.current;

      cleanup();

      if (!state || !preview) return;

      // No-op if position didn't actually change
      const originalEndsAt =
        state.call.endsAt ?? state.call.startsAt! + state.originalDurationMins * 60_000;
      if (preview.newStartsAt === state.call.startsAt && preview.newEndsAt === originalEndsAt)
        return;

      // Only commit if the card was dropped over a valid column
      if (!event.over) return;

      const { externalId } = state.call;
      const { newStartsAt, newEndsAt } = preview;

      // Store in ref so confirm handler always reads the latest value
      pendingRescheduleRef.current = { externalId, newStartsAt, newEndsAt };
      if (state.call.recurringSeriesId) {
        setRecurringDialogOpen(true);
      } else {
        setSingleDialogOpen(true);
      }
    },
    [cleanup],
    // No dragPreview or pendingReschedule in deps — we read from refs instead
  );

  const onDragCancel = useCallback((): void => {
    cleanup();
  }, [cleanup]);

  const confirmReschedule = useCallback((): void => {
    // Read from ref — guaranteed to be the value set in onDragEnd
    const pending = pendingRescheduleRef.current;
    if (!pending) return;
    void callService.updateScheduledCall(pending.externalId, {
      startsAt: pending.newStartsAt,
      endsAt: pending.newEndsAt,
    });
    pendingRescheduleRef.current = null;
    setRecurringDialogOpen(false);
  }, []);
  // No pendingReschedule state in deps — we read from the ref directly

  const cancelReschedule = useCallback((): void => {
    pendingRescheduleRef.current = null;
    setRecurringDialogOpen(false);
  }, []);

  const confirmSingleReschedule = useCallback((): void => {
    const pending = pendingRescheduleRef.current;
    if (!pending) return;
    void callService.updateScheduledCall(pending.externalId, {
      startsAt: pending.newStartsAt,
      endsAt: pending.newEndsAt,
    });
    pendingRescheduleRef.current = null;
    setSingleDialogOpen(false);
  }, []);

  const cancelSingleReschedule = useCallback((): void => {
    pendingRescheduleRef.current = null;
    setSingleDialogOpen(false);
  }, []);

  return {
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
  };
}
