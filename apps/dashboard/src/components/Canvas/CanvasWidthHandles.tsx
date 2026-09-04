import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type RefObject,
} from 'react';

/** The width the reading column comes back to, matching global.css. */
const DEFAULT_WIDTH = 720;
const MIN_WIDTH = 480;
const MAX_WIDTH = 1400;
const KEYBOARD_STEP = 40;
const WIDTH_VARIABLE = '--canvas-content-width';
const HEIGHT_VARIABLE = '--canvas-visible-height';

/**
 * How wide this reader likes their canvases, kept per browser.
 *
 * Not in the document: the column is how one person prefers to read, and a
 * width stored in the canvas would re-lay it out for everyone else who opens it.
 */
const STORAGE_KEY = 'canvas:content-width';

const readNumber = (element: HTMLElement, variable: string, fallback: number): number => {
  const raw = getComputedStyle(element).getPropertyValue(variable).trim();
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : fallback;
};

const readStoredWidth = (): number | null => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    // Private browsing, or storage turned off. The default width still works.
    return null;
  }
};

const storeWidth = (width: number | null): void => {
  try {
    if (width === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, String(width));
  } catch {
    // As above — the width still applies for this session.
  }
};

/**
 * Drag either edge of the canvas to widen or narrow the reading column.
 *
 * The column is centred by `margin-inline: auto` off a single custom property,
 * so moving one edge outward by a distance and the width by twice it keeps the
 * centre exactly where it was: pull the right edge and the left edge comes with
 * it. That is the whole of the symmetry — there are no two sides to keep in
 * step, only one number.
 *
 * The handles live inside the scroller rather than beside it so that `50%` is
 * the middle of the text and not of the whole pane, which the comments panel
 * would otherwise shift them off. Sticky, so they stay against the visible area
 * however far the document is scrolled.
 */
export function CanvasWidthHandles({
  surfaceRef,
}: {
  /** The `.canvas-surface` element, which owns the width property. */
  surfaceRef: RefObject<HTMLElement | null>;
}): ReactElement {
  const root = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const surface = surfaceRef.current;
    const stored = readStoredWidth();
    if (surface && stored !== null) {
      surface.style.setProperty(WIDTH_VARIABLE, `${stored}px`);
    }
  }, [surfaceRef]);

  // The handles are one viewport tall, so the fade reads from end to end
  // whatever the length of the document. Their own box is zero-height, so the
  // height has to come from the scroller they are stuck to.
  useEffect(() => {
    const scroller = root.current?.parentElement;
    if (!scroller) return;

    const apply = (): void => {
      root.current?.style.setProperty(HEIGHT_VARIABLE, `${scroller.clientHeight}px`);
    };
    apply();

    const observer = new ResizeObserver(apply);
    observer.observe(scroller);
    return (): void => observer.disconnect();
  }, []);

  const setWidth = useCallback(
    (width: number): void => {
      const surface = surfaceRef.current;
      const scroller = root.current?.parentElement;
      if (!surface || !scroller) return;

      // Never wider than the room there is, or the column would run under the
      // gutter its drag handles live in.
      const gutter = readNumber(surface, '--canvas-gutter', 54);
      const room = Math.max(MIN_WIDTH, scroller.clientWidth - 2 * gutter);
      const next = Math.round(Math.min(Math.max(width, MIN_WIDTH), Math.min(MAX_WIDTH, room)));
      surface.style.setProperty(WIDTH_VARIABLE, `${next}px`);
    },
    [surfaceRef],
  );

  const currentWidth = useCallback((): number => {
    const surface = surfaceRef.current;
    return surface ? readNumber(surface, WIDTH_VARIABLE, DEFAULT_WIDTH) : DEFAULT_WIDTH;
  }, [surfaceRef]);

  const beginDrag = useCallback(
    (side: -1 | 1) =>
      (event: ReactPointerEvent<HTMLButtonElement>): void => {
        if (event.button !== 0) return;
        event.preventDefault();

        const startX = event.clientX;
        const startWidth = currentWidth();
        setDragging(true);

        const move = (moved: PointerEvent): void => {
          // Twice the distance: the edge under the pointer moves by it, and the
          // opposite edge mirrors it away from the unmoved centre.
          setWidth(startWidth + 2 * side * (moved.clientX - startX));
        };
        const end = (): void => {
          window.removeEventListener('pointermove', move);
          setDragging(false);
          storeWidth(currentWidth());
        };

        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', end, { once: true });
        window.addEventListener('pointercancel', end, { once: true });
      },
    [currentWidth, setWidth],
  );

  const reset = useCallback((): void => {
    setWidth(DEFAULT_WIDTH);
    storeWidth(null);
  }, [setWidth]);

  const nudge = useCallback(
    (side: -1 | 1) =>
      (event: React.KeyboardEvent<HTMLButtonElement>): void => {
        const towards = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
        if (towards === 0) return;
        event.preventDefault();
        setWidth(currentWidth() + 2 * side * towards * KEYBOARD_STEP);
        storeWidth(currentWidth());
      },
    [currentWidth, setWidth],
  );

  const handle = (side: -1 | 1): ReactElement => (
    <button
      type='button'
      className={`canvas-width-handle canvas-width-handle--${side === -1 ? 'left' : 'right'}`}
      aria-label='Resize the canvas width'
      onPointerDown={beginDrag(side)}
      onKeyDown={nudge(side)}
      onDoubleClick={reset}
      title='Drag to resize · double-click to reset'
      data-track-category='CANVAS'
      data-track-name='Resize_Canvas_Width'
    />
  );

  return (
    <div className='canvas-width-handles' ref={root} data-dragging={dragging ? 'true' : undefined}>
      {handle(-1)}
      {handle(1)}
    </div>
  );
}
