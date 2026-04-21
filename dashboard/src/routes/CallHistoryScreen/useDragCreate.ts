import { useCallback, useEffect, useRef, useState } from 'react';
import { HOUR_HEIGHT, dayKey, formatTime, snapTo15 } from './CalenderViewUtils';

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

export function useDragCreate(
  gridRef: React.RefObject<HTMLDivElement | null>,
  onCreateCallAtSlot: ((startsAt: Date, endsAt: Date) => void) | undefined,
): UseDragCreateReturn {
  const stateRef = useRef<DragState | null>(null);
  const previewRef = useRef<DragCreatePreview | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const dragEndedRef = useRef(false);

  const [dragCreatePreview, setDragCreatePreview] = useState<DragCreatePreview | null>(null);

  // Clean up window listeners if the component unmounts mid-drag
  useEffect(() => () => cleanupRef.current?.(), []);

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

      const anchorRawMins =
        ((e.clientY - grid.getBoundingClientRect().top + grid.scrollTop) / HOUR_HEIGHT) * 60;

      stateRef.current = {
        date,
        anchorMins: snapTo15(anchorRawMins),
        anchorClientY: e.clientY,
        active: false,
      };
      dragEndedRef.current = false;

      // Converts a clientY to snapped minutes, clamped to [0, 24*60]
      const toSnappedMins = (clientY: number): number => {
        const g = gridRef.current!;
        const raw = ((clientY - g.getBoundingClientRect().top + g.scrollTop) / HOUR_HEIGHT) * 60;
        return Math.max(0, Math.min(24 * 60, snapTo15(raw)));
      };

      const buildPreview = (currentMins: number): DragCreatePreview => {
        const { anchorMins } = stateRef.current!;
        const startMins = Math.min(anchorMins, currentMins);
        // Enforce minimum 15-min duration
        const endMins = Math.max(Math.max(anchorMins, currentMins), startMins + 15);
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

      const onPointerUp = (): void => {
        const state = stateRef.current;
        const preview = previewRef.current;

        cleanupRef.current?.();
        cleanupRef.current = null;
        stateRef.current = null;
        previewRef.current = null;
        setDragCreatePreview(null);

        if (!state?.active || !preview) return;

        // Flag so the trailing click event doesn't also trigger click-to-create
        dragEndedRef.current = true;

        const startDate = new Date(date);
        startDate.setHours(Math.floor(preview.startMins / 60), preview.startMins % 60, 0, 0);
        const endDate = new Date(date);
        endDate.setHours(Math.floor(preview.endMins / 60), preview.endMins % 60, 0, 0);
        onCreateCallAtSlot(startDate, endDate);
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      cleanupRef.current = () => {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
      };
    },
    [gridRef, onCreateCallAtSlot],
  );

  return { dragCreatePreview, onDragCreatePointerDown, consumeDragEnd };
}
