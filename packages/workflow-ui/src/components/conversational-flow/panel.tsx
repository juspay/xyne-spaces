/**
 * Side panels the author can widen or narrow: drag the edge, use the arrow
 * keys on it, or double-click it to go back to the default. Each panel
 * remembers its width (and the map its direction) for this viewer.
 */
import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { cn } from '../shared/cn.js';

// Survives the panel closing and reopening even where storage is unavailable.
const memory = new Map<string, string>();

export function readPref(key: string): string | null {
  try {
    return window.localStorage.getItem(`wui.conversationalFlow.${key}`) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

export function writePref(key: string, value: string): void {
  memory.set(key, value);
  try {
    window.localStorage.setItem(`wui.conversationalFlow.${key}`, value);
  } catch {
    // Private windows and blocked storage: the in-memory copy is enough.
  }
}

export interface PanelWidth {
  width: number;
  min: number;
  max: number;
  set: (width: number, remember?: boolean) => void;
  reset: () => void;
}

export function usePanelWidth(key: string, { initial, min, max }: { initial: number; min: number; max: number }): PanelWidth {
  const clamp = useCallback((w: number) => Math.round(Math.min(max, Math.max(min, w))), [min, max]);
  const [width, setWidth] = useState(() => {
    const saved = Number(readPref(`width.${key}`));
    return saved ? clamp(saved) : initial;
  });
  const set = useCallback(
    (w: number, remember = true) => {
      const next = clamp(w);
      setWidth(next);
      if (remember) writePref(`width.${key}`, String(next));
    },
    [clamp, key],
  );
  const reset = useCallback(() => set(initial), [set, initial]);
  return { width, min, max, set, reset };
}

/**
 * The draggable edge of a panel. `edge` is the side of the panel it sits on:
 * a panel on the right of the screen is resized from its left edge.
 */
export function ResizeHandle({ panel, edge, label }: { panel: PanelWidth; edge: 'left' | 'right'; label: string }) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const [active, setActive] = useState(false);
  // Dragging towards the panel's open side widens it.
  const sign = edge === 'left' ? -1 : 1;

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, width: panel.width };
    setActive(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    panel.set(drag.current.width + sign * (e.clientX - drag.current.x), false);
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    panel.set(drag.current.width + sign * (e.clientX - drag.current.x));
    drag.current = null;
    setActive(false);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 64 : 16;
    if (e.key === 'ArrowLeft') panel.set(panel.width - sign * step);
    else if (e.key === 'ArrowRight') panel.set(panel.width + sign * step);
    else if (e.key === 'Home') panel.set(panel.min);
    else if (e.key === 'End') panel.set(panel.max);
    else if (e.key === 'Enter') panel.reset();
    else return;
    e.preventDefault();
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={panel.width}
      aria-valuemin={panel.min}
      aria-valuemax={panel.max}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={panel.reset}
      onKeyDown={onKeyDown}
      className={cn('group/resize absolute inset-y-0 z-10 w-2 cursor-col-resize touch-none outline-none', edge === 'left' ? '-left-1' : '-right-1')}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 w-0.5 transition-colors group-hover/resize:bg-[var(--wui-primary)] group-focus-visible/resize:bg-[var(--wui-primary)]"
        style={{ left: 'calc(50% - 1px)', ...(active ? { background: 'var(--wui-primary)' } : {}) }}
      />
    </div>
  );
}
