import { useCallback, useRef, useState, type ReactNode } from 'react';
import { cn } from '../shared/cn.js';

export interface SidePanelShellProps {
  /** Top accent border color class, e.g. `border-t-indigo-400`. */
  accentClassName?: string | undefined;
  /** Controlled width (px). When provided with `onWidthChange`, the parent owns the width so it persists across panel swaps. */
  width?: number | undefined;
  onWidthChange?: ((width: number) => void) | undefined;
  /** Initial width when uncontrolled. */
  initialWidth?: number | undefined;
  minWidth?: number | undefined;
  maxWidth?: number | undefined;
  /** Fill the available width (flex-1) instead of a fixed/resizable width — for the expanded read view. */
  fill?: boolean | undefined;
  className?: string | undefined;
  children: ReactNode;
}

/**
 * Shared container for the run-view right-hand panels (step detail + summary):
 * a resizable, left-bordered column with a drag handle and slide-in animation.
 * Callers render their own header/body inside.
 *
 * Width can be controlled (`width` + `onWidthChange`) so it survives swapping
 * between the step-detail and summary panels; otherwise it manages its own.
 */
export function SidePanelShell({
  accentClassName = 'border-t-[var(--wui-border-strong)]',
  width: controlledWidth,
  onWidthChange,
  initialWidth = 360,
  minWidth = 280,
  maxWidth = 640,
  fill,
  className,
  children,
}: SidePanelShellProps) {
  const [internalWidth, setInternalWidth] = useState(initialWidth);
  const width = controlledWidth ?? internalWidth;
  const setWidth = useCallback(
    (w: number) => {
      if (onWidthChange) onWidthChange(w);
      else setInternalWidth(w);
    },
    [onWidthChange],
  );

  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragRef.current = { startX: e.clientX, startW: width };

      const handleMouseMove = (ev: MouseEvent) => {
        if (!dragRef.current) return;
        const dx = dragRef.current.startX - ev.clientX;
        const newW = Math.min(maxWidth, Math.max(minWidth, dragRef.current.startW + dx));
        setWidth(newW);
      };

      const handleMouseUp = () => {
        dragRef.current = null;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [width, minWidth, maxWidth, setWidth],
  );

  return (
    <div
      className={cn(
        'relative flex flex-col border-l border-t-2 border-[var(--wui-border)] bg-[var(--wui-bg)] dark:shadow-xl',
        fill && 'min-w-0 flex-1',
        accentClassName,
        className,
      )}
      style={fill ? { animation: 'wui-slide-in-right 200ms ease-out' } : { width, minWidth, animation: 'wui-slide-in-right 200ms ease-out' }}
    >
      {/* Drag handle — left edge (hidden when filling the width) */}
      {!fill && (
        <div
          className="absolute left-0 top-0 bottom-0 z-10 w-1 cursor-col-resize transition-colors hover:bg-[color-mix(in_srgb,var(--wui-primary)_40%,transparent)] active:bg-[color-mix(in_srgb,var(--wui-primary)_55%,transparent)]"
          onMouseDown={handleMouseDown}
        />
      )}
      {children}
    </div>
  );
}
