import { ReactElement, memo, useCallback, useLayoutEffect, useMemo, useState } from 'react';
import {
  ArrowRightUp,
  FocusTarget,
  LayoutGridTwoVertical,
  MultipleCrossCancelDefault,
  PinDefault,
} from '@xyne/icons';
// The stream header's focus button already wears this mark. Same verb, same icon,
// even though the rest of this header's controls come from lucide — matching the
// *verb* across the two places it lives beats matching the icon family within one
// row, because the two buttons do the identical thing to the identical state.
import { Tooltip } from '../../ui/Tooltip/Tooltip';
import StreamRouterScope from './StreamRouterScope';
import { ActivityDot } from './ActivityDot';
import { columnIntentFor } from '../utils/columnIntent';
import { isUnread } from '../hooks/useColumnActivity';
import type { StreamsActions } from './StreamsActions';
import { DEV_DEFAULTS } from './StreamsDev';
import { surfaceFor } from './surfaces';
import { hasDragItem, readDragItem, type StreamItem } from '../utils/streamsDnd';
import { cn } from '../../../utils/classNames';
import { prefersReducedMotion } from '../utils/Streams.utils';
import type { ColumnActivity } from '../hooks/useColumnActivity';
import {
  COLUMN_CLOSE_MS,
  COLUMN_OPEN_MS,
  FOCUS_EASE,
  FOCUS_PEEK,
  STREAMS_EASE,
} from '../utils/Streams.types';
import type { Column, ColumnSeed } from '../utils/Streams.types';

/**
 * The focus ring, as a box-shadow that changes *spread* rather than opacity.
 *
 * Two columns crossfading their rings read as flat: for the length of the
 * transition both look half-focused, and nothing about it says which way focus
 * went. Animating the spread instead gives the ring somewhere to come from.
 *
 * It grows *out of* the column — from zero spread, flush against the border, to
 * its full 2px — and retracts back into the edge on the way out. The ring
 * belongs to the column, so that is the only direction that reads as physical.
 * The first attempt had it materialise 7px out and rush inward, which looked
 * like something arriving from off-screen and landing hard.
 *
 * A box-shadow rather than an overlay element, because the column clips its own
 * overflow and the ring has to paint *outside* the border box. It is a paint
 * property, not a layout one, and it is the property this element already
 * transitioned — so this changes what the animation says, not what it costs.
 *
 * Both states must carry the same number of shadows or the browser cannot
 * interpolate between them and snaps instead. That is why "no shadow" is spelled
 * as a transparent shadow rather than as `none`.
 */
const RING_HELD = 2;
const RING_RELEASED = 0;
const CARD_SHADOW = '0 4px 6px -1px rgb(0 0 0 / 0.10), 0 2px 4px -2px rgb(0 0 0 / 0.10)';
const CARD_SHADOW_OFF = '0 4px 6px -1px rgb(0 0 0 / 0), 0 2px 4px -2px rgb(0 0 0 / 0)';
const DRAG_SHADOW = '0 24px 50px -12px rgb(0 0 0 / 0.28), 0 2px 4px -2px rgb(0 0 0 / 0.10)';

/** Arriving settles; leaving gets out of the way. Both well under 300ms. */
const RING_IN_MS = 220;
const RING_OUT_MS = 130;

export interface StreamColumnProps {
  column: Column;
  width: number;
  /** Mid-collapse: on its way out of the stream, not interactive. */
  closing: boolean;
  /**
   * Newly created, and still playing its entrance.
   *
   * Supplied by the stream rather than derived from mount, because *every* column
   * mounts — on page load, on a stream switch, on re-entering the tab. Animating
   * all of those would open a twelve-column stream like a concertina. Only a
   * column that just came into existence should arrive.
   */
  opening: boolean;
  focused: boolean;
  /** Briefly lit, to answer "where is it" when you asked for one you already have. */
  flash: boolean;
  /** Supplied by the stream, which owns one activity map for every column. */
  activity: ColumnActivity;
  /**
   * What this column's surface may do to the stream around it.
   *
   * Supplied by the stream and passed straight through to `Body`. One stable
   * object for every column, so handing it down costs no extra render.
   */
  actions: StreamsActions;
  dragging: boolean;
  workspaceId: string;
  onFocus: () => void;
  /** Whether the stream is currently showing one column at a time. */
  focusMode: boolean;
  /**
   * Focus mode, aimed at this column.
   *
   * Three cases, and the stream resolves which: from the wide stream it enters focus
   * mode *on this column*; in focus mode on another column it travels here
   * without leaving; on the column already being shown it goes back to the stream.
   */
  onToggleFocus: () => void;
  /**
   * This column continues into the one on its right — they are an attached pair
   * drawn as a single split panel. Squares the right corners and drops the right
   * border so the seam between them is the gutter's line and nothing else.
   */
  joinRight?: boolean;
  /** As `joinRight`, for the attached half of the pair. */
  joinLeft?: boolean;
  /**
   * Break this column out of its pair, making it stand alone. Present only on an
   * attached column — a standalone one has nothing to detach from.
   */
  onDetach?: () => void;
  /** Attach to the header only — the body is live content. */
  onDragHandleDown: (event: React.PointerEvent) => void;
  onClose: () => void;
  onTogglePin: () => void;
  onOpenInApp: () => void;
  /** Clear this column's badge — the badge itself is the control. */
  onClearActivity: () => void;
  /** Something dropped here, on its way into the surface. */
  seed?: ColumnSeed | undefined;
  /** Take a conversation dragged from elsewhere in the stream. */
  onDropItem: (item: StreamItem) => void;
  /**
   * Take the whole scroller, less a sliver of the next column.
   *
   * Expressed as a percentage rather than a measured pixel width, and that is a
   * correctness fix rather than a tidy-up. The measured version read the strip's
   * width from a `ResizeObserver` — but the rail *shrinks the strip* as it slides
   * in, so the column grew to the pre-rail width first and then shrank back by
   * the rail's 208px once it landed. Two moves where the user asked for one, and
   * the second one backwards.
   *
   * A percentage resolves against the flex container's content box every frame,
   * which for an overflow scroller is the scrollport. So it simply tracks the
   * rail instead of racing it, and no measurement is involved at all.
   */
  fill: boolean;
  /**
   * This column's share of the focus-mode page, 0–1. One unless it is half of
   * an attached pair, in which case the two halves split the page between them
   * in proportion to the widths they have in the wide stream.
   *
   * A pair is one *page* in focus mode, not two. Paging between a channel and
   * the thread you opened out of it would be the stream taking a panel you had
   * deliberately put side by side and making you flip between the halves —
   * which is the modal behaviour the whole attachment model exists to avoid.
   */
  fillShare?: number;
  /**
   * Grow this column's scroll-snap area by this many pixels to its right.
   *
   * Set on the parent of a pair in focus mode, to the width of the pane plus the
   * seam. Scroll-snap aligns a column's *snap area*, and the area defaults to the
   * border box — so once a pane opened, the parent was half a page wide and the
   * browser centred that half, shoving the pane off the right edge and pulling
   * the previous column into view. No amount of scrolling in JS survives that:
   * the snap re-runs after every scroll and wins.
   *
   * CSS has no way to snap a *group*, but `scroll-margin` outsets the snap area,
   * so extending the parent's rightward by the pane makes the pair one snap
   * target and `snap-center` centres the pair.
   */
  snapExtendPx?: number;
  /**
   * The width to hold the content at while this column is squeezed out, in px.
   *
   * Present only when collapsed. The column's own box goes to zero, but its
   * surface stays mounted at the size it will come back to, clipped — so the
   * channel keeps its scroll position, its subscriptions and its composer
   * draft, and returning is a reveal rather than a reload. Letting the content
   * reflow to zero instead would relayout a live chat panel twice per collapse
   * for the privilege of not being able to see it.
   */

  /**
   * How long a width change should take, in ms. Zero at rest — a resize drag
   * rewrites the width every frame and must stay glued to the cursor — and
   * `FOCUS_MS` only while the stream is changing focus mode.
   */
  widthMs: number;
  /**
   * Make this column a stop on the carousel.
   *
   * Focus mode is not "one column is wider" — it is one column *at a time*. Snap
   * points are what turn a free-panning strip into paging: the scroller can only
   * come to rest with a column centred, so a flick lands on a column rather than
   * halfway between two.
   */
  snap: boolean;
}

/**
 * One column: Streams' own chrome wrapped around a host surface.
 *
 * The chrome carries only verbs that belong to the *layout* — focus, pin, close —
 * plus an escape to the app proper. Width is set by dragging the column's edge,
 * which is a better control than a button and leaves the header one item lighter. Verbs that belong to the *entity* (leave
 * channel, archive, mute) stay in the surface's own menu: a menu that is nearly
 * the host's is worse than no menu at all.
 *
 * Closing is view-only. It removes the column from the stream and touches nothing
 * else — closing a channel must never read as leaving the channel.
 */
const StreamColumn = ({
  column,
  width,
  closing,
  opening,
  focused,
  flash,
  activity,
  actions,
  dragging,
  workspaceId,
  onFocus,
  focusMode,
  onToggleFocus,
  joinRight = false,
  joinLeft = false,
  onDetach,
  onDragHandleDown,
  onClose,
  onTogglePin,
  onOpenInApp,
  onClearActivity,
  seed,
  onDropItem,
  fill,
  fillShare = 1,
  snapExtendPx = 0,
  snap,
  widthMs,
}: StreamColumnProps): ReactElement => {
  const surface = surfaceFor(column.source);
  const dev = DEV_DEFAULTS;
  const { openBeside } = actions;
  const { Title, Body, icon: Icon } = surface;
  const hasActivity = isUnread(activity);

  // Two paints are what an entrance costs: one at zero so there is a value to
  // animate *from*, then the real width. A single render straight to the target
  // is exactly what "it just spawns in place" was — the browser has nothing to
  // interpolate between when a property arrives already at its final value.
  const [entered, setEntered] = useState(!opening);
  useLayoutEffect(() => {
    if (entered) return undefined;
    // `requestAnimationFrame` rather than a plain effect: the zero width has to
    // reach the compositor before the target is written, and effects can be
    // batched into the same frame as the mount.
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, [entered]);

  const arriving = opening && !entered;

  const lit = focused && dev.focusRing;
  // Reduced motion keeps the ring, drops the travel: it lands at its final
  // spread and only the colour changes. The signal survives, the movement goes.
  const released = prefersReducedMotion() ? RING_HELD : RING_RELEASED;
  const ringShadow = lit
    ? `0 0 0 ${RING_HELD}px hsl(var(--primary) / 0.4)`
    : `0 0 0 ${released}px hsl(var(--primary) / 0)`;

  /**
   * The surface, held across renders it does not care about.
   *
   * This is the single most expensive thing in the stream and it was being rebuilt
   * constantly. `StreamColumn` is wrapped in `memo`, but the strip passes it
   * eight inline arrow props — `onClose={() => closeColumn(column.id)}` and
   * friends — each a fresh function identity on every render, so the memo
   * comparison never once returned true. Any change to stream state therefore
   * re-rendered *every* column, and since `ConversationPanelV2` is not memoised
   * either, that meant reconciling every open chat panel in the stream.
   *
   * Which is why the stream stutters whenever anything happens: opening a thread,
   * moving focus, one frame of a resize drag, an unread count arriving. Each one
   * reconciles N chat panels, and with a live channel that is long enough to
   * blow the frame budget several times over.
   *
   * Memoising here does not fix the wasted `StreamColumn` renders — that wants
   * the callbacks stabilised — but it stops those renders reaching the part that
   * costs anything. The chrome is cheap; the panel is not.
   */
  const body = useMemo(
    () => (
      <Body
        source={column.source}
        focused={focused}
        columnId={column.id}
        seed={seed}
        actions={actions}
      />
    ),
    [Body, column.source, column.id, focused, seed, actions],
  );

  /**
   * The surface tried to go somewhere. Decide whether that is a new column.
   *
   * `true` means "handled — leave the column's own URL alone", so a recognised
   * destination opens beside this column and this one stays exactly as it was.
   * Anything unrecognised returns `false` and navigates in place, which is what
   * every column did before item columns existed.
   */
  const onEscape = useCallback(
    (path: string): boolean => {
      const intent = columnIntentFor(path, column.source);
      if (!intent) return false;
      openBeside(column.id, intent);
      return true;
    },
    [column.id, column.source, openBeside],
  );

  /**
   * The surface plus its private router, memoised as one unit.
   *
   * The scope has to be inside the memo rather than wrapped around it: a fresh
   * `children` element on every render re-renders everything below the scope,
   * which is the whole subtree this exists to protect.
   */
  const mounted = useMemo(
    () => (
      <div className='h-full duration-150 animate-in fade-in-0 motion-reduce:animate-none'>
        {surface.needsRouterScope ? (
          <StreamRouterScope
            initialPath={surface.scopePath(column.source, workspaceId)}
            params={surface.scopeParams(column.source, workspaceId)}
            onEscape={onEscape}
          >
            {body}
          </StreamRouterScope>
        ) : (
          body
        )}
      </div>
    ),
    [surface, column.source, workspaceId, onEscape, body],
  );

  // Whether a drag is currently hovering this column. Local, because it changes
  // several times a second while a drag crosses the stream and nothing outside
  // this column has any use for it.
  const [over, setOver] = useState(false);
  const takesConversations = surface.accepts?.('conversation') ?? false;

  const onDragOver = (event: React.DragEvent): void => {
    if (!takesConversations || !hasDragItem(event.dataTransfer)) return;
    // Preventing the default is what *makes* an element a drop target. Without
    // it the browser refuses the drop and shows the "no entry" cursor, however
    // much the element looks like it is offering to take something.
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setOver(true);
  };

  const onDragLeave = (event: React.DragEvent): void => {
    // `dragleave` also fires every time the pointer crosses into a *child*, so
    // the naive version flickers the whole overlay as the drag moves across the
    // panel. The related target is where the pointer went; if that is still
    // inside this column, the drag has not left anything.
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setOver(false);
  };

  const onDrop = (event: React.DragEvent): void => {
    setOver(false);
    if (!takesConversations) return;
    const item = readDragItem(event.dataTransfer);
    if (!item) return;
    event.preventDefault();
    onDropItem(item);
  };

  // The header is the drag handle, so its own buttons must not start a drag.
  const stopDrag = (event: React.PointerEvent): void => event.stopPropagation();

  // Controls reveal on hovering *the column*, not just its 36px header — the
  // header is a small target to have to find first. The focused column keeps
  // them out permanently: it is the one you are acting on, and having its
  // controls flicker in and out as the pointer crosses the boundary is noise.
  // Pinned counts as held open, same as focused.
  //
  // A pinned column draws its pin in the accent colour at rest — that is the
  // whole point, it says "this one stays". With the rest of the row hidden until
  // hover, that left a single coloured icon floating against empty header with
  // nothing to belong to, reading as a rendering fault rather than as a state.
  // A row of controls is a group; showing one member of it is worse than showing
  // none.
  const controlsShown = focused || column.pinned === true;
  const controls = cn(
    'streams-press shrink-0 rounded-md p-1.5 text-muted-foreground',
    'hover:bg-accent hover:text-foreground focus-visible:opacity-100',
    controlsShown ? 'opacity-100' : 'opacity-0 group-hover/column:opacity-100',
  );

  // Not `focusMode` alone: in focus mode every column still renders, and a
  // neighbour peeking in at the edge of the scroller would claim the posture for
  // a column that is not the one being shown.
  const held = focusMode && focused;

  // Declared once and placed at whichever end the dial names. Written out twice
  // in the row instead, the two copies drift the moment one of them is touched
  // — and the whole point of the dial is to keep flipping between them.
  //
  // Absent on a pane, because a pane has no page of its own to focus. Focus
  // takes a column full-width; half of a pair cannot go full-width without
  // evicting the other half, which is why `onToggleFocus` already resolves both
  // halves to the parent. Two buttons in one box offered a choice the stream
  // could not honour. Detach it and it becomes a page, and gets one back.
  const focusButton =
    column.attachedTo !== undefined ? null : (
      <Tooltip
        content={held ? 'Exit focus mode' : 'Enter focus mode'}
        side='bottom'
        className='pointer-events-none'
        sideOffset={6}
      >
        <button
          type='button'
          onClick={onToggleFocus}
          onPointerDown={stopDrag}
          aria-label={held ? 'Exit focus mode' : 'Enter focus mode'}
          aria-pressed={held}
          className={cn(
            'streams-press shrink-0 rounded-md p-1.5',
            held ? 'text-primary opacity-100 hover:bg-primary/10' : controls,
            // On the left it is one of a pair with the button before it, not a third
            // item in the row: the header's own `gap-2` reads as a separator between
            // unrelated things, and two adjacent icon buttons should sit at the
            // `gap-1` the group on the right already uses. -4px on top of 8 is that.
            dev.focusSide === 'left' && '-ml-1',
          )}
          data-track-category='Streams'
          data-track-name='FocusColumn'
        >
          <FocusTarget size={14} />
        </button>
      </Tooltip>
    );

  return (
    <section
      className={cn(
        // `relative` unconditionally, so the drop ring below has something to
        // anchor to. Safe to add: with `z-index: auto` it establishes no
        // stacking context, so the drag lift's own `z-30` still means what it did.
        // No `rounded-*` and no `border` class: both are dialled, and a class
        // would win over the inline style for the radius while the border width
        // has to actually go to zero rather than just turn transparent — a 1px
        // transparent edge still occupies layout, so eight columns would keep
        // eight columns' worth of phantom gutter.
        // `bg-background`, not `bg-card`. Every surface a column hosts paints
        // `bg-background` itself, so a card-coloured shell shows through as a
        // lighter strip behind the header — the one band of the column the
        // surface does not cover. Invisible in the light theme, where `--card`
        // and `--background` are both `0 0% 100%`, and 4 points of lightness
        // apart in the dark one, which is why it only ever showed there.
        'group/column relative flex h-full shrink-0 flex-col overflow-hidden bg-background',
        // Centre rather than start: every column is the same width in focus mode
        // and a sliver of the neighbours shows on both sides, which is what says
        // the stream continues in both directions.
        snap && 'snap-center',
        // The focused column is marked, the rest are left alone. Dimming them was
        // tried and dropped: in a view whose entire purpose is watching several
        // things at once, fading all but one of them fights the feature.
        //
        // The ring paints outside the border box, so the strip carries padding to
        // give it room — an inset ring reads as a heavy double border instead.
        // The ring itself is a box-shadow written below, not `ring-2` — see
        // `ringShadow`. Only the border colour is a class.
        // Flat mode still shows the focus ring — that is state, not decoration,
        // and it is a box-shadow rather than the border anyway.
        focused && dev.focusRing ? 'border-primary' : 'border-border',
        // "It is already open, and it is right here." Only ever runs in response
        // to a direct request for a column that already exists, so it is an
        // answer rather than an interruption.
        flash && 'streams-column-flash',
        // Lifted, not dimmed. The card follows the pointer now, so it is the
        // thing you are holding — it should read as picked up off the surface.
        // No transition on `transform` here: `useColumnDrag` writes it directly
        // every frame, and easing toward a target that moves every frame is how
        // a drag ends up lagging the cursor.
        // `relative` is load-bearing, not decoration: `z-30` does nothing on a
        // statically-positioned element, so without it the card being dragged
        // paints *under* every column that follows it in the strip.
        dragging && 'relative z-30 cursor-grabbing',
        closing && 'pointer-events-none',
      )}
      style={{
        // Per-corner rather than one radius, because a column in an attached
        // pair is half a box: the side that continues into its neighbour has to
        // be square, or the pair reads as two cards touching instead of as one
        // panel with a divider down it.
        borderTopLeftRadius: joinLeft ? 0 : dev.columnRadius,
        borderBottomLeftRadius: joinLeft ? 0 : dev.columnRadius,
        borderTopRightRadius: joinRight ? 0 : dev.columnRadius,
        borderBottomRightRadius: joinRight ? 0 : dev.columnRadius,
        // Zero in flat mode, so the columns read as panes of one surface rather
        // than as cards on it. The width is what changes, not just the colour:
        // see the note on the class list.
        borderTopWidth: dev.columnBorders ? 1 : 0,
        borderBottomWidth: dev.columnBorders ? 1 : 0,
        // Dropped entirely on a joined edge. Keeping it would put two 1px lines
        // either side of the gutter — a double rule where the design calls for
        // a single seam, which the gutter itself draws.
        borderLeftWidth: dev.columnBorders && !joinLeft ? 1 : 0,
        borderRightWidth: dev.columnBorders && !joinRight ? 1 : 0,
        borderStyle: 'solid',
        // Positive: `scroll-margin` *adds* outsets to the snap area, so this
        // grows it rightward over the pane rather than trimming it.
        ...(snapExtendPx > 0 && { scrollMarginRight: `${snapExtendPx}px` }),
        // A percentage in focus mode, so the width tracks the rail sliding in
        // rather than being measured against a strip the rail is still shrinking.
        // See the `fill` prop.
        // A fixed pixel target while the transition runs, the percentage only
        // at rest. Both resolve to the same number, so the handover at the end
        // is invisible — but a percentage *during* the tween is a target that
        // moves whenever anything else on the row resizes, and that is what
        // made the column overshoot and come back.
        // The page, less the peek at the next column, less the 8px gutter a pair
        // spends on its seam — then split by share. At `fillShare` 1 the gutter
        // term is the separation to the next page and comes out of the peek
        // anyway, so a lone column lands where it always did.
        width:
          closing || arriving
            ? 0
            : fill
              ? // `peek` is the sliver of the next column left showing at the
                // page edge. Dialled to zero the focused page is the whole
                // width, and focus mode stops hinting that there is a stream
                // around it.
                (peek =>
                  fillShare === 1
                    ? `calc(100% - ${peek}px)`
                    : `calc((100% - ${peek}px - 8px) * ${fillShare})`)(
                  dev.focusPeek ? FOCUS_PEEK : 0,
                )
              : // `var(--col-w, …)` is what keeps a resize drag off the React
                // path entirely. `ColumnResizeHandle` writes `--col-w` straight
                // onto this node once per frame, so the width the eye follows
                // never goes through a commit; React's `width` stays the
                // fallback and takes over the moment the drag commits and the
                // property is removed.
                //
                // Measured by S-3add: 24 width changes cost 0ms blocked written
                // to the DOM, against 2,055ms and 25 long tasks through React —
                // because a width change is a *real* change, so the resized
                // column legitimately re-renders, and one un-memoised chat panel
                // re-render is ~85ms.
                //
                // Deliberately NOT registered via `@property`. A registered
                // `<length>` becomes animatable and can pick up the `width`
                // transition below; unregistered, it is substituted as a raw
                // token and stays inert.
                `var(--col-w, ${width}px)`,
        ...(fill && !closing && !arriving && { minWidth: `${surface.minWidth}px` }),
        ...(closing && { opacity: 0, minWidth: 0 }),
        ...(arriving && { opacity: 0, minWidth: 0 }),
        boxShadow: `${ringShadow}, ${dragging ? DRAG_SHADOW : lit ? CARD_SHADOW : CARD_SHADOW_OFF}`,
        // A lifted pair is one card, so it casts one shadow — but it is drawn by
        // two boxes, and `DRAG_SHADOW` has a 50px blur, so each half was throwing
        // ~25px of it sideways into the 8px seam. Two shadows meeting in the
        // middle is a dark band down the centre of something that should read as
        // solid.
        //
        // Clipping flush at the joined edge and 120px past the other three keeps
        // every outward shadow and removes only the pair's own interior. Gated on
        // `dragging` because a clip also clips overflow — a menu opened from this
        // header would be cut off — and nothing is open mid-drag.
        ...(dragging &&
          (joinLeft || joinRight) && {
            clipPath: joinLeft ? 'inset(-120px -120px -120px 0)' : 'inset(-120px 0 -120px -120px)',
          }),
        // `width` is in the transition list at 0ms even at rest, and only its
        // *duration* changes when the column closes. Adding the property and
        // changing the value in one commit is the case where a browser is
        // entitled to skip the transition entirely — changing a duration on a
        // property that was already declared is not.
        //
        // 0ms at rest is what keeps the resize drag honest: that writes a new
        // width every frame, and easing toward a target that moves every frame
        // is how a resize handle ends up trailing the cursor.
        //
        // `transform` is deliberately absent — the drag writes it directly.
        transition: [
          `opacity 150ms ${STREAMS_EASE}`,
          `border-color ${lit ? RING_IN_MS : RING_OUT_MS}ms ${STREAMS_EASE}`,
          // Asymmetric, and the direction is the point: the ring arriving is a
          // thing settling into place, the ring leaving is a thing letting go.
          `box-shadow ${lit ? RING_IN_MS : RING_OUT_MS}ms ${STREAMS_EASE}`,
          // Closing wins, then whatever the stream asked for, then zero.
          // Closing wins, then opening, then whatever the stream asked for, then
          // zero. Opening cannot use `widthMs` — that is 0 at rest, which is the
          // whole reason a freshly inserted column snapped to size.
          `width ${closing ? COLUMN_CLOSE_MS : opening ? COLUMN_OPEN_MS : widthMs}ms ${
            closing ? STREAMS_EASE : FOCUS_EASE
          }`,
          // The corners square off when a pane arrives and round back when it
          // leaves, and both used to be instant — a snap landing *after* the
          // pane had finished shrinking, which is what made one event read as a
          // sequence. On the close clock they round back *while* the pane goes,
          // so the box reforms in the same gesture that empties it.
          `border-radius ${COLUMN_CLOSE_MS}ms ${STREAMS_EASE}`,
          `border-color ${COLUMN_CLOSE_MS}ms ${STREAMS_EASE}`,
        ].join(', '),
      }}
      data-column={column.id}
      onPointerDownCapture={onFocus}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* No divider and no fill, matching the full-screen channel view. The
          column's own border encloses this already, and focus is carried by the
          ring plus the always-visible controls — a tinted header on top of those
          is a third signal for one piece of state. */}
      <header
        // 40px tall on a 12px inset, matching the screen header above it. At
        // h-9/px-2.5 the title sat 10px from a border it was already crowding,
        // and with the pin and three controls on the same row the whole bar read
        // as packed rather than composed. The column body is dense by nature —
        // its chrome is the one place that can afford air.
        className='flex h-10 shrink-0 cursor-grab select-none items-center gap-2 px-3 active:cursor-grabbing'
        data-column-header={column.id}
        // `opening`, not `arriving`: the pin has to hold for the whole entrance,
        // not just the zero-width frame that starts it. Pinned only on the first
        // frame — which is what this was — the header is then free to reflow on
        // every one of the ~14 frames that follow, which is most of why the
        // animation stuttered instead of gliding.
        //
        // `closing` for the same reason in the other direction. The exit had no
        // pin at all, so a column being unlinked or closed re-wrapped its own
        // title on every frame while the box shrank underneath it.
        style={opening || closing ? { width: `${width}px` } : undefined}
        onPointerDown={onDragHandleDown}
      >
        {/* Full-strength, not muted. The icon is the only thing in the header
            that says *what kind* of column this is — a thread, a ticket, a file
            — so it carries as much as the title does. Greyed, it read as
            decoration sitting in front of the label rather than as half of it. */}
        <Icon className='size-3.5 shrink-0 text-foreground' aria-hidden />

        {/* Weight tracks activity, never focus. Toggling between semibold and
            medium changes the text's measured width, which reflows the header —
            visible as a jump on the leftmost column, where there is no scroll to
            absorb it. Everything in this header keeps a constant footprint. */}
        <span
          className={cn(
            'min-w-0 truncate text-base tracking-[-0.32px]',
            // Matches the sidebar: a channel with something new reads heavier.
            hasActivity ? 'font-semibold' : 'font-medium',
          )}
        >
          {/* `joinLeft`, not `attachedTo`: the title says "Thread" when the
              channel is sitting right there wearing its own name, and
              "Thread · engineering" when it is not. Squeeze the channel out and
              the pane is, to the eye, a standalone column — so it has to start
              carrying its origin, exactly as it does when detached. */}
          {column.title ?? (
            <Title source={column.source} attached={column.attachedTo !== undefined && joinLeft} />
          )}
        </span>

        {/* Two tiers, both static. Motion in the periphery is the single most
            attention-capturing thing in a UI, and a stream is six peripheries at
            once — so a column that needs you says so by colour and number, never
            by moving.

            Shown on the focused column too. Focus means "the one the keyboard
            drives", not "the one you have read" — you can be parked on a column
            for an hour while it fills up, and hiding the badge there removed the
            signal from exactly the column you were watching. */}
        {hasActivity && (
          <button
            type='button'
            onClick={onClearActivity}
            onPointerDown={stopDrag}
            title={
              activity.count > 0
                ? `${activity.count} needing you — click to clear`
                : 'New since you last looked. Click to clear'
            }
            aria-label='Mark this column read'
            className='streams-press flex shrink-0 items-center rounded-full'
            data-track-category='Streams'
            data-track-name='ClearColumnActivity'
          >
            <ActivityDot activity={activity} />
          </button>
        )}

        {/* Next to the title, where the pin used to be: this is the verb that
            acts on *what the column is showing*, so it belongs beside the thing
            it would open rather than in the group that acts on the column.

            Only for surfaces that have a page. A feed lives in the stream and
            nowhere else, so it gets no exit to a place that does not exist. */}
        {surface.appPath && (
          <Tooltip
            content='Go to page'
            side='bottom'
            className='pointer-events-none'
            sideOffset={6}
          >
            <button
              type='button'
              onClick={onOpenInApp}
              onPointerDown={stopDrag}
              aria-label='Go to page'
              className={controls}
              data-track-category='Streams'
              data-track-name='OpenColumnInApp'
            >
              <ArrowRightUp className='size-3.5' />
            </button>
          </Tooltip>
        )}

        {dev.focusSide === 'left' && focusButton}

        <div className='ml-auto flex shrink-0 items-center gap-1'>
          {/* Leading the group, opposite `close` at the other end: the two verbs
              that change how much of the stream you can see, one in each
              direction. */}
          {dev.focusSide === 'right' && focusButton}

          {/* Only on the attached half of a pair, and it leads the group because
              it is the one verb here that changes what this column *is* rather
              than where it sits: it stops being part of the panel to its left
              and becomes a column in its own right. Everything after it — pin,
              close — then applies to that column.

              Named for what it gives you, not what it severs. "Unlink" described
              the mechanism and implied loss; a channel holds one of these at a
              time, and this is how you stop it being replaced by the next thing
              you open. Duo Stroke draws the second column at 28% — the pane as
              it is now — so pressing it makes that column solid. */}
          {onDetach && (
            <Tooltip
              content='Add to stream'
              side='bottom'
              className='pointer-events-none'
              sideOffset={6}
            >
              <button
                type='button'
                onClick={onDetach}
                onPointerDown={stopDrag}
                aria-label='Add to stream'
                className={controls}
                data-track-category='Streams'
                data-track-name='DetachColumn'
              >
                <LayoutGridTwoVertical className='size-3.5' variant='Duo Stroke' />
              </button>
            </Tooltip>
          )}

          {/* Pin and close, adjacent, and that pairing is the point: both act on
              the column itself — where it sits in the strip, and whether it is
              in the strip at all — while everything to the left acts on what the
              column is showing. One control, two states, because pinning and
              unpinning are the same verb.

              Absent on the attached half of a pair. Pinning holds a column at
              the left edge while the strip scrolls past it, and half a panel
              held there while its other half scrolled away is the one
              arrangement the pair must never reach. The parent's pin governs
              both; detach first if you want this one held on its own. */}
          {!joinLeft && (
            <Tooltip
              content={column.pinned ? 'Unpin column' : 'Pin column'}
              side='bottom'
              className='pointer-events-none'
              sideOffset={6}
            >
              <button
                type='button'
                onClick={onTogglePin}
                onPointerDown={stopDrag}
                aria-label={column.pinned ? 'Unpin column' : 'Pin column'}
                aria-pressed={column.pinned ?? false}
                className={cn(
                  'streams-press shrink-0 rounded-md p-1.5 hover:bg-accent',
                  // Pinned is a *state*, so its control stays lit even unhovered —
                  // otherwise the only way to tell a column is pinned is to hover it.
                  column.pinned
                    ? 'text-primary opacity-100 hover:bg-primary/10'
                    : cn(
                        'text-muted-foreground hover:text-foreground focus-visible:opacity-100',
                        focused ? 'opacity-100' : 'opacity-0 group-hover/column:opacity-100',
                      ),
                )}
                data-track-category='Streams'
                data-track-name='ToggleColumnPin'
              >
                <PinDefault className={cn('size-3.5', column.pinned && 'fill-current')} />
              </button>
            </Tooltip>
          )}

          <Tooltip
            content='Remove column'
            side='bottom'
            className='pointer-events-none'
            sideOffset={6}
          >
            <button
              type='button'
              onClick={onClose}
              onPointerDown={stopDrag}
              aria-label='Remove column'
              className={cn(controls, 'hover:bg-destructive/10 hover:text-destructive')}
              data-track-category='Streams'
              data-track-name='CloseColumn'
            >
              <MultipleCrossCancelDefault className='size-3.5' />
            </button>
          </Tooltip>
        </div>
      </header>

      {/* `data-column-body` is the handle the stream's FLIP uses to counter-scale
          this content. Scaling the column horizontally would stretch the text
          inside it; scaling the body by the inverse cancels that exactly, which
          is the standard fix and what Motion's layout animations do internally. */}
      <div
        data-column-body
        // `streams-fade-head` softens the line where this content passes under
        // the header. Nothing sat between the two once the per-column
        // "Catch me up" bar became opt-out, so the first message was being cut
        // dead across the middle of its own text.
        className='streams-fade-head relative min-h-0 flex-1 overflow-hidden'
        // Same reveal as the header, and here it is the one that matters: the
        // body holds a live chat panel with a virtualised list, and relaying it
        // out on every frame of a 240ms tween is the expensive way to animate a
        // width. Pinned, it is laid out once and simply clipped.
        //
        // `contain` is the other half. Even pinned, the browser has to prove
        // that nothing inside this box can affect layout outside it before it
        // can skip the work — `layout paint` asserts exactly that, so the
        // subtree is excluded from the strip's per-frame layout entirely.
        //
        // Measured on a recording of an unlink: without the `closing` half of
        // this, the outgoing pane re-wrapped its message list from two lines to
        // four as it narrowed — a full text layout per frame on a live chat
        // panel. 481ms of wall clock for 60ms of movement, 180ms of it frozen
        style={opening || closing ? { width: `${width}px`, contain: 'layout paint' } : undefined}
      >
        {/* Not mounted until the entrance is over, and this is the single
            biggest thing standing between "it animates" and "it animates well".

            A surface is expensive to mount — a channel panel opens Zero queries
            and builds a virtualised list, a document starts a collaborative
            editor session. Mounting one lands a long task on the main thread,
            and previously it landed on the *first frame of the animation*: the
            width transition would start, the browser would then spend a hundred
            milliseconds constructing a chat panel, and the tween would resume
            near its end. That is the 8fps — not the animation being slow, but
            the animation being starved by the work happening beside it.

            So the box opens empty, which costs nothing, and the surface mounts
            into a column that has already finished moving. It fades up rather
            than appearing, so the two read as one event rather than as a panel
            that arrived late. */}
        {opening ? null : mounted}

        {/* The drop promise, drawn over the body rather than by it.
            The surface says what it accepts and the stream says what accepting
            means; neither of them should also have to render a highlight. Which
            is the point of putting it here — a board or a channel becomes
            droppable by declaring `accepts`, with no UI work of its own.

            `pointer-events-none` matters more than it looks: an overlay that
            took pointer events would sit between the drag and the column and
            fire `dragleave` on the element that is trying to receive the drop. */}
        {over && (
          <div className='pointer-events-none absolute inset-0 flex items-center justify-center bg-primary/10 duration-150 animate-in fade-in-0'>
            <span className='rounded-full bg-primary px-3 py-1 text-[12px] font-medium text-primary-foreground shadow-md'>
              {surface.dropLabel ?? 'Drop here'}
            </span>
          </div>
        )}
      </div>

      {/* The ring goes on the column, not the body, so it reads as "this column
          will take it" rather than as something happening inside the panel. */}
      {over && (
        <div
          aria-hidden
          className='pointer-events-none absolute inset-0 rounded-xl ring-2 ring-inset ring-primary'
        />
      )}
    </section>
  );
};

StreamColumn.displayName = 'StreamColumn';

export default memo(StreamColumn);
