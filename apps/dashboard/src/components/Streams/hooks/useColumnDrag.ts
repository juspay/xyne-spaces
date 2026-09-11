import { useCallback, useEffect, useRef, useState } from 'react';

/** Pointer travel before a press becomes a drag rather than a click. */
const DRAG_THRESHOLD = 5;

/** How long a dropped column takes to travel into its slot. */
const SETTLE_MS = 220;

/** Matches the lift applied while dragging, so the settle unwinds it. */
const DRAG_SCALE = 1.02;

/**
 * Animate a dropped column from where the pointer left it into wherever the
 * layout just put it — the "Last, Invert, Play" of a FLIP.
 *
 * Without this the card tracks your hand for the whole gesture and then jumps
 * the last stretch the instant you let go, which reads worse than never having
 * followed at all: the gesture ends by breaking the one promise it made.
 *
 * WAAPI rather than an inline transition, for two reasons. It never touches
 * `style.transition`, which React owns on this element and would not rewrite
 * afterwards unless the prop happened to change. And it runs off the main
 * thread, which matters here more than anywhere else on the page — this fires
 * at the exact moment React is committing a reorder of several live columns.
 */
const settle = (node: HTMLElement | null, before: DOMRect | null): void => {
  if (!node || !before) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  requestAnimationFrame(() => {
    const after = node.getBoundingClientRect();
    const dx = before.left - after.left;
    const dy = before.top - after.top;
    // Sub-pixel deltas are the case where the card was already home. Animating
    // them is invisible work that still costs a composited layer.
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    node.animate(
      [{ transform: `translate(${dx}px, ${dy}px) scale(${DRAG_SCALE})` }, { transform: 'none' }],
      { duration: SETTLE_MS, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' },
    );
  });
};

export interface DragState {
  columnId: string;
  /**
   * The pane travelling with `columnId`, when it is a channel holding one.
   *
   * A pair is one thing in the strip, so it has to be one thing under the
   * pointer too: both cards lift, both follow, both are excluded from the drop
   * geometry. Grabbing the pane's own header drags the pair — the header stays
   * a handle, it just addresses the parent.
   */
  partnerId?: string;
  from: number;
  x: number;
  y: number;
  active: boolean;
  /**
   * Where the column lands, as an index into the stream **with the dragged column
   * already removed** — which is exactly what `reorder` splices against, so the
   * drop needs no off-by-one correction.
   */
  insertAt: number | null;
  /** Where the marker paints for `insertAt`, measured when the slot changed. */
  marker: MarkerRect | null;
}

/** Which edge of the column under the pointer the dragged one would land on. */
type Side = 'before' | 'after';

/** Where the insertion marker should paint, in viewport coordinates. */
export interface MarkerRect {
  x: number;
  y: number;
  height: number;
}

interface UseColumnDragOptions {
  /** Ordered ids as they appear on screen; index in this array is the slot. */
  order: readonly string[];
  onReorder: (from: number, to: number) => void;
  /**
   * Veto slots the stream will not honour, given the order minus what is in hand.
   *
   * Geometry alone will happily aim between a channel and its pane. The commit
   * already refuses that, so without this the marker advertises a landing the
   * drop then quietly corrects — which reads as the stream spitting the column
   * back out.
   */
  normalizeSlot?: (slot: number, remaining: readonly string[]) => number;
  /** Root to hit-test within. Columns are found by `[data-column]`. */
  rootRef: React.RefObject<HTMLElement | null>;
}

export interface UseColumnDragResult {
  drag: DragState | null;
  /** Attach to the column *header* only. */
  beginDrag: (event: React.PointerEvent, columnId: string, partnerId?: string) => void;
  /** True while a drag just ended — swallow the click it would otherwise fire. */
  consumeSuppressedClick: () => boolean;
  insertAt: number | null;
  /**
   * Where to paint the single insertion marker, or null when no drag is active.
   *
   * One marker that moves, rather than one mounted per slot: a marker that
   * unmounts here and mounts there cannot travel, and blinking between slots is
   * what made the old one read as a flicker rather than as a destination.
   */
  marker: MarkerRect | null;
}

/**
 * Drag a column to a new slot.
 *
 * The header is the only handle. The body is live content — a chat timeline, a
 * board — and hijacking pointerdown there would break text selection inside it.
 *
 * A press only becomes a drag past `DRAG_THRESHOLD` px, so clicking a header to
 * focus a column still works. When a drag does happen, the click that ends it is
 * suppressed, or releasing over a column would also read as "focus this one".
 */
export const useColumnDrag = ({
  order,
  onReorder,
  normalizeSlot,
  rootRef,
}: UseColumnDragOptions): UseColumnDragResult => {
  const [drag, setDrag] = useState<DragState | null>(null);
  /** The dragged nodes — the column, plus its pane when it has one — cached at
   *  drag start so the move handler is not running a DOM query on every frame. */
  const nodesRef = useRef<HTMLElement[]>([]);
  const suppressClickRef = useRef(false);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;

  const orderRef = useRef(order);
  orderRef.current = order;
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;
  const normalizeSlotRef = useRef(normalizeSlot);
  normalizeSlotRef.current = normalizeSlot;

  const beginDrag = useCallback(
    (event: React.PointerEvent, columnId: string, partnerId?: string): void => {
      if (event.button !== 0) return;
      const from = orderRef.current.indexOf(columnId);
      if (from < 0) return;
      // Stops the browser starting a text selection from this press. Focus is
      // handled separately, so nothing is lost by refusing the default here.
      event.preventDefault();
      setDrag({
        columnId,
        ...(partnerId !== undefined && { partnerId }),
        from,
        x: event.clientX,
        y: event.clientY,
        active: false,
        insertAt: null,
        marker: null,
      });
    },
    [],
  );

  /**
   * Resolve the drop slot from the pointer position.
   *
   * Works for both layouts. The strip is a single row, so left-to-right midpoints
   * are enough. The overview is a wrapping grid, where "the first card whose
   * centre is to the right" is wrong the moment the grid wraps — so there, find
   * the card the pointer is actually over (or nearest to) and decide before or
   * after by which half of it the pointer is in.
   *
   * Two things this must not do, both of which it used to:
   *
   * 1. **Measure the dragged column.** `getBoundingClientRect` reports the
   *    *rendered* box, and the dragged card carries a transform that follows the
   *    pointer — so its centre was always the one nearest the pointer, and the
   *    grid resolved every drop back onto the card being dragged. That is the
   *    whole reason a card could never move more than one slot.
   * 2. **Assume DOM order is stream order.** Pinned columns render in their own run
   *    before the scroller, so a stream whose pinned column is not first has a DOM
   *    order that disagrees with `order`. Slots are resolved by *id* now, and the
   *    geometry only picks which column the pointer is next to.
   */
  const resolveInsertAt = useCallback(
    (
      clientX: number,
      clientY: number,
      draggedId: string,
      partnerId?: string,
    ): { slot: number; marker: MarkerRect | null } => {
      const root = rootRef.current;
      if (!root) return { slot: 0, marker: null };

      // Overview first, for the same reason the node lookup prefers it: the strip
      // stays mounted under the overlay, so every card has a hidden twin.
      const cards = root.querySelectorAll<HTMLElement>('[data-column-card]');
      const grid = cards.length > 0;
      const nodes = Array.from(grid ? cards : root.querySelectorAll<HTMLElement>('[data-column]'));
      const key = grid ? 'columnCard' : 'column';

      const entries = nodes
        .map(node => ({ id: node.dataset[key] ?? '', rect: node.getBoundingClientRect() }))
        .filter(entry => entry.id !== '' && entry.id !== draggedId && entry.id !== partnerId);
      // Visual order. Rows first in the grid; a single left-to-right run in the strip.
      entries.sort(
        grid
          ? (a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left
          : (a, b) => a.rect.left - b.rect.left,
      );
      if (entries.length === 0) return { slot: 0, marker: null };

      // The stream without the dragged column. Its indices *are* the values
      // `reorder` wants, because that removes the column before re-inserting it.
      const remaining = orderRef.current.filter(id => id !== draggedId && id !== partnerId);

      let target = entries[entries.length - 1]!;
      let side: Side = 'after';

      if (grid) {
        let bestDistance = Infinity;
        for (const entry of entries) {
          const dx = clientX - (entry.rect.left + entry.rect.width / 2);
          const dy = clientY - (entry.rect.top + entry.rect.height / 2);
          const distance = dx * dx + dy * dy;
          if (distance < bestDistance) {
            bestDistance = distance;
            target = entry;
          }
        }
        side = clientX < target.rect.left + target.rect.width / 2 ? 'before' : 'after';
      } else {
        const hit = entries.find(entry => clientX < entry.rect.left + entry.rect.width / 2);
        if (hit) {
          target = hit;
          side = 'before';
        }
      }

      const index = remaining.indexOf(target.id);
      if (index < 0) return { slot: 0, marker: null };

      const aimed = Math.min(side === 'before' ? index : index + 1, remaining.length);
      const slot = normalizeSlotRef.current?.(aimed, remaining) ?? aimed;

      // The marker follows the *settled* slot, not the aimed one, so what you
      // see is where it lands. On the leading edge of the column it goes before,
      // or the trailing edge of the last one when it goes to the end. Never on
      // the card in the user's hand — `remaining` excludes it.
      const rects = new Map(entries.map(entry => [entry.id, entry.rect]));
      const ahead = remaining[slot];
      const rect = ahead !== undefined ? rects.get(ahead) : undefined;
      const trailing = rect ? undefined : rects.get(remaining[remaining.length - 1] ?? '');
      const edge = rect ?? trailing;

      return {
        slot,
        marker: edge
          ? { x: rect ? edge.left : edge.right, y: edge.top, height: edge.height }
          : null,
      };
    },
    [rootRef],
  );

  useEffect(() => {
    if (!drag) return;

    const onMove = (event: PointerEvent): void => {
      const current = dragRef.current;
      if (!current) return;
      const travelled =
        Math.abs(event.clientX - current.x) + Math.abs(event.clientY - current.y) > DRAG_THRESHOLD;
      if (!current.active && !travelled) return;

      // A pointer drag across a document still runs the browser's native text
      // selection underneath it, which paints a selection over every column the
      // pointer crosses. Suppressing it on the body covers the whole gesture,
      // including the parts spent outside the column that started it.
      if (!current.active) {
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'grabbing';
        // Overview first, for the same reason `resolveInsertAt` prefers it: the
        // strip stays mounted underneath the overlay, so a column being dragged
        // from an overview card has a `[data-column]` twin hidden behind it.
        // Move the wrong one and the drag looks completely dead.
        const root = rootRef.current;
        const find = (id: string): HTMLElement | null =>
          root?.querySelector<HTMLElement>(`[data-column-card="${id}"]`) ??
          root?.querySelector<HTMLElement>(`[data-column="${id}"]`) ??
          null;
        // The pane comes too, so the pair lifts as one card rather than tearing
        // apart the moment the pointer moves.
        const seam =
          current.partnerId !== undefined
            ? (root?.querySelector<HTMLElement>(`[data-seam="${current.columnId}"]`) ?? null)
            : null;
        const found = [current.columnId, current.partnerId]
          .filter((id): id is string => id !== undefined)
          .map(find)
          .filter((node): node is HTMLElement => node !== null)
          .concat(seam ? [seam] : []);
        nodesRef.current = found;

        // `DRAG_SCALE` about each card's own centre would grow the two halves
        // toward each other and open a seam down the middle of a pair. Anchoring
        // both to the pair's shared centre makes the scale act on one box.
        if (found.length > 1) {
          const rects = found.map(node => node.getBoundingClientRect());
          const left = Math.min(...rects.map(rect => rect.left));
          const right = Math.max(...rects.map(rect => rect.right));
          const top = Math.min(...rects.map(rect => rect.top));
          const bottom = Math.max(...rects.map(rect => rect.bottom));
          const centreX = (left + right) / 2;
          const centreY = (top + bottom) / 2;
          found.forEach((node, index) => {
            const rect = rects[index]!;
            node.style.transformOrigin = `${centreX - rect.left}px ${centreY - rect.top}px`;
          });
        }
        // The columns carry `z-30` from `dragging`, but the seam between them is
        // a resize handle with `relative` and no z-index of its own — so it lifted
        // with the pair and then painted *under* every column after it in DOM
        // order. Elevating the node directly keeps it out of React entirely, the
        // same as the transform beside it.
        for (const node of found) {
          node.style.zIndex = '30';
        }
      }
      // Selection started before the threshold was crossed still has to go.
      document.getSelection()?.removeAllRanges();

      // The card follows the pointer by having its transform written straight
      // to the node, not by re-rendering with a new offset. A stream holds several
      // live chat surfaces, and a React commit per pointermove re-renders all of
      // their chrome sixty times a second — the frames that costs are exactly
      // the frames a drag cannot afford to lose. This stays on the compositor.
      if (nodesRef.current.length > 0) {
        const dx = event.clientX - current.x;
        const dy = event.clientY - current.y;
        const transform = `translate(${dx}px, ${dy}px) scale(${DRAG_SCALE})`;
        for (const node of nodesRef.current) node.style.transform = transform;
      }

      // Re-render only when the drop target actually changes. Before this the
      // hook called `setDrag` on every move, which is the same per-frame commit
      // the transform above exists to avoid. The marker rides along in the same
      // update because it only ever moves when the slot does — between slot
      // changes it is parked on the same column edge.
      const { slot, marker } = resolveInsertAt(
        event.clientX,
        event.clientY,
        current.columnId,
        current.partnerId,
      );
      if (current.active && current.insertAt === slot) return;
      setDrag({ ...current, active: true, insertAt: slot, marker });
    };

    const onUp = (): void => {
      const current = dragRef.current;
      const nodes = nodesRef.current;
      // Where the cards are *visually* at the moment of release — transform and
      // all. This is the "First" of the FLIP below, and it has to be read before
      // the transform comes off.
      const before = nodes.map(node => node.getBoundingClientRect());
      // Clear the transform before React re-renders the columns into their new
      // slots. Leaving it set means a card lands correctly in the layout and
      // then paints one frame at its old pointer offset.
      for (const node of nodes) {
        node.style.transform = '';
        node.style.transformOrigin = '';
        node.style.zIndex = '';
      }
      nodesRef.current = [];
      setDrag(null);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      if (!current?.active) return;
      suppressClickRef.current = true;
      // Before the early-out below: a drop that reorders nothing still has to
      // travel back to where it came from. Teleporting there is the same bad
      // ending as teleporting to a new slot.
      nodes.forEach((node, index) => settle(node, before[index] ?? null));
      // `insertAt` is already an index into the stream minus the dragged column,
      // which is the array `reorder` splices into. No correction to apply.
      const { from, insertAt } = current;
      if (insertAt === null || insertAt === from) return;
      onReorderRef.current(from, insertAt);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
    // `rootRef` is a ref object — stable for the component's whole life, so
    // listing it would only add noise. It is read inside the handler, never
    // captured, so there is nothing here to go stale.
  }, [drag, resolveInsertAt, rootRef]);

  const consumeSuppressedClick = useCallback((): boolean => {
    if (!suppressClickRef.current) return false;
    suppressClickRef.current = false;
    return true;
  }, []);

  return {
    drag,
    beginDrag,
    consumeSuppressedClick,
    insertAt: drag?.active ? drag.insertAt : null,
    marker: drag?.active ? drag.marker : null,
  };
};
