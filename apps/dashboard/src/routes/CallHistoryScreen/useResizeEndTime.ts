import { useCallback, useEffect, useRef, useState } from 'react';
import { type Call } from './callHistoryItem.utils';
import { callService } from '../../services/Call/callService';
import {
  HOUR_HEIGHT,
  dayKey,
  formatTime,
  minutesSinceMidnight,
  snapTo15,
} from './CalenderViewUtils';

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
  recurringResizeDialogOpen: boolean;
  confirmResize: () => void;
  cancelResize: () => void;
  singleResizeDialogOpen: boolean;
  confirmSingleResize: () => void;
  cancelSingleResize: () => void;
}

// Pure function — no hook deps, no closure. Defined at module level.
function buildPreview(state: ResizeState, snappedEndMins: number): ResizePreview {
  const startDate = new Date(state.call.startsAt!);
  const endDate = new Date(startDate);
  endDate.setHours(Math.floor(snappedEndMins / 60), snappedEndMins % 60, 0, 0);
  const newEndsAt = endDate.getTime();
  return {
    callId: state.call.id,
    dateKey: state.dateKey,
    startMins: state.startMins,
    newEndMins: snappedEndMins,
    newEndsAt,
    formattedTime: `${formatTime(state.call.startsAt)} – ${formatTime(newEndsAt)}`,
  };
}

export function useResizeEndTime(
  gridRef: React.RefObject<HTMLDivElement | null>,
): UseResizeEndTimeReturn {
  const resizeStateRef = useRef<ResizeState | null>(null);
  const resizePreviewRef = useRef<ResizePreview | null>(null);
  const pendingResizeRef = useRef<PendingResize | null>(null);
  /** Stores the active window-listener teardown — called on unmount or before starting a new drag */
  const cleanupListenersRef = useRef<(() => void) | null>(null);

  const [resizePreview, setResizePreview] = useState<ResizePreview | null>(null);
  const [activeResizeCallId, setActiveResizeCallId] = useState<string | null>(null);
  const [recurringResizeDialogOpen, setRecurringResizeDialogOpen] = useState(false);
  const [singleResizeDialogOpen, setSingleResizeDialogOpen] = useState(false);

  // Guard against lingering listeners if the component unmounts mid-drag
  useEffect(() => () => cleanupListenersRef.current?.(), []);

  // useState setters are stable — no deps needed
  const cleanup = useCallback((): void => {
    resizeStateRef.current = null;
    resizePreviewRef.current = null;
    setActiveResizeCallId(null);
    setResizePreview(null);
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

      const startMins = minutesSinceMidnight(new Date(call.startsAt));
      const originalEndMins = call.endsAt
        ? minutesSinceMidnight(new Date(call.endsAt))
        : startMins + 60;

      const state: ResizeState = {
        call,
        startMins,
        originalEndMins,
        dateKey: dayKey(new Date(call.startsAt)),
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
        const rawEndMins = ((moveEvent.clientY - top + scrollTop) / HOUR_HEIGHT) * 60;
        const snappedEndMins = Math.max(
          currentState.startMins + 15,
          Math.min(24 * 60, snapTo15(rawEndMins)),
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

        pendingResizeRef.current = {
          externalId: state.call.externalId,
          newStartsAt,
          newEndsAt: preview.newEndsAt,
        };
        if (state.call.recurringSeriesId) {
          setRecurringResizeDialogOpen(true);
        } else {
          setSingleResizeDialogOpen(true);
        }
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);

      cleanupListenersRef.current = () => {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
      };
    },
    [gridRef, cleanup],
  );

  const confirmResize = useCallback((): void => {
    const pending = pendingResizeRef.current;
    if (!pending) return;
    void callService.updateScheduledCall(pending.externalId, {
      startsAt: pending.newStartsAt,
      endsAt: pending.newEndsAt,
    });
    pendingResizeRef.current = null;
    setRecurringResizeDialogOpen(false);
  }, []);

  const cancelResize = useCallback((): void => {
    pendingResizeRef.current = null;
    setRecurringResizeDialogOpen(false);
  }, []);

  const confirmSingleResize = useCallback((): void => {
    const pending = pendingResizeRef.current;
    if (!pending) return;
    void callService.updateScheduledCall(pending.externalId, {
      startsAt: pending.newStartsAt,
      endsAt: pending.newEndsAt,
    });
    pendingResizeRef.current = null;
    setSingleResizeDialogOpen(false);
  }, []);

  const cancelSingleResize = useCallback((): void => {
    pendingResizeRef.current = null;
    setSingleResizeDialogOpen(false);
  }, []);

  return {
    resizePreview,
    activeResizeCallId,
    onResizePointerDown,
    recurringResizeDialogOpen,
    confirmResize,
    cancelResize,
    singleResizeDialogOpen,
    confirmSingleResize,
    cancelSingleResize,
  };
}
