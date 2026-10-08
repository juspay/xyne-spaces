import { ReactElement, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '../../../../utils/classNames';
import { COLUMN_CLOSE_MS, STREAMS_EASE } from '../Streams/Streams.types';

export interface ColumnResizeHandleProps {
  /** Current width in pixels, so the drag can work in the same units as the eye. */
  widthPx: number;
  minPx: number;
  maxPx: number;
  onResize: (nextPx: number) => void;
  /**
   * The column this handle resizes, so the drag can write to its node directly.
   *
   * Without it the drag has to go through React for every frame, and a width
   * change is a real change — the resized column genuinely re-renders, chat
   * panel and all, at roughly 85ms a frame. Measured: 24 changes cost 2,055ms
   * blocked through React and 0ms written to the DOM.
   */
  columnId: string;
  /**
   * Set when this gutter is the seam *inside* an attached pair, in which case
   * dragging it redistributes the pair rather than resizing one column: the
   * total stays put and the two halves trade width.
   *
   * The seam stops at each half's minimum and goes no further. It used to give
   * way past the parent's minimum and squeeze it out entirely, which was a real
   * feature and a worse one: the same end state as closing the channel, reached
   * by accident mid-drag, and every consequence of it — a zero-width card still
   * drawing a border, a title that no longer described what you were looking at,
   * a way back nobody could find — needed its own fix. A wall you cannot drag
   * past has none of that.
   */
  pair?: {
    /** The attached half. */
    partnerId: string;
    /** The pane's width now, so the pair's total is known. */
    partnerPx: number;
    /** The pane's own minimum — what this drag must leave it. */
    partnerMinPx: number;
    /**
     * Hand the pane its new width back, the way `onResize` does for this column.
     *
     * A seam drag moves two widths and only ever committed one. The pane's half
     * was written straight to its node for the whole gesture and then dropped on
     * release, so it sprang back to the width it had before the drag while this
     * column kept what it was given — a drag that was meant to trade width
     * between the halves instead grew the pair.
     */
    onPartnerResize: (nextPx: number) => void;
  };
  /** Nudge step for keyboard resizing, in pixels. */
  stepPx?: number;
  /**
   * Keep the gutter, drop the control.
   *
   * This handle is not only a control — its 8px is the *only* spacing between
   * two columns, which is why the strip sets `gap: 0`. So focus mode cannot
   * simply stop rendering it: doing that collapsed every column edge flush
   * against its neighbour. It stays, inert, and goes on being the gutter.
   */
  inert?: boolean;
  /**
   * The column this gutter follows is closing, so it goes with it.
   *
   * It used to be unmounted outright the moment a close began — 8px vanishing in
   * one commit while the column beside it eased away over 200ms. On a lone
   * column that is under the threshold of noticing, which is why it was written
   * that way. On a pane it is not: the gutter sits right against the seam, so
   * the one place you are looking is the one place that snaps.
   */
  collapsing?: boolean;
  /**
   * This gutter runs *inside* an attached pair rather than between two columns.
   *
   * Same 8px, same drag, different reading. Between columns the gap shows the
   * stream's ground through it, which is what separates one card from the next.
   * Inside a pair there is no gap to show — the two halves are one panel — so it
   * carries the card's own surface and draws a single hairline down the middle,
   * the way a split view divides itself.
   */
  seam?: boolean;
}

/**
 * Drag the divider to set a column's width.
 *
 * This replaces a button that cycled ⅓ → ½ → ⅔. The presets came from the
 * keyboard-first reference implementation, where they make sense; as a labelled
 * button in a mouse-driven UI they communicated nothing, and the icon that
 * preceded the label promised full-screen. A divider you can grab is the thing
 * people already expect from every resizable pane in the product.
 *
 * Kept keyboard-operable: it is a real focusable separator with arrow-key
 * support, so width is not a mouse-only capability.
 */
/**
 * How far back past its minimum a squeezed-out column must be dragged before it
 * returns, in px.
 *
 * The gap between the two edges of the latch. Collapse and restore at the same
 * number and the boundary shimmers under an unsteady hand; 40px is wide enough
 * that crossing back is a decision rather than a tremor.
 */

const ColumnResizeHandle = ({
  widthPx,
  minPx,
  maxPx,
  onResize,
  columnId,
  pair,
  stepPx = 32,
  inert = false,
  collapsing = false,
  seam = false,
}: ColumnResizeHandleProps): ReactElement => {
  const [dragging, setDragging] = useState(false);
  const startRef = useRef({ x: 0, width: 0 });
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;
  const boundsRef = useRef({ minPx, maxPx });
  boundsRef.current = { minPx, maxPx };
  const pairRef = useRef(pair);
  pairRef.current = pair;

  const onPointerDown = useCallback(
    (event: React.PointerEvent): void => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      startRef.current = { x: event.clientX, width: widthPx };
      setDragging(true);
    },
    [widthPx],
  );

  useEffect(() => {
    if (!dragging) return;

    // Suppressed on the body, not the handle: the pointer spends the whole drag
    // outside the 6px handle, over live chat content that would otherwise select.
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    // Coalesced to one width per frame.
    //
    // `pointermove` fires faster than the display refreshes — on a trackpad or a
    // 120Hz screen, several times per frame — and each call here rewrites the
    // stream layout, which re-renders every mounted column. Measured before this
    // gate: 24 moves produced 24 layout writes and blocked the main thread for
    // 2.0s of a 4.4s drag, holding the drag at 33fps.
    //
    // Widths the display never showed are worth nothing, so only the newest
    // position each frame is used and the rest are dropped. This is the same
    // treatment `useColumnDrag` already gives the drag itself, for the same
    // reason — that file's note calls a React commit per pointermove "exactly
    // the frames a drag cannot afford to lose".
    let frame = 0;
    let latestX = startRef.current.x;

    // The columns being dragged, resolved once rather than per frame.
    const node = (id: string): HTMLElement | null =>
      document.querySelector<HTMLElement>(`[data-column="${id}"]`);
    const column = node(columnId);
    const seam = pairRef.current;
    const partner = seam ? node(seam.partnerId) : null;

    // The pair's total, fixed for the gesture: a seam drag trades width between
    // the halves, it does not grow the panel.
    const total = seam ? startRef.current.width + seam.partnerPx : 0;

    let committed = startRef.current.width;
    const apply = (): void => {
      frame = 0;
      const { minPx: lo, maxPx: hi } = boundsRef.current;
      const raw = startRef.current.width + (latestX - startRef.current.x);

      if (seam && column && partner) {
        // Walled at both ends: this half never goes under its own minimum, and
        // never takes so much that the other half goes under *its* own. The
        // second clamp used to use this column's minimum for both, which quietly
        // let a pane be squeezed below what its surface needs.
        const self = Math.min(total - seam.partnerMinPx, Math.max(lo, raw));
        committed = self;
        // Both halves, both straight to the DOM. The boundary can be crossed
        // and re-crossed for the whole gesture without one React commit.
        column.style.setProperty('--col-w', `${self}px`);
        partner.style.setProperty('--col-w', `${total - self}px`);
        return;
      }

      const next = Math.min(hi, Math.max(lo, raw));
      committed = next;
      // Straight to the node. No `setState`, so no commit, so no reconciling a
      // live chat panel on a frame the user is watching move.
      if (column) {
        column.style.setProperty('--col-w', `${next}px`);
        return;
      }
      // No node — the column is mid-collapse or not mounted. Fall back to the
      // React path so the drag still works rather than silently doing nothing.
      onResizeRef.current(next);
    };

    const onMove = (event: PointerEvent): void => {
      latestX = event.clientX;
      if (frame) return;
      frame = requestAnimationFrame(apply);
    };

    const onUp = (): void => {
      // Land on the exact pixel released at. Without this the drag can end one
      // frame stale — the last move arrives, schedules, and the pointerup tears
      // the listener down before it runs, so the column keeps a width a few
      // pixels off where the cursor actually stopped.
      if (frame) {
        cancelAnimationFrame(frame);
        apply();
      }
      // Commit *before* dropping the flag, and never clear `--col-w` here. Both
      // matter: React batches these two into one commit, so the re-render lands
      // with the new width and `dragging` false together, and the layout effect
      // below then removes the property in that same commit — before paint.
      // Clearing it here instead would expose the pre-drag React width for a
      // frame, which reads as the column snapping back before it settles.
      // Both halves, in one batch. React groups the setters called here into a
      // single commit, so the two widths and `dragging: false` land together and
      // the layout effect below can clear both nodes on that same commit.
      // Committing only this one left the pair wider than it started.
      if (column) onResizeRef.current(committed);
      if (seam && column && partner) pairRef.current?.onPartnerResize(total - committed);
      // Deliberately NOT removing `--col-w` here. The layout effect owns that for
      // both nodes, and it runs after React's widths have caught up; clearing the
      // pane's here instead uncovered its pre-drag width for a frame, which is
      // the snap-back this fix is about.
      setDragging(false);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (frame) cancelAnimationFrame(frame);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [dragging, columnId]);

  /**
   * Hand the width back to React once its state has caught up.
   *
   * Runs on the commit where `dragging` went false and `widthPx` arrived at the
   * dragged value — the same commit, because `onUp` calls both setters
   * synchronously. Removing the property there is invisible: the fallback it
   * uncovers is already the identical number. A layout effect rather than an
   * effect so it lands before paint.
   */
  const partnerId = pair?.partnerId;
  useLayoutEffect(() => {
    if (dragging) return;
    document
      .querySelector<HTMLElement>(`[data-column="${columnId}"]`)
      ?.style.removeProperty('--col-w');
    // The pane too. It is a different node from the one this handle is named
    // for, and it is the one that survives a collapse — so a property left on
    // it would outlive the column that wrote it.
    if (partnerId !== undefined) {
      document
        .querySelector<HTMLElement>(`[data-column="${partnerId}"]`)
        ?.style.removeProperty('--col-w');
    }
    // `partnerPx` is in the deps for the same reason `widthPx` is: the property
    // must not come off until React's own value for that node has arrived.
  }, [dragging, widthPx, columnId, partnerId, pair?.partnerPx]);

  const nudge = (delta: number): void => {
    onResizeRef.current(Math.min(maxPx, Math.max(minPx, widthPx + delta)));
  };

  // Purely the gutter: no role, no tab stop, no handlers, nothing to hover. It
  // still occupies its 8px, which is the entire reason it is still here.
  if (inert || collapsing)
    return (
      <div
        aria-hidden
        // Still paints the seam. This branch drops the *control* — focus mode
        // computes widths from the viewport, so dragging here would fight a
        // value rewritten on the next render — and it used to drop the paint
        // with it. A pair in focus mode therefore had a literal 8px hole in it
        // where every other mode has a filled seam: not a border, a gap with the
        // page showing through.
        className={cn(
          'relative shrink-0 self-stretch overflow-hidden border-y',
          seam ? 'border-border bg-background' : 'border-transparent bg-transparent',
        )}
        style={{
          width: collapsing ? 0 : 8,
          transition: `width ${COLUMN_CLOSE_MS}ms ${STREAMS_EASE}`,
        }}
      >
        {/* The rule itself. Last round gave this branch the fill and the top and
            bottom borders, which closed the hole in the pair — and stopped
            there, so the two halves then butted together with nothing between
            them. The hairline is the part that actually separates them; the fill
            only stops the page showing through. */}
        {seam && (
          <span
            aria-hidden
            className='absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border'
          />
        )}
      </div>
    );

  return (
    <div
      // `slider`, not `separator`: this carries a continuous value that arrow
      // keys adjust, which is what a slider is. `separator` is the splitter role
      // but is non-interactive, so it would misdescribe a focusable control.
      role='slider'
      aria-orientation='vertical'
      aria-label='Resize column'
      aria-valuenow={Math.round(widthPx)}
      aria-valuemin={Math.round(minPx)}
      aria-valuemax={Math.round(maxPx)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={event => {
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          nudge(-stepPx);
        }
        if (event.key === 'ArrowRight') {
          event.preventDefault();
          nudge(stepPx);
        }
      }}
      className={cn(
        'group/resize relative w-2 shrink-0 self-stretch',
        'cursor-col-resize',
        'focus-visible:outline-none',
        // Paints the pair continuous. Without this the 8px is a window onto the
        // wallpaper, and no amount of squared corners either side will stop two
        // panes with daylight between them reading as two cards.
        //
        // The top and bottom borders matter as much as the fill: the two halves
        // each draw their own, and between them sits this 8px, so without a
        // border here the pair's outline has a notch bitten out of it top and
        // bottom — a small break exactly where the eye expects one unbroken
        // rule. This is the piece that completes the box.
        // `bg-background`, not `bg-card`: the seam sits between two halves that
        // both paint `bg-background`, so a card fill reads as a lighter bar down
        // the middle of the pair. Invisible in the light theme, where the two
        // tokens are the same white.
        //
        // Always drawn, only ever recoloured. Toggling `border-y` and the fill
        // on and off changes border-*width*, which cannot tween — so the seam
        // popped out of existence a beat after the pane finished closing. Held
        // at 1px and faded between transparent and the real colour, it leaves on
        // the same clock as everything else. The curve is set inline below, not
        // by `transition-colors`, whose default easing is not the stream's.
        'border-y',
        seam ? 'border-border bg-background' : 'border-transparent bg-transparent',
      )}
      // Named by the parent it seams, so a pair being dragged can pick this up
      // and lift it too. It is a sibling of both halves rather than a child of
      // either, so nothing else carries it — left behind it reads as a stray
      // border standing in the empty slot, and the pair in your hand shows
      // daylight down the middle it does not have at rest.
      // Same duration *and* same curve as the pane's width, which is the whole
      // point. `STREAMS_EASE` is a hard ease-out: the pane is most of the way
      // gone in the first ~60ms, so a colour fade on any gentler curve was still
      // half-opaque once the pane had visually left — the border outliving the
      // thing it was separating. Matched, they land together.
      style={{
        transition: `background-color ${COLUMN_CLOSE_MS}ms ${STREAMS_EASE}, border-color ${COLUMN_CLOSE_MS}ms ${STREAMS_EASE}`,
      }}
      data-seam={seam ? columnId : undefined}
      data-track-category='Streams'
      data-track-name='ResizeColumn'
    >
      {/* Thin by default, thick and coloured while grabbed — the hit area stays
          8px wide regardless so it is not a pixel hunt. */}
      <span
        aria-hidden
        className={cn(
          'absolute inset-y-0 left-1/2 -translate-x-1/2 transition-colors',
          // A hairline when it is a divider, a 2px pill when it is a grab
          // target: the seam is structure and should read as a rule, while the
          // handle between columns only appears under the pointer and wants to
          // look grabbable when it does.
          seam ? 'w-px' : 'w-0.5 rounded-full',
          dragging
            ? 'bg-primary'
            : seam
              ? // Always visible inside a pair — it is the divider, not just a
                // grab target, and a split view with no line down it looks like
                // one pane that has gone wrong rather than two that are correct.
                'bg-border group-hover/resize:bg-primary/50 group-focus-visible/resize:bg-primary'
              : 'bg-transparent group-hover/resize:bg-primary/50 group-focus-visible/resize:bg-primary',
        )}
      />
    </div>
  );
};

ColumnResizeHandle.displayName = 'ColumnResizeHandle';

export default ColumnResizeHandle;
