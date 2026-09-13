import { useCallback, useEffect, useRef, useState } from 'react';
import { type Call } from './callHistoryItem.utils';
import { callService } from '../../services/Call/callService';
import {
  HOUR_HEIGHT,
  dayKey,
  formatTime,
  parseDayKey,
  snapMinutes,
  getVisibleMinutesForDay,
} from './CalenderViewUtils';
import type { PendingCallChange } from './useDragReschedule';

export interface ResizePreview {
  callId: string;
  /** dayKey of the column — used by WeekView to render the ghost in the right column */
  dateKey: string;
  startMins: number;
  newEndMins: number;
  newEndsAt: number;
  formattedTime: string;
}

interface ResizeState {
  call: Call;
  startMins: number;
  originalEndMins: number;
  dateKey: string;
}

interface PendingResize {
  externalId: string;
  newStartsAt: number;
  newEndsAt: number;
}

interface UseResizeEndTimeReturn {
  resizePreview: ResizePreview | null;
  activeResizeCallId: string | null;
  onResizePointerDown: (e: React.PointerEvent, call: Call) => void;
  dialogOpen: boolean;
  confirm: () => void;
  cancel: () => void;
  /** Reactive mirror of the pending resize — feeds the confirmation dialog's content. */
  pendingChange: PendingCallChange | null;
}

// Pure function — no hook deps, no closure. Defined at module level.
// Anchored on state.dateKey (the day being resized on), not call.startsAt's own
// day — for a cross-midnight call's clipped continuation those differ, and
// building off the wrong day would set the new end time on the wrong date.
function buildPreview(state: ResizeState, snappedEndMins: number): ResizePreview {
  const dayAnchor = parseDayKey(state.dateKey);
  const startDate = new Date(dayAnchor);
  startDate.setHours(Math.floor(state.startMins / 60), state.startMins % 60, 0, 0);
  const endDate = new Date(dayAnchor);
  endDate.setHours(Math.floor(snappedEndMins / 60), snappedEndMins % 60, 0, 0);
  const newEndsAt = endDate.getTime();
  return {
    callId: state.call.id,
    dateKey: state.dateKey,
    startMins: state.startMins,
    newEndMins: snappedEndMins,
    newEndsAt,
    formattedTime: `${formatTime(startDate.getTime())} – ${formatTime(newEndsAt)}`,
  };
}

export function useResizeEndTime(
  gridRef: React.RefObject<HTMLDivElement | null>,
  hourHeight: number = HOUR_HEIGHT,
  referenceDay?: Date,
): UseResizeEndTimeReturn {
  const resizeStateRef = useRef<ResizeState | null>(null);
  const resizePreviewRef = useRef<ResizePreview | null>(null);
  const pendingResizeRef = useRef<PendingResize | null>(null);
  /** Stores the active window-listener teardown — called on unmount or before starting a new drag */
  const cleanupListenersRef = useRef<(() => void) | null>(null);

  const [resizePreview, setResizePreview] = useState<ResizePreview | null>(null);
  const [activeResizeCallId, setActiveResizeCallId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingChange, setPendingChange] = useState<PendingCallChange | null>(null);

  // Guard against lingering listeners if the component unmounts mid-drag
  useEffect(() => () => cleanupListenersRef.current?.(), []);

  // useState setters are stable — no deps needed
  const cleanup = useCallback((): void => {
    resizeStateRef.current = null;
    resizePreviewRef.current = null;
    setActiveResizeCallId(null);
    setResizePreview(null);
  }, []);

  const openDialogFor = useCallback((change: PendingCallChange): void => {
    setPendingChange(change);
    setDialogOpen(true);
  }, []);

  const onResizePointerDown = useCallback(
    (e: React.PointerEvent, call: Call): void => {
      // Capture subsequent pointer events to this element so pointerup always
      // fires here, preventing the card body from receiving it when dragging upward.
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      // Prevent the card's move-drag (@dnd-kit) and popover from activating
      e.stopPropagation();
      e.preventDefault();

      if (!call.startsAt) return;

      // Tear down any previous drag that didn't complete cleanly
      cleanupListenersRef.current?.();

      const day = referenceDay ?? new Date(call.startsAt);
      const { startMins, endMins: originalEndMins } = getVisibleMinutesForDay(call, day);

      const state: ResizeState = {
        call,
        startMins,
        originalEndMins,
        dateKey: dayKey(day),
      };
      resizeStateRef.current = state;
      setActiveResizeCallId(call.id);

      const initial = buildPreview(state, originalEndMins);
      resizePreviewRef.current = initial;
      setResizePreview(initial);

      const onPointerMove = (moveEvent: PointerEvent): void => {
        const currentState = resizeStateRef.current;
        const grid = gridRef.current;
        if (!currentState || !grid) return;

        const { top, scrollTop } = {
          top: grid.getBoundingClientRect().top,
          scrollTop: grid.scrollTop,
        };
        const rawEndMins = ((moveEvent.clientY - top + scrollTop) / hourHeight) * 60;
        const snappedEndMins = Math.max(
          currentState.startMins + 15,
          Math.min(24 * 60, snapMinutes(rawEndMins, 15)),
        );

        const preview = buildPreview(currentState, snappedEndMins);
        resizePreviewRef.current = preview;
        setResizePreview(preview);
      };

      const onPointerUp = (): void => {
        const state = resizeStateRef.current;
        const preview = resizePreviewRef.current;

        // cleanupListenersRef removes both pointermove and this pointerup listener
        cleanupListenersRef.current?.();
        cleanupListenersRef.current = null;
        cleanup();

        if (!state || !preview || preview.newEndMins === state.originalEndMins) return;

        const newStartsAt = new Date(state.call.startsAt!).getTime();
        const currentEndsAt = buildPreview(state, state.originalEndMins).newEndsAt;

        pendingResizeRef.current = {
          externalId: state.call.externalId,
          newStartsAt,
          newEndsAt: preview.newEndsAt,
        };
        openDialogFor({
          call: state.call,
          currentStartsAt: newStartsAt,
          currentEndsAt,
          newStartsAt,
          newEndsAt: preview.newEndsAt,
        });
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);

      cleanupListenersRef.current = () => {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
      };
    },
    [gridRef, cleanup, hourHeight, referenceDay, openDialogFor],
  );

  const confirm = useCallback((): void => {
    const pending = pendingResizeRef.current;
    if (!pending) return;
    void callService.updateScheduledCall(pending.externalId, {
      startsAt: pending.newStartsAt,
      endsAt: pending.newEndsAt,
    });
    pendingResizeRef.current = null;
    setDialogOpen(false);
  }, []);

  const cancel = useCallback((): void => {
    pendingResizeRef.current = null;
    setDialogOpen(false);
  }, []);

  return {
    resizePreview,
    activeResizeCallId,
    onResizePointerDown,
    dialogOpen,
    confirm,
    cancel,
    pendingChange,
  };
}
