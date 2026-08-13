import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  HOUR_HEIGHT,
  dayKey,
  formatTime,
  minutesFromTopPx,
  snapMinutes,
} from './CalenderViewUtils';

export interface DragCreatePreview {
  dateKey: string;
  startMins: number;
  endMins: number;
  formattedTime: string;
}

interface DragState {
  date: Date;
  anchorMins: number;
  anchorClientY: number;
  active: boolean;
}

interface UseDragCreateReturn {
  dragCreatePreview: DragCreatePreview | null;
  onDragCreatePointerDown: (e: React.PointerEvent<HTMLDivElement>, date: Date) => void;
  consumeDragEnd: () => boolean;
}

export interface UseDragCreateOptions {
  coordinateRef?: RefObject<HTMLElement | null>;
  hourHeight?: number;
  minimumDurationMins?: number;
  snapIntervalMins?: number;
}

const DAY_MINUTES = 24 * 60;

// Calculates the start and end minutes of a drag selection, ensuring that the selection is at least `minimumDurationMins` long. If the user drags in the opposite direction, the selection will expand to meet the minimum duration requirement.
const getDragCreateRange = (
  anchorMins: number,
  currentMins: number,
  minimumDurationMins: number,
): { startMins: number; endMins: number } => {
  let startMins = Math.min(anchorMins, currentMins);
  let endMins = Math.max(anchorMins, currentMins);

  if (endMins - startMins < minimumDurationMins) {
    if (currentMins < anchorMins) {
      startMins = Math.max(0, endMins - minimumDurationMins);
    } else {
      endMins = Math.min(DAY_MINUTES, startMins + minimumDurationMins);
      if (endMins - startMins < minimumDurationMins) {
        startMins = Math.max(0, endMins - minimumDurationMins);
      }
    }
  }

  return { startMins, endMins };
};

export function useDragCreate(
  gridRef: RefObject<HTMLDivElement | null>,
  onCreateCallAtSlot: ((startsAt: Date, endsAt: Date) => void) | undefined,
  {
    coordinateRef,
    hourHeight = HOUR_HEIGHT,
    minimumDurationMins = 15,
    snapIntervalMins = 15,
  }: UseDragCreateOptions = {},
): UseDragCreateReturn {
  const stateRef = useRef<DragState | null>(null);
  const previewRef = useRef<DragCreatePreview | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const dragEndedRef = useRef(false);

  const [dragCreatePreview, setDragCreatePreview] = useState<DragCreatePreview | null>(null);

  // Clean up window listeners if the component unmounts mid-drag
  useEffect(() => {
    return (): void => cleanupRef.current?.();
  }, []);

  /** Call at the top of handleClick — returns true (and resets) if a drag just ended. */
  const consumeDragEnd = useCallback((): boolean => {
    if (dragEndedRef.current) {
      dragEndedRef.current = false;
      return true;
    }
    return false;
  }, []);

  const onDragCreatePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, date: Date): void => {
      if (!onCreateCallAtSlot || e.button !== 0) return;
      // Don't activate when pressing on an existing call card (all are <button> elements)
      if ((e.target as HTMLElement).closest('button')) return;

      const grid = gridRef.current;
      if (!grid) return;

      e.preventDefault();
      cleanupRef.current?.();

      const getRawMins = (clientY: number): number => {
        const coordinateElement = coordinateRef?.current;
        if (coordinateElement) {
          return minutesFromTopPx(
            clientY - coordinateElement.getBoundingClientRect().top,
            hourHeight,
          );
        }

        return minutesFromTopPx(
          clientY - grid.getBoundingClientRect().top + grid.scrollTop,
          hourHeight,
        );
      };

      const anchorRawMins = getRawMins(e.clientY);

      stateRef.current = {
        date,
        anchorMins: Math.max(
          0,
          Math.min(DAY_MINUTES, snapMinutes(anchorRawMins, snapIntervalMins)),
        ),
        anchorClientY: e.clientY,
        active: false,
      };
      dragEndedRef.current = false;

      // Converts a clientY to snapped minutes, clamped to [0, 24*60]
      const toSnappedMins = (clientY: number): number => {
        return Math.max(
          0,
          Math.min(DAY_MINUTES, snapMinutes(getRawMins(clientY), snapIntervalMins)),
        );
      };

      const buildPreview = (currentMins: number): DragCreatePreview => {
        const { anchorMins } = stateRef.current!;
        const { startMins, endMins } = getDragCreateRange(
          anchorMins,
          currentMins,
          minimumDurationMins,
        );
        const startDate = new Date(date);
        startDate.setHours(Math.floor(startMins / 60), startMins % 60, 0, 0);
        const endDate = new Date(date);
        endDate.setHours(Math.floor(endMins / 60), endMins % 60, 0, 0);
        return {
          dateKey: dayKey(date),
          startMins,
          endMins,
          formattedTime: `${formatTime(startDate.getTime())} – ${formatTime(endDate.getTime())}`,
        };
      };

      const onPointerMove = (ev: PointerEvent): void => {
        const state = stateRef.current;
        if (!state) return;

        // Activate only once the pointer has moved past the 5px threshold
        if (!state.active) {
          if (Math.abs(ev.clientY - state.anchorClientY) < 5) return;
          state.active = true;
        }

        const preview = buildPreview(toSnappedMins(ev.clientY));
        previewRef.current = preview;
        setDragCreatePreview(preview);
      };

      const finishDrag = (shouldCreate: boolean): void => {
        const state = stateRef.current;
        const preview = previewRef.current;

        cleanupRef.current?.();
        cleanupRef.current = null;
        stateRef.current = null;
        previewRef.current = null;
        setDragCreatePreview(null);

        if (!shouldCreate || !state?.active || !preview) return;

        // Flag so the trailing click event doesn't also trigger click-to-create
        dragEndedRef.current = true;

        const startDate = new Date(date);
        startDate.setHours(Math.floor(preview.startMins / 60), preview.startMins % 60, 0, 0);
        const endDate = new Date(date);
        endDate.setHours(Math.floor(preview.endMins / 60), preview.endMins % 60, 0, 0);
        onCreateCallAtSlot(startDate, endDate);
      };

      const onPointerUp = (): void => finishDrag(true);
      const onPointerCancel = (): void => finishDrag(false);

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerCancel);
      cleanupRef.current = (): void => {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerCancel);
      };
    },
    [coordinateRef, gridRef, hourHeight, minimumDurationMins, onCreateCallAtSlot, snapIntervalMins],
  );

  return { dragCreatePreview, onDragCreatePointerDown, consumeDragEnd };
}
