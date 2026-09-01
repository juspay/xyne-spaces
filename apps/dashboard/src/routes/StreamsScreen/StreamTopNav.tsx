import {
  ReactElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { Tooltip } from '../../components/ui/Tooltip/Tooltip';
import { ChevronLeft, ChevronRight, PlusDefault } from '@xyne/icons';
import { Button } from '../../components/ui/Button/Button';
import { surfaceFor } from './surfaces';
import { ActivityDot } from './ActivityDot';
import { type ColumnActivity, IDLE, isUnread } from './useColumnActivity';
import { cn } from '../../utils/classNames';
import { useStreamsDev } from './StreamsDev';
import type { StreamActivity } from './useStreamActivity';
import { STREAM_ACTION, STREAM_ACTION_IDLE, STREAMS_EASE } from './Streams.types';
import type { Column } from './Streams.types';

/**
 * Five rows, one question.
 *
 * - `list` — every tab at its label's width, in the header's flex slot, scrolled
 *   by hand.
 * - `scroll` — the same row, following the strip so the lit run stays in view.
 * - `window` — an aperture centred on the screen, masked heavily at rest and
 *   opening on hover.
 * - `squeeze` — the whole stream at once, labels appearing only on the run you can
 *   see and collapsing to icons elsewhere.
 * - `index` — no names at all: one tick per column, the name arriving only under
 *   the pointer. The only row that cannot overflow, so it is the only one whose
 *   behaviour does not change with the length of the stream.
 */
export type StreamNavVariant = 'list' | 'scroll' | 'window' | 'squeeze' | 'index';

/** Rows whose scroll position follows the strip rather than the pointer. */
const FOLLOWS_STRIP = new Set<StreamNavVariant>(['scroll', 'window']);
/** Rows that fit the whole stream into the width they have and never scroll. */
const FITS_STREAM = new Set<StreamNavVariant>(['squeeze', 'index']);

export interface StreamTopNavProps {
  variant: StreamNavVariant;
  /** Pinned columns, in the order the strip lays them out — outside the scroller. */
  pinned: readonly Column[];
  /** The columns inside the scroller, in strip order. */
  scrolling: readonly Column[];
  activity: StreamActivity;
  /**
   * The column the stream is on, when there *is* only one.
   *
   * Deliberately unset in the wide stream — see the note on `NavPill`: five
   * columns are on screen at once there, so "which one is selected" is a
   * question the screen has no answer to and marking one was answering it
   * anyway. Focus mode is the case where it does have an answer, and the row is
   * the only place left showing the rest of the stream, so it is worth saying.
   */
  currentId?: string | undefined;
  /** The scroller every variant reads its state from. */
  stripRef: React.RefObject<HTMLElement | null>;
  onJump: (columnId: string) => void;
  /**
   * Add a column, rendered at the end of the tabs.
   *
   * Omitted by the window variant, whose row is masked and clipped to an
   * aperture — a button living inside that would spend most of its life faded
   * out. There the stream's own header keeps it.
   */
  onAdd?: (() => void) | undefined;
  /**
   * Mark columns with activity in the accent, rather than only in the label.
   *
   * `index` only. The other rows carry an `ActivityDot` per tab, which this
   * would duplicate; a tick has nowhere to put a dot, so the mark itself is the
   * only channel it has.
   */
  alerts?: boolean | undefined;
}

/**
 * Below this share of a column being on screen, its tab is not lit at all;
 * at 1 it is fully lit, and in between it ramps.
 *
 * The rule you asked for is "fully visible means highlighted", and that is what
 * this gives — full lighting is reached only at 100%. The ramp underneath it is
 * not a softening of the rule, it is what stops six tabs flicking on and off one
 * at a time while you pan. A column sliding off dims as it goes instead of
 * snapping dark, and the moment it becomes fully visible is still the moment it
 * is fully lit. Raise this to 1 and the behaviour is the hard binary.
 */
const LIT_FROM = 0.7;

/**
 * Over how many pixels of the row's own scroll an end's fade comes in.
 *
 * Short on purpose. The question it answers is binary — is anything hidden this
 * way — and the ramp exists only so the answer changes over two or three frames
 * instead of one, which is the difference between a fade appearing and a fade
 * flicking on.
 */
const EDGE_RAMP = 24;

/**
 * How far behind the stream the row is allowed to run, as a time constant in ms.
 *
 * This is the fix for "it jumps around when I scroll fast", and the diagnosis is
 * the opposite of what it sounds like: the row was not lagging, it was perfectly
 * 1:1. A flick moves several columns through the lit band inside a couple of
 * frames, so six tabs swing their full range at once and the row shoots across —
 * every part of it correct, all of it at once, which reads as strobing.
 *
 * So the row is damped while the stream is not. The distinction that makes this
 * legitimate: the *strip* is direct manipulation and must never lag your hand,
 * but the row is a **readout** of where the strip is, and a readout may settle.
 *
 * A first-order filter in JS, not a CSS transition, and the difference matters.
 * A transition on a value rewritten every frame restarts from wherever it had
 * got to, so it never arrives and its real smoothing is unpredictable. This has
 * a stated time constant and behaves the same at any frame rate.
 */
const FOLLOW_TAU = 90;

/** Below these deltas the filter has arrived and the loop can stop. */
const LIT_EPSILON = 0.002;
const SCROLL_EPSILON = 0.5;

/**
 * One column's extent, in both spaces at once, plus the node to write to.
 *
 * Paired rather than parallel arrays because the job here is mapping between the
 * two, and an index that means different things in two lists is the kind of
 * thing that goes wrong silently once column widths stop being uniform.
 */
interface Span {
  /** The column's extent in the strip's scroll space. */
  scrollStart: number;
  scrollEnd: number;
  /** Its tab's extent in the nav's own content space. */
  pillStart: number;
  pillEnd: number;
  /** Its tab, held so the per-frame write needs no lookup. */
  node: HTMLElement;
  /** The column's id, so the filter's state survives a re-measure. */
  id: string;
}

/**
 * A position in the strip's scroll space, as a position in the nav.
 *
 * Piecewise linear, and it has to be: tabs are sized by their labels while
 * columns are sized by the user, so there is no single ratio between the two
 * spaces. Within a column the mapping is proportional; between two columns it
 * runs across the gap rather than jumping, because a strip resting between two
 * columns is a real state and a row that stalled at every seam would read as
 * sticking.
 */
const toNav = (spans: readonly Span[], x: number): number | null => {
  const first = spans[0];
  const last = spans[spans.length - 1];
  if (!first || !last) return null;
  if (x <= first.scrollStart) return first.pillStart;
  if (x >= last.scrollEnd) return last.pillEnd;

  let previous: Span | null = null;
  for (const span of spans) {
    if (previous && x < span.scrollStart) {
      const gap = span.scrollStart - previous.scrollEnd;
      const fraction = gap > 0 ? (x - previous.scrollEnd) / gap : 0;
      return previous.pillEnd + fraction * (span.pillStart - previous.pillEnd);
    }
    if (x <= span.scrollEnd) {
      const width = span.scrollEnd - span.scrollStart;
      const fraction = width > 0 ? (x - span.scrollStart) / width : 0;
      return span.pillStart + fraction * (span.pillEnd - span.pillStart);
    }
    previous = span;
  }
  return last.pillEnd;
};

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * One column, as a tab.
 *
 * `data-nav-column` rather than a ref map: the geometry pass finds tabs by it,
 * and one attribute lookup is less to keep in step than a map rebuilt whenever
 * the stream changes.
 *
 * No `aria-current` and no focused weight in any variant. There is no single
 * current column here by construction — five or six are on screen at once, and
 * the lit run says which.
 */
const NavPill = ({
  column,
  activity,
  squeeze,
  badges,
  sidebarStyle,
  current,
  onJump,
}: {
  current: boolean;
  column: Column;
  activity: StreamActivity;
  /** Let the label's width follow the light, rather than sitting at its own. */
  squeeze: boolean;
  /** Render the workspace's two-tier marking instead of the single dot. */
  badges: boolean;
  /** Wear the app sidebar's colours, weight and hover instead of this row's own. */
  sidebarStyle: boolean;
  onJump: () => void;
}): ReactElement => {
  const { icon: Icon, Title } = surfaceFor(column.source);
  const state = activity[column.id] ?? IDLE;
  return (
    <button
      type='button'
      data-nav-column={column.id}
      aria-current={current ? 'true' : undefined}
      onClick={onJump}
      className={cn(
        // `pointer-events-auto` against the container's `none`, which the window
        // variant needs: its box is centred on the screen and wide, so it lies
        // across header the user still has to be able to click.
        'pointer-events-auto flex min-h-8 shrink-0 items-center gap-1.5 px-3 py-1.5 text-xs',
        sidebarStyle
          ? // The sidebar's own recipe for "a row you can click that names a
            // place", copied rather than approximated: AppSidebar.tsx uses
            // exactly this pair of branches on every nav item it has.
            //
            // `.streams-nav-tab` is deliberately absent. Its whole job is the
            // `color-mix` between lit and unlit, and there is no lit run here —
            // the sidebar does not have one, so a mode that borrows its behaviour
            // cannot keep ours. `streams-press` goes too: the sidebar's feedback
            // is `transition-colors`, not a press transform.
            cn(
              // No `font-medium`. That was inferred from the mobile menu and it is
              // wrong: the sidebar's actual nav items set no font-weight at all,
              // so they inherit 400. Measured against a live one, `font-medium`
              // was the single property out of five that did not match.
              'cursor-pointer rounded-lg border border-transparent transition-colors',
              current
                ? // The rail's selected row, so the two lists agree about where
                  // you are rather than each having its own opinion.
                  'border-sidebar-border bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                : 'bg-transparent text-sidebar-foreground',
              'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
            )
          : 'streams-nav-tab rounded-full',
      )}
      data-track-category='Streams'
      data-track-name='JumpFromTopNav'
    >
      <Icon className='size-3.5 shrink-0' aria-hidden />
      {/* Bold for a column that simply moved — the sidebar's ambient tier. The
          dot is *replaced* by it rather than joined to it, which is the whole
          point of the convention: one signal per tier, not two.

          `text-foreground` on the label, not on the button. The button's colour
          is the lit/unlit `color-mix`, or the sidebar's own token, and an unread
          column has to read as unread from either — including when it is off
          screen and the row has dimmed it to `--tab-off`. A child's own `color`
          beats the value it would otherwise inherit, so this needs no
          `!important` and does not disturb the icon or the count beside it. */}
      <span
        className={cn(
          'truncate',
          squeeze ? 'streams-nav-squeeze' : 'max-w-[9rem]',
          badges && isUnread(state) && 'font-semibold text-foreground',
        )}
      >
        {column.title ?? <Title source={column.source} />}
      </span>
      {badges ? (
        // A count only for things addressed to you. `9+` because the tab row is
        // laid out from its labels and a three-digit badge would take a name's
        // worth of width off whichever column happened to be busiest.
        state.count > 0 && (
          <span className='streams-nav-badge flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-primary px-[4px] text-[11px] font-semibold text-primary-foreground'>
            {state.count > 9 ? '9+' : state.count}
          </span>
        )
      ) : (
        <ActivityDot activity={state} />
      )}
    </button>
  );
};

NavPill.displayName = 'NavPill';

/**
 * One column, as a tick.
 *
 * The mark is a background on the button, not a child element, and that is
 * forced rather than tidy — see `.streams-nav-tick` in global.css. What matters
 * here is that the button carries `data-nav-column`, so the same per-frame
 * lighting pass that drives the tabs drives these with no special case.
 *
 * A count in the label, where every other surface in Streams shows a dot. That
 * is not a break with `ActivityDot`'s rule but the exception the rule itself
 * names: what it argues against is a badge in *every* header, card and jump row,
 * turning a wall of columns into a table of figures. This is one label, on
 * demand, under the pointer — the tooltip case, where a finer distinction
 * belongs.
 */
const IndexTick = ({
  column,
  activity,
  alerts,
  onJump,
}: {
  column: Column;
  activity: StreamActivity;
  alerts: boolean;
  onJump: () => void;
}): ReactElement => {
  const { icon: Icon, Title } = surfaceFor(column.source);
  const state = activity[column.id] ?? IDLE;
  const alerting = alerts && isUnread(state);
  return (
    <button
      type='button'
      data-nav-column={column.id}
      // Presence, not a value — the styling is binary and CSS reads it as
      // `[data-alert]`. `undefined` removes the attribute entirely, which is
      // what makes the selector a clean on/off.
      data-alert={alerting ? '' : undefined}
      onClick={onJump}
      className={cn(
        // The tick is thin because the row has to stay readable as a run; the
        // target is not, because you are aiming at it — so the width is the
        // pitch, and comes from `--tick-pitch` rather than a class. Nothing
        // between them: a gap here would be a dead lane the pointer crosses on
        // the way to the next column, and the label would flicker off in it.
        // No `items-*` here: which edge the mark sits on is the anchor dial's,
        // and it has to agree with `transform-origin`, so both live in CSS.
        'streams-nav-tick pointer-events-auto relative flex h-8 shrink-0 justify-center',
        'outline-none',
      )}
      data-track-category='Streams'
      data-track-name='JumpFromTopNav'
    >
      {/* Deliberately bigger than a tab. This is the only place the index says
          anything in words, it appears one at a time and only on demand, and it
          has to be legible against a live column behind it — none of which is
          true of a row of tabs, where the same size would be a wall. */}
      <span className='streams-nav-tick-label flex items-center gap-2 whitespace-nowrap rounded-lg border border-border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-lg'>
        <Icon className='size-4 shrink-0' aria-hidden />
        <span className='max-w-[16rem] truncate'>
          {column.title ?? <Title source={column.source} />}
        </span>
        {state.count > 0 ? (
          <span className='font-medium tabular-nums text-primary'>{state.count}</span>
        ) : (
          <ActivityDot activity={state} className='size-2' />
        )}
      </span>
    </button>
  );
};

IndexTick.displayName = 'IndexTick';

/**
 * The stream as a row of tabs, on the header's own line.
 *
 * What every variant shares is the signal: **each tab is lit in proportion to
 * how much of its column is on screen.** There is no active tab anywhere in this
 * component. A stream shows five or six columns at once, so "which one is
 * selected" is a question the screen does not have an answer to, and marking one
 * was answering it anyway.
 *
 * The lighting is written straight to the nodes every frame from `scrollLeft` —
 * no state, so panning the stream never re-renders the screen — and it is
 * continuous, so nothing anywhere flips at a boundary.
 */
/**
 * How far the row's edge fade reaches while an overflow mark is sitting on it.
 *
 * The mark floats over the scroller, so without this it lands on top of whatever
 * tab happens to be half-scrolled under it — a grey pill with "…dom" running out
 * from behind it, which reads as a rendering fault rather than as a control. Wide
 * enough that the tab beneath has faded to nothing before the pill starts.
 */
const MARK_FADE_PX = 104;

/**
 * Mentions that have scrolled out of the nav row itself.
 *
 * The jump pills answer this for the *strip* — what is off screen and wants you.
 * The nav row is a second scroller with the same problem and no answer: once the
 * stream is wider than the header, a column with three mentions can sit past the
 * edge of the very row whose job is to say it exists. The badge is drawn, it is
 * just drawn somewhere you cannot see.
 *
 * Counts only, never the ambient dot. A dot means "something moved here", and a
 * summary of things that moved is a number nobody asked for. A mention is
 * addressed to you, so it earns an edge marker and a jump.
 */
const OverflowMark = ({
  columns,
  activity,
  side,
  onJump,
}: {
  columns: readonly Column[];
  activity: Record<string, ColumnActivity>;
  side: 'start' | 'end';
  onJump: (id: string) => void;
}): ReactElement | null => {
  // Held so the mark can *leave*.
  //
  // Returning null on empty means React unmounts it, and an unmounted element
  // cannot transition — which is why it popped. Keeping the last non-empty set
  // lets the exit run against real content instead of counting down to "0" on
  // the way out. Null only before the first appearance, when there is genuinely
  // nothing to fade.
  const lastRef = useRef<readonly Column[]>([]);
  if (columns.length > 0) lastRef.current = columns;
  const drawn = columns.length > 0 ? columns : lastRef.current;

  // Two paints, or the first appearance has nothing to interpolate from.
  //
  // Before this the element was created already carrying `scale(1)` and
  // `opacity: 1` — a transition needs a previous value to move away from, and
  // the mark's first frame *was* its final frame. So it still popped, with a
  // transition declared on it that never had cause to run.
  //
  // One frame at the hidden values, then the real ones. Latched on rather than
  // reset per appearance: after the first, the node persists and every later
  // toggle is a plain value change that transitions on its own.
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    if (ready || columns.length === 0) return undefined;
    const frame = requestAnimationFrame(() => setReady(true));
    return (): void => cancelAnimationFrame(frame);
  }, [ready, columns.length]);

  if (drawn.length === 0) return null;
  const shown = columns.length > 0 && ready;

  const total = drawn.reduce((sum, column) => sum + (activity[column.id]?.count ?? 0), 0);
  // The nearest one in the direction of travel. Jumping to the furthest would
  // skip everything between, and the marker simply reappears for whatever is
  // still out there — so one press per column is the whole interaction.
  const nearest = side === 'start' ? drawn[drawn.length - 1] : drawn[0];
  const noun = drawn.length === 1 ? '1 column' : `${drawn.length} columns`;
  const where = side === 'start' ? 'left' : 'right';
  const Arrow = side === 'start' ? ChevronLeft : ChevronRight;
  return (
    <Tooltip content={`${noun} with mentions to the ${where}`}>
      <button
        type='button'
        onClick={() => nearest && onJump(nearest.id)}
        aria-label={`Jump to ${noun} with mentions to the ${where}`}
        // A mention badge that points.
        //
        // The first pass drew this as a quiet outlined chip so it could not be
        // mistaken for a tab's own count — and it read as a piece of navigation
        // furniture instead of as three people waiting on you. That is the wrong
        // trade: what is buried out there is exactly as urgent as what is on
        // screen, so it gets the same fill, the same weight, the same size.
        //
        // The chevron does the disambiguating on its own. An arrow cannot be read
        // as belonging to the thing beside it — it points away from it — and the
        // hairline inside the fill is the second, quieter tell that this one is a
        // door rather than a count.
        // Not tabbable or clickable on the way out — a control that is fading has
        // already stopped being an answer to anything.
        tabIndex={shown ? undefined : -1}
        aria-hidden={!shown}
        style={{
          // The translate has to live *inside* the animated transform. Left on the
          // class as `-translate-y-1/2` it would be replaced the moment the scale
          // lands, and the mark would jump half its height mid-fade.
          transform: `translateY(-50%) scale(${shown ? 1 : 0.94})`,
          opacity: shown ? 1 : 0,
          // Scales from the edge it is attached to, the same reason a popover
          // scales from its trigger rather than from its own middle: it belongs to
          // that edge, so that is where it should come from.
          transformOrigin: side === 'start' ? 'left center' : 'right center',
          // Asymmetric, and deliberately. Arriving is news — something out there
          // wants you — so it gets the longer, more visible half. Leaving is
          // bookkeeping: you scrolled, it is no longer true, get out of the way.
          transition: `transform ${shown ? 180 : 130}ms ${STREAMS_EASE}, opacity ${shown ? 180 : 130}ms ${STREAMS_EASE}`,
        }}
        className={cn(
          'streams-nav-badge flex h-[18px] shrink-0',
          'items-center gap-0.5 rounded-full border border-primary-foreground/40',
          'bg-primary px-1 text-[11px] font-semibold text-primary-foreground',
          'absolute top-1/2 z-10',
          shown ? 'pointer-events-auto' : 'pointer-events-none',
          // The row already moves under it; a mark that also animates is one more
          // thing in flight for someone who asked for less.
          'motion-reduce:transition-none',
          side === 'start' ? 'left-0 flex-row' : 'right-0 flex-row-reverse',
        )}
        data-track-category='Streams'
        data-track-name='JumpFromNavOverflow'
      >
        <Arrow className='size-2.5 shrink-0 opacity-70' aria-hidden />
        {total > 9 ? '9+' : total}
      </button>
    </Tooltip>
  );
};

const StreamTopNav = ({
  variant,
  pinned,
  scrolling,
  activity,
  stripRef,
  onJump,
  onAdd,
  currentId,
  alerts,
}: StreamTopNavProps): ReactElement => {
  // Straight from the dev context rather than through a prop: it is a dial, the
  // provider sits above this whole screen, and threading it would mean editing
  // StreamsScreen, which other sessions are regularly holding.
  const { navBadges, navFlat, navSidebar } = useStreamsDev();
  const trackRef = useRef<HTMLDivElement>(null);
  const spansRef = useRef<Span[]>([]);
  const frameRef = useRef<number | null>(null);
  /** Each tab's current light, keyed by column so a re-measure does not reset it. */
  const litRef = useRef<Map<string, number>>(new Map());
  /** What was last actually written to each tab, so unchanged frames cost nothing. */
  const writtenRef = useRef<Map<string, string>>(new Map());
  /** The row's current scroll, held as a float — `scrollLeft` rounds on read. */
  const followRef = useRef<number | null>(null);
  /** Timestamp of the previous frame, 0 when the loop is starting fresh. */
  const lastRef = useRef(0);
  const follows = FOLLOWS_STRIP.has(variant);
  const fits = FITS_STREAM.has(variant);
  const windowed = variant === 'window';
  const indexed = variant === 'index';
  /** Rows the caller has taken out of the header's flow and centred itself. */
  const centred = windowed || indexed;

  /**
   * Rebuild the two-space geometry.
   *
   * Rects rather than `offsetLeft`, for the reason the rest of Streams uses
   * them: `offsetLeft` is relative to whichever ancestor happens to be
   * positioned, and the two spaces here have different ones — so offsets would
   * be measuring from two different origins and everything downstream would sit
   * at a constant, invisible bias.
   */
  const measure = useCallback((): void => {
    const strip = stripRef.current;
    const track = trackRef.current;
    if (!strip || !track) return;

    const stripRect = strip.getBoundingClientRect();
    const trackRect = track.getBoundingClientRect();
    const spans: Span[] = [];

    for (const column of scrolling) {
      const node = strip.querySelector<HTMLElement>(`[data-column="${column.id}"]`);
      const chip = track.querySelector<HTMLElement>(`[data-nav-column="${column.id}"]`);
      // One commit can land a column in the strip before its tab, or the other
      // way round. A half-built map is worse than the previous one, so it is
      // abandoned rather than stored — the observer fires again immediately.
      if (!node || !chip) return;

      const rect = node.getBoundingClientRect();
      const pill = chip.getBoundingClientRect();
      spans.push({
        scrollStart: rect.left - stripRect.left + strip.scrollLeft,
        scrollEnd: rect.right - stripRect.left + strip.scrollLeft,
        pillStart: pill.left - trackRect.left + track.scrollLeft,
        pillEnd: pill.right - trackRect.left + track.scrollLeft,
        node: chip,
        id: column.id,
      });
    }

    spansRef.current = spans;
  }, [scrolling, stripRef]);

  /**
   * Light the run, follow it, and settle toward both rather than snapping.
   *
   * Visibility comes off the cached spans rather than fresh rects: a column's
   * extent in scroll space does not change when you scroll, only the window over
   * it does. That keeps this to arithmetic and one style write per tab, with no
   * layout read in the loop at all.
   *
   * The loop keeps itself alive while anything is still moving, which is what
   * separates a filter from a transition: a scroll that stops halfway through a
   * swing still finishes it, rather than leaving the row parked wherever the
   * last event happened to land.
   */
  const tick = useCallback(
    (now: number): void => {
      frameRef.current = null;
      const strip = stripRef.current;
      const track = trackRef.current;
      if (!strip || !track) return;

      // Clamped: a backgrounded tab or a long frame would otherwise arrive with
      // a `dt` big enough to make `k` 1, which is the undamped behaviour this
      // exists to remove — and it would do it exactly when things are worst.
      const dt = lastRef.current === 0 ? 16 : Math.min(64, now - lastRef.current);
      lastRef.current = now;
      const k = 1 - Math.exp(-dt / FOLLOW_TAU);

      const from = strip.scrollLeft;
      const to = from + strip.clientWidth;
      let settled = true;

      // Flat: no lighting to compute, and skipping it here rather than
      // overriding the result in CSS is the point — a highlight nobody can see
      // should not also be costing a style write per tab per frame. The rest of
      // the loop still runs, because the row may still be following the strip
      // and the edge fades still have to know what is hidden.
      for (const span of navFlat ? [] : spansRef.current) {
        const width = span.scrollEnd - span.scrollStart;
        const shown = Math.min(span.scrollEnd, to) - Math.max(span.scrollStart, from);
        const seen = width > 0 ? clamp01(shown / width) : 0;
        // Nothing below the floor, full only at fully visible.
        const target = clamp01((seen - LIT_FROM) / (1 - LIT_FROM));
        const previous = litRef.current.get(span.id) ?? target;
        const next = previous + (target - previous) * k;
        if (Math.abs(target - next) > LIT_EPSILON) settled = false;
        litRef.current.set(span.id, next);
        // Only write when the *written* value changes. Most of a long stream is
        // off screen and pinned at 0, and every one of those writes is a style
        // invalidation on an element whose appearance is not going to change —
        // paid on every frame the stream moves. Comparing the rounded strings is
        // the honest test, because the string is what the engine actually sees.
        const written = next.toFixed(3);
        if (writtenRef.current.get(span.id) !== written) {
          writtenRef.current.set(span.id, written);
          span.node.style.setProperty('--tab-on', written);
        }
      }

      if (follows) {
        const middle = toNav(spansRef.current, from + strip.clientWidth / 2);
        if (middle !== null) {
          const target = middle - track.clientWidth / 2;
          const previous = followRef.current ?? target;
          const next = previous + (target - previous) * k;
          if (Math.abs(target - next) > SCROLL_EPSILON) settled = false;
          followRef.current = next;
          track.scrollLeft = next;
        }

        // Read back rather than reusing the value just written: the row clamps,
        // so at either end of the stream the position it took is not the one it
        // was asked for, and the point here is knowing when it has stopped.
        const room = track.scrollWidth - track.clientWidth;
        const at = track.scrollLeft;
        // Nothing hidden either way — the stream fits the row, so neither end has
        // earned a fade and both would be dimming a tab for no reason.
        const start = room <= 0 ? 0 : clamp01(at / EDGE_RAMP);
        const end = room <= 0 ? 0 : clamp01((room - at) / EDGE_RAMP);
        track.style.setProperty('--window-edge-start', start.toFixed(3));
        track.style.setProperty('--window-edge-end', end.toFixed(3));
      }

      if (!settled) frameRef.current = requestAnimationFrame(tick);
    },
    [stripRef, follows, navFlat],
  );

  // Scroll fires far more often than a frame. The loop runs itself once
  // started, so this only ever has to make sure one is in flight.
  const schedule = useCallback((): void => {
    if (frameRef.current !== null) return;
    lastRef.current = 0;
    frameRef.current = requestAnimationFrame(tick);
  }, [tick]);

  /**
   * Pin or unpin every tab's light when the dial flips.
   *
   * `0` rather than removing the property, and the difference matters: `--tab-on`
   * is registered with an initial value of **1**, so clearing it would light the
   * whole row rather than flatten it. Grey is the floor, not the default.
   *
   * Un-flattening does clear it, so the pinned run — which the loop never writes,
   * because those columns are always on screen — goes back to its initial 1.
   */
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    for (const node of track.querySelectorAll<HTMLElement>('[data-nav-column]')) {
      if (navFlat) node.style.setProperty('--tab-on', '0');
      else node.style.removeProperty('--tab-on');
    }
    // Both caches describe the mode we just left.
    litRef.current.clear();
    writtenRef.current.clear();
  }, [navFlat, pinned, scrolling]);

  useEffect(() => {
    const strip = stripRef.current;
    const track = trackRef.current;
    if (!strip || !track) return;

    const remeasure = (): void => {
      measure();
      schedule();
    };
    remeasure();

    strip.addEventListener('scroll', schedule, { passive: true });
    // Three independent sources of staleness: a column resized (the strip's
    // geometry), a title arriving from a live query (a tab's), and the row
    // itself changing size. One observer covers all three, and re-measuring on
    // the extra frames is cheaper than working out which just happened.
    const observer = new ResizeObserver(remeasure);
    observer.observe(strip);
    observer.observe(track);
    for (const child of Array.from(strip.children)) observer.observe(child);

    return (): void => {
      strip.removeEventListener('scroll', schedule);
      observer.disconnect();
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [stripRef, measure, schedule, variant, pinned, scrolling]);

  // Which mention-bearing tabs are outside the row's own scroll window.
  //
  // Measured from the DOM rather than derived from the spans above: those track
  // the *strip's* scroll space, and this is a question about the nav's, which is
  // a different scroller with a different width. Compared by id before setting
  // so a scroll that changes nothing does not re-render the header.
  const [buried, setBuried] = useState<{ start: Column[]; end: Column[] }>({
    start: [],
    end: [],
  });
  useEffect(() => {
    const track = trackRef.current;
    if (!track || indexed || windowed) {
      setBuried(previous =>
        previous.start.length === 0 && previous.end.length === 0
          ? previous
          : { start: [], end: [] },
      );
      return undefined;
    }
    const sameIds = (a: readonly Column[], b: readonly Column[]): boolean =>
      a.length === b.length && a.every((column, index) => column.id === b[index]?.id);
    const measureBuried = (): void => {
      const box = track.getBoundingClientRect();
      const start: Column[] = [];
      const end: Column[] = [];
      for (const column of [...pinned, ...scrolling]) {
        if ((activity[column.id]?.count ?? 0) === 0) continue;
        const node = track.querySelector<HTMLElement>(`[data-nav-column="${column.id}"]`);
        if (!node) continue;
        const rect = node.getBoundingClientRect();
        // A pixel of slack: a tab flush with the edge is visible, and rounding
        // at fractional scroll offsets would otherwise flicker the marker.
        if (rect.right <= box.left + 1) start.push(column);
        else if (rect.left >= box.right - 1) end.push(column);
      }
      setBuried(previous =>
        sameIds(previous.start, start) && sameIds(previous.end, end) ? previous : { start, end },
      );
    };
    // Coalesced to one measure per frame. In the `scroll` variant the row's own
    // `scrollLeft` is written from the strip every frame, so an unthrottled
    // listener ran a rect read per mention column per frame of every pan.
    let frame = 0;
    const schedule = (): void => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measureBuried();
      });
    };
    measureBuried();
    track.addEventListener('scroll', schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(track);
    return (): void => {
      track.removeEventListener('scroll', schedule);
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [trackRef, pinned, scrolling, activity, indexed, windowed]);

  const tab = (column: Column): ReactElement =>
    indexed ? (
      <IndexTick
        key={column.id}
        column={column}
        activity={activity}
        alerts={alerts ?? false}
        onJump={() => onJump(column.id)}
      />
    ) : (
      <NavPill
        key={column.id}
        column={column}
        current={column.id === currentId}
        activity={activity}
        squeeze={variant === 'squeeze'}
        badges={navBadges}
        sidebarStyle={navSidebar}
        onJump={() => onJump(column.id)}
      />
    );

  return (
    <nav
      aria-label='Stream columns'
      className={cn(
        'streams-nav flex items-center gap-1',
        centred
          ? 'pointer-events-none shrink-0'
          : // `ml-1` on top of the row's own `gap-2` — 12px between the stream's
            // name and its first tab. It was 20px, which pushed the tabs far
            // enough from the title to read as a separate bar that happened to
            // start there, rather than as the stream the title names.
            'ml-1 min-w-0 flex-1',
      )}
    >
      {/* The marks float over this box rather than sitting beside the scroller
          in the row. In the flow they were a feedback loop: a mark appears, the
          track it is measured against gets that much narrower, one more tab
          falls off the edge, the count changes, a mark disappears, the track
          widens, the tab comes back. Every frame produced a different answer and
          the row visibly shook. Out of flow, what is buried depends only on the
          scroll position and the width — neither of which the marks touch. */}
      <div className='relative flex min-w-0 items-center'>
        <OverflowMark columns={buried.start} activity={activity} side='start' onJump={onJump} />

        {/* The scroller is an inner box rather than the nav itself, and that is
          what lets the add button behave the way a browser's does.

          Left to size itself (`flex: 0 1 auto` with an intrinsic basis), this is
          exactly as wide as the tabs while they fit — so the button after it sits
          against the last tab, travelling right as the stream grows. Once the tabs
          are wider than the room, it shrinks instead of pushing, the tabs start
          scrolling inside it, and the button comes to rest at the end of the bar.
          One layout, both behaviours, no measuring. */}
        <div
          ref={trackRef}
          // Per-edge, and only the edge that has something on it: a wide fade on a
          // clean end would just eat a tab for nothing.
          style={
            {
              ...(buried.start.length > 0 && { '--fade-x-start': `${MARK_FADE_PX}px` }),
              ...(buried.end.length > 0 && { '--fade-x-end': `${MARK_FADE_PX}px` }),
            } as CSSProperties
          }
          className={cn(
            'relative flex min-w-0 items-center',
            // The index has to let its label out: the label hangs below the row,
            // and any clipping on this box would cut it off at the header's edge.
            // It can afford to — it is the one row that never scrolls, so there is
            // nothing here to clip in the first place.
            indexed ? 'gap-0 overflow-visible' : 'gap-0 overflow-y-hidden',
            // No scrollbar in any variant: this is a strip of eight chips, and a
            // horizontal bar under it would be taller than the thing it scrolls.
            '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
            windowed &&
              // `overflow-x: hidden` still scrolls when `scrollLeft` is assigned;
              // what it stops is the user scrolling the row by hand, which in this
              // variant would be fighting the strip for control of the same value.
              'streams-window pointer-events-none overflow-x-hidden',
            !windowed &&
              cn(
                // A row that fits the stream has nothing to scroll and nothing to
                // fade; the others scroll and take the strip's own edge mask.
                fits && !indexed && 'overflow-x-hidden',
                // `list` is the only row a hand may scroll. `scroll` is driven off
                // the strip, so `hidden` — which still moves when `scrollLeft` is
                // assigned — is what stops a drag fighting the stream for one value.
                //
                // `hidden` rather than the `pointer-events-none` this used, and the
                // difference matters now that hovering the row lights it: with the
                // pointer disabled, only the tabs themselves registered hover, so
                // crossing a gap between two of them dropped it and the row
                // flickered dark for a frame.
                // `auto`, not `hidden`. Hidden was deliberate — the row's
                // `scrollLeft` is written from the strip, so a hand scroll is two
                // inputs on one value — but a row you cannot reach is worse than a
                // row that occasionally snaps: with the stream wider than the header
                // the tabs past the edge were simply unreachable. Scrolling the
                // strip still wins, which is the right precedence: the nav
                // describes the strip, so the strip gets the last word.
                variant === 'scroll' && 'streams-fade-x overflow-x-auto',
                variant === 'list' && 'streams-fade-x overflow-x-auto',
              ),
          )}
        >
          {pinned.map(tab)}
          {/* The pinned run holds the left edge of the stream whatever the strip is
            doing, so the rule says the same thing here that the strip's own
            boundary says: everything to its left is always on screen. */}
          {pinned.length > 0 && scrolling.length > 0 && (
            <div
              className={cn('h-3.5 w-px shrink-0 bg-border', indexed ? 'mx-1.5' : 'mx-1')}
              aria-hidden
            />
          )}
          {scrolling.map(tab)}
        </div>

        <OverflowMark columns={buried.end} activity={activity} side='end' onJump={onJump} />
      </div>

      {onAdd && (
        <Tooltip content='Add a column'>
          <Button
            variant='ghost'
            size='sm'
            onClick={onAdd}
            aria-label='Add a column'
            // The stream header's own icon button, not a hand-rolled one. This
            // shipped as a bespoke `size-8 rounded-full` and it was wrong for the
            // reason `STREAM_ACTION`'s own note gives: the header's buttons already
            // agree on a size, a radius, a hover and a focus ring, and rebuilding
            // four of those five by hand is exactly how this bar drifts into
            // looking like a different product. It sits among the tabs now, but it
            // is still one of the stream's verbs.
            className={cn(STREAM_ACTION, STREAM_ACTION_IDLE, 'pointer-events-auto')}
            data-track-category='Streams'
            data-track-name='OpenAddPaletteFromNav'
          >
            <PlusDefault size={16} />
          </Button>
        </Tooltip>
      )}
    </nav>
  );
};

StreamTopNav.displayName = 'StreamTopNav';

export default StreamTopNav;
