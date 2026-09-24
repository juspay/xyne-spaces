import {
  type CSSProperties,
  Fragment,
  ReactElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useSelector } from '@xstate/react';
import { v4 as uuidv4 } from 'uuid';
// The header's own icons come from the app's set, not lucide. Two icon families
// on one bar is most of what made these buttons read as foreign next to a
// channel header — different stroke weight, different corner treatment, at the
// same size.
import { PlusDefault } from '@xyne/icons';
import { useZero } from '../../hooks/useZero';
import { getDraft } from '../../hooks/useDraft';
import { mutators } from '../../zero/mutators';
import { xyneAIActor } from '../../machines/xyneAIMachine';
import { useScope, useShortcut } from '../../shortcuts';
import StreamColumn from './components/StreamColumn/StreamColumn';
import AddColumnPalette from './components/AddColumnPalette/AddColumnPalette';
import StreamTopNav from './components/StreamTopNav/StreamTopNav';
import StreamSwitcher from './components/StreamSwitcher/StreamSwitcher';
import { useColumnDrag, type MarkerRect } from './hooks/useColumnDrag';
import { useStreamActivity } from './hooks/useStreamActivity';
import { useAttachmentColumns } from './hooks/useAttachmentColumns';
import { IDLE, type ColumnActivity } from './hooks/useColumnActivity';
import { readStreamsReveal } from './hooks/useAddToStream';
import { DEV_DEFAULTS } from './components/StreamsDev/StreamsDev';
import { surfaceFor } from './components/Surfaces/Surfaces';
import { toast } from 'sonner';
import ColumnResizeHandle from './components/ColumnResizeHandle/ColumnResizeHandle';
import {
  activeStream,
  archiveStream,
  clampWidth,
  createStream,
  deleteStream,
  insertStream,
  isLive,
  liveStreams,
  loadFocusMode,
  loadLayout,
  makeColumn,
  renameStream,
  restoreStream,
  saveFocusMode,
  saveLayout,
  switchStream,
} from './components/StreamsLayout/StreamsLayout';
import FocusAddPage from './components/FocusAddPage/FocusAddPage';
import {
  acceptsAttachment,
  allowsDuplicates,
  attachmentOf,
  moveColumn,
  hostFor,
  isAttachingSource,
  scrollBehavior,
  sourceKey,
} from './components/Streams/Streams.utils';
import {
  ADD_COMMIT_AT,
  COLUMN_CLOSE_MS,
  COLUMN_FLASH_MS,
  COLUMN_OPEN_MS,
  STREAM_LEFT_INSET,
  FOCUS_PEEK,
  STREAMS_EASE,
  FOCUS_SCROLL_MS,
  MAX_WIDTH,
  MIN_WIDTH,
  HEADER_INSET,
  RING_GUTTER,
  STRIP_LEAD,
  STRIP_PAD,
  STREAM_PRESS_ROW,
} from './components/Streams/Streams.types';
import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual';
import {
  assertStridesMatchDom,
  columnBand,
  columnStrides,
  HANDLE_PX,
  toClientX,
} from './components/Streams/Streams.geometry';
import type { ColumnBox } from './hooks/useColumnDrag';
import { streamsActor } from '../../machines/streamsMachine';
import { questionFor, type StreamItem } from './components/StreamsDnd/StreamsDnd';
import type {
  Column,
  ColumnSeed,
  ColumnSource,
  StreamsLayout,
} from './components/Streams/Streams.types';
import { cn } from '../../utils/classNames';

const SCOPE = 'streams';

/**
 * Everything a column can ask the stream to do, as one frozen bundle per column.
 *
 * Mirrors the handler half of `StreamColumnProps` deliberately: these are handed
 * straight through, so the two shapes have to agree and TypeScript should say so
 * if they stop agreeing. See `handlersFor`.
 */
interface ColumnHandlers {
  onFocus: () => void;
  onToggleFocus: () => void;
  onDragHandleDown: (event: React.PointerEvent) => void;
  onClose: () => void;
  onTogglePin: () => void;
  onDetach: () => void;
  onOpenInApp: () => void;
  onClearActivity: () => void;
  onDropItem: (item: StreamItem) => void;
}

/**
 * How long the strip is pinned after an unsolicited focus, in ms.
 *
 * Long enough to outlast the browser's own scroll-into-view animation, short
 * enough that it cannot swallow a scroll the user actually asked for. The
 * composers that trigger this all autofocus within a few hundred ms of their
 * channel resolving.
 */
const FOCUS_SCROLL_GUARD_MS = 400;

/** A scroll this soon after a real gesture belongs to the user, not to a mount. */
const INPUT_GRACE_MS = 200;

/**
 * How long after a real gesture the focus-mode carousel may still move focus.
 *
 * Longer than `INPUT_GRACE_MS` because a swipe's wheel events stop when the
 * fingers lift, but the snap animation that finishes it keeps scrolling for a few
 * hundred milliseconds more, and the page it lands on is still the user's choice.
 */
const CAROUSEL_GESTURE_MS = 1000;

/**
 * How many built columns stay mounted after they leave the window.
 *
 * The virtualiser unmounts anything past the overscan band, and `surfaceReady`
 * is component state — so an unmount throws the built surface away, and coming
 * back rebuilds it from a skeleton. Measured in production 2026-09-22: a column
 * built at 688 nodes scrolled away, returned as a 23-node skeleton at 671ms,
 * stayed one for 1.3s and showed content at 1,990ms, costing 382ms of blocked
 * main thread. One round trip across a 17-column stream destroyed 21 surfaces.
 *
 * Sized to hold a whole stream rather than a sliding window, because the rule
 * people actually expect is "a column I have already opened does not reload".
 * At 8 this failed exactly that way: on a 16-column stream every column built
 * during a crawl and four were skeletons again by the end. Past the column
 * count, built-then-skeleton regressions measured **zero** across two full
 * traversals.
 *
 * The cost is DOM, and it is not small — that same stream went from 2,226 nodes
 * to 7,303 with every column held. Every style recalculation walks the whole
 * document, and style recalculation is already the biggest single cost here, so
 * this trades a visible stall for a diffuse one. 20 is a ceiling for
 * pathological streams, not a target.
 */
const KEEP_BUILT = 20;

/**
 * Where a dragged column will land — one marker for the whole stream.
 *
 * Fixed-positioned and driven by a measured rect, because the previous version
 * mounted a marker inside whichever slot matched and unmounted the last one.
 * Two different elements cannot animate between each other, so it blinked from
 * gap to gap; being one element that translates is the whole difference between
 * a flicker and something pointing at a destination.
 *
 * It also has to work in two layouts: the strip is one scrolling row, the
 * overview is a wrapping grid. A measured rect covers both without either
 * layout knowing about the marker.
 */
const InsertionMarker = ({ rect }: { rect: MarkerRect }): ReactElement => (
  <div
    aria-hidden
    className='pointer-events-none fixed z-50 w-0.5 rounded-full bg-primary transition-transform duration-150 ease-out motion-reduce:transition-none'
    style={{
      // `left`/`top` stay at 0 and the position rides entirely on a transform:
      // animating left would move this off the compositor for no reason.
      left: 0,
      top: 0,
      height: `${rect.height}px`,
      transform: `translate(${rect.x - 1}px, ${rect.y}px)`,
    }}
  />
);

/**
 * Ease a scroller to a position, on our clock rather than the browser's.
 *
 * `scrollIntoView({ behavior: 'smooth' })` is the obvious tool and the wrong one
 * here for one reason: its duration scales with distance and is not adjustable.
 * In focus mode every jump is at least a full page wide — the far end of that
 * curve — so a rail click took roughly twice as long as anything else in the
 * stream and read as the app thinking about it.
 *
 * The curve is the `cubic-bezier(0.23, 1, 0.32, 1)` the rest of Streams uses,
 * evaluated directly: it is a pure ease-out, so the sampling shortcut of solving
 * y for t is unnecessary — an ease-out quint is within a pixel of it over this
 * distance and costs one `Math.pow`.
 */
/**
 * Tweens in flight, keyed by the element they are scrolling.
 *
 * A second jump started mid-tween used to read the inline styles the first
 * tween had already overwritten, save 'none' as though it were the real value,
 * and restore that at the end — leaving the carousel with scroll-snap off for
 * the rest of the session. The two loops also fought over `scrollLeft`.
 */
const tweens = new WeakMap<HTMLElement, { frame: number; snap: string; behavior: string }>();

const tweenScroll = (strip: HTMLElement, target: number, ms = FOCUS_SCROLL_MS): void => {
  const from = strip.scrollLeft;
  const distance = Math.max(0, target) - from;
  if (Math.abs(distance) < 1) return;

  // Cancel any tween already running here and inherit the values it saved —
  // it owns the originals, because it is the one that overwrote them.
  const running = tweens.get(strip);
  if (running) cancelAnimationFrame(running.frame);

  // `scroll-behavior: smooth` is set in CSS and applies to assigning `scrollLeft`
  // as well, so each frame of this loop would otherwise kick off its own smooth
  // scroll and they would pile into treacle.
  const behavior = running ? running.behavior : strip.style.scrollBehavior;
  strip.style.scrollBehavior = 'auto';

  // Snap has to come off for the duration, and this is not optional: with
  // `scroll-snap-type: mandatory` the browser re-snaps after *every* programmatic
  // scroll, so the first frame of the tween — a few pixels — was immediately
  // yanked the whole way to the destination. Measured, a 2768px jump landed
  // inside one frame and then sat still for 200ms while the loop played out
  // against a scroller that had already arrived. The tween was real; snap was
  // eating it.
  const snap = running ? running.snap : strip.style.scrollSnapType;
  strip.style.scrollSnapType = 'none';

  const start = performance.now();
  const step = (): void => {
    const t = Math.min(1, (performance.now() - start) / ms);
    strip.scrollLeft = from + distance * (1 - Math.pow(1 - t, 5));
    if (t < 1) {
      tweens.set(strip, { frame: requestAnimationFrame(step), snap, behavior });
      return;
    }
    tweens.delete(strip);
    // Both handed back only at the end, and in this order. The final position is
    // exactly a snap point, so restoring snap here is a no-op rather than a jump.
    strip.style.scrollSnapType = snap;
    strip.style.scrollBehavior = behavior;
  };
  tweens.set(strip, { frame: requestAnimationFrame(step), snap, behavior });
};

/** True when the event came from somewhere the user is typing. */
const isTypingTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
};

/**
 * Streams — a spatial, non-modal composition of Xyne surfaces.
 *
 * A stream is an explicit list of columns you assembled; the strip is the
 * horizontally scrolling row of them. The posture is monitoring: holding five
 * things at once rather than doing one thing well.
 *
 * Two deliberate departures from the bb Cascade reference this is modelled on:
 *
 * 1. **Native horizontal scrolling instead of a transform world plus a custom
 *    wheel state machine.** Cascade translated a world div and hand-rolled wheel
 *    handling with latched axis and owner, because its rows stacked vertically.
 *    With one stream on screen, `overflow-x: auto` gives trackpad panning for free
 *    and `scrollIntoView({ inline: 'center' })` reproduces centre-with-clamp
 *    exactly. It also makes Cascade's momentum bug structurally impossible rather
 *    than carefully avoided.
 *
 * 2. **Pinned columns are siblings of the scroller, not members of it.** They
 *    hold the left edge because they are outside the thing that scrolls, so no
 *    offset maths can ever let them drift.
 *
 * Position never changes on its own. No recency reordering, ever — a strip is a
 * spatial layout and you learn where things sit.
 */
const StreamsScreen = (): ReactElement => {
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  const [layout, setLayout] = useState<StreamsLayout>(() => loadLayout(workspaceId));
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Persisted, because it is a posture rather than a gesture: you switch into
  // focus mode to do a piece of work, and having a reload throw you back into
  // the wide stream mid-task would be the tool changing its mind, not yours.
  const [focusMode, setFocusMode] = useState<boolean>(() => loadFocusMode());
  // Ids mid-collapse. Kept out of `layout` on purpose — this is a view state
  // that lasts 200ms, and persisting it would resurrect a half-closed column on
  // the next load.
  const [closing, setClosing] = useState<ReadonlySet<string>>(() => new Set());
  // What has been dropped on each column, keyed by column id. Kept out of
  // `layout` for the same reason `closing` is: this is the residue of a gesture,
  // not part of the arrangement, and persisting it would reinstate a half-typed
  // question days later.
  const [seeds, setSeeds] = useState<Record<string, ColumnSeed>>({});

  const panelRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const composerIntentRef = useRef(false);
  /** Where the strip sat before an unsolicited focus dragged it sideways. */
  const stripScrollRef = useRef(0);
  /** Timestamp until which the strip is pinned against a focus-driven scroll. */
  const restoreUntilRef = useRef(0);
  /** When the user last actually touched the strip — see the scroll guard. */
  const lastInputRef = useRef(0);

  /**
   * The stream is about to scroll on purpose — stand down.
   *
   * A jump or a re-centring is exactly as programmatic as the scroll the hold
   * exists to reject, and indistinguishable from it at the event. So the caller
   * says so, and records where it is going: without the second half the hold
   * re-arms against a stale position and drags the strip back off the column it
   * was just asked for.
   */
  const intendStripScroll = useCallback((left: number): void => {
    restoreUntilRef.current = 0;
    stripScrollRef.current = left;
  }, []);

  /** Which column the strip was last scrolled to centre on. */
  const centredOnRef = useRef<string | null>(null);
  /** False until the centring effect has run once — see the note there. */
  const arrivedRef = useRef(false);
  /** Live focus index, for scroll handlers that must not close over a stale one. */
  const focusRef = useRef(0);
  /** Live focused column id, for handlers that must not close over a stale one. */
  const focusedIdRef = useRef<string | undefined>(undefined);
  /** Live column order, so the FLIP can read it without depending on it. */
  const columnOrderRef = useRef<readonly string[]>([]);
  /** The add page, so the scroll loop can drive its arrival without a render. */
  const addPageRef = useRef<HTMLDivElement>(null);
  /** Latch, so arriving at the add page opens the palette once and not per frame. */
  const addCommittedRef = useRef(false);

  const stream = activeStream(layout);
  const columns = stream.columns;
  focusRef.current = stream.focus;
  focusedIdRef.current = stream.columns[stream.focus]?.id;
  const pinned = useMemo(() => columns.filter(c => c.pinned), [columns]);
  const scrolling = useMemo(() => columns.filter(c => !c.pinned), [columns]);

  /**
   * The stream as the navigation surfaces should see it: one entry per panel.
   *
   * An attached column is a *pane* of the channel it hangs off, not a stop of
   * its own, and every surface that lists the stream was double-counting it —
   * "#automations" and "Thread" as two rows in the dock, two cards in the
   * overview, two jump pills for one box. Worse, each of those entries would
   * navigate you to half a panel.
   *
   * The strip still renders the full list, because the strip is the one place
   * an attachment *is* a column. Everything that describes or navigates the
   * stream reads this instead.
   */
  const navColumns = useMemo(
    () => columns.filter(column => column.attachedTo === undefined),
    [columns],
  );
  const navScrolling = useMemo(
    () => scrolling.filter(column => column.attachedTo === undefined),
    [scrolling],
  );
  /** As `navScrolling`, for the pinned run — `StreamTopNav` takes the two apart. */
  const navPinned = useMemo(
    () => pinned.filter(column => column.attachedTo === undefined),
    [pinned],
  );

  /**
   * The layout exactly as it was read, so the mount pass can be told apart from a
   * real change.
   *
   * Without this the effect below fired once on mount and wrote whatever
   * `loadLayout` returned straight back to storage. In the ordinary case that is
   * a no-op dressed up as a write — it saves what it just read. In the case that
   * matters it is destructive: a read that failed returns an empty default, and
   * this effect then persisted that over a real layout before the user had
   * touched anything. `loadLayout` now keeps a copy when it cannot read, and this
   * makes sure there is nothing to keep a copy *from* in the first place.
   *
   * Identity rather than a "have I run yet" flag: the question is genuinely "is
   * this still the object that came out of storage", which stays the right answer
   * however many times the effect is invoked.
   */
  const loadedLayout = useRef(layout);

  useEffect(() => {
    if (layout === loadedLayout.current) return;
    saveLayout(layout, workspaceId);
  }, [layout, workspaceId]);

  useEffect(() => {
    saveFocusMode(focusMode);
  }, [focusMode]);

  useScope(SCOPE);

  // ----------------------------------------------------------- read state

  // `useZero` returns a fresh Proxy every render, so it can never be an effect
  // dependency — mirroring it through a ref is what keeps `markChannelRead`
  // stable, and a stable identity is the whole reason the effect below fires on
  // focus changes rather than on every render.
  const zero = useZero();
  const zeroRef = useRef(zero);
  useEffect(() => {
    zeroRef.current = zero;
  });

  /**
   * Mark a channel read, deliberately.
   *
   * Mounting a channel panel normally *is* reading it, so the panel marks itself
   * read on unmount. A stream breaks that assumption: every column is mounted at
   * once, and the whole point is watching things you have not read. So the
   * columns are told not to (`skipMarkAsRead` in `surfaces.tsx`) and Streams
   * decides for itself.
   */
  const markChannelRead = useCallback((channelId: string): void => {
    void zeroRef.current.mutate(
      mutators.channel.markChannelAsViewed({
        channelId,
        timestamp: Date.now(),
        draftMessageId: uuidv4(),
        // This mutator doubles as the channel draft's flush. Passing an empty
        // string would delete whatever the user had typed and not sent, so the
        // real draft has to be handed back in.
        draftMessage: getDraft(channelId, null) || '',
      }),
    );
  }, []);

  // ------------------------------------------------------------- mutations

  /**
   * Rewrite the active stream.
   *
   * The identity check is the load-bearing part, not a micro-optimisation. Every
   * signal in the screen funnels through here, and a new layout object re-renders
   * the whole strip — measured at 265ms of blocked main thread on an 18-column
   * stream, because `renderColumn` hands every column freshly-allocated callbacks
   * and defeats `memo(StreamColumn)`.
   *
   * The commonest caller by far is `setFocus` from a pointerdown, and most of
   * those land on the focus the stream already had: clicking inside the column you
   * are already in, which is what typing a message starts with. Returning the
   * same stream object means `setLayout` sees an unchanged state and React skips
   * the render entirely, so that whole class of click now costs nothing.
   *
   * A reducer returning its own input is the standard way to say "no change" —
   * the callers below opt in by returning `current` rather than a fresh spread.
   */
  const patchStream = useCallback((fn: (current: typeof stream) => typeof stream): void => {
    setLayout(current => {
      const at = current.streams.findIndex(candidate => candidate.id === current.activeStreamId);
      const target = current.streams[at];
      if (!target) return current;
      const next = fn(target);
      // Nothing moved. Propagating a new layout here would re-render every
      // mounted surface to arrive at the state already on screen.
      if (next === target) return current;
      const streams = current.streams.slice();
      streams[at] = next;
      return { ...current, streams };
    });
  }, []);

  /**
   * Open another stream.
   *
   * Everything transient the old stream left behind is dropped in `switchStream`
   * below — this only moves the pointer.
   */
  const chooseStream = useCallback((streamId: string): void => {
    setLayout(current => switchStream(current, streamId));
  }, []);

  /**
   * The stream verbs, each of which reports what it did.
   *
   * Applied against `layout` rather than through a `setLayout` updater, and
   * depending on `layout` for the same reason: every one of these needs the
   * stream's *name* to say anything useful, and reading it inside an updater
   * would be a side effect in a function React is free to call twice.
   *
   * Switching streams is the one verb with no toast. The whole screen changes —
   * announcing it as well would be the app narrating what you are looking at.
   */
  const newStream = useCallback((): void => {
    const next = createStream(layout);
    setLayout(next);
    const created = next.streams[next.streams.length - 1];
    if (created) toast.success(`Created "${created.name}"`);
  }, [layout]);

  const unarchiveStream = useCallback(
    (streamId: string): void => {
      const target = layout.streams.find(stream => stream.id === streamId);
      setLayout(restoreStream(layout, streamId));
      if (target) toast.success(`Restored "${target.name}"`);
    },
    [layout],
  );

  const nameStream = useCallback(
    (streamId: string, name: string): void => {
      const target = layout.streams.find(stream => stream.id === streamId);
      const next = renameStream(layout, streamId, name);
      setLayout(next);
      const renamed = next.streams.find(stream => stream.id === streamId);
      // Nothing to report when the name did not move. Committing an untouched
      // field is the ordinary way out of the rename, not an edit.
      if (!target || !renamed || renamed.name === target.name) return;
      toast.success(`Renamed to "${renamed.name}"`);
    },
    [layout],
  );

  /**
   * Put a stream away, and get out of it if it was the one you were in.
   *
   * `archiveStream` moves the pointer itself when it has to — the screen renders
   * whatever `activeStreamId` names, so a pointer left on an archived stream would
   * show a stream the switcher no longer lists.
   */
  const putStreamAway = useCallback(
    (streamId: string): void => {
      const target = layout.streams.find(stream => stream.id === streamId);
      setLayout(archiveStream(layout, streamId));
      // No Undo action here, unlike delete. Archiving is already reversible by
      // design — the stream is one submenu away under Archived — so an Undo would
      // be a second, rarer route to something the menu already does.
      if (!target) return;
      toast.success(`Archived "${target.name}"`);
    },
    [layout],
  );

  /**
   * Delete, with the stream itself held in the closure so Undo has something to
   * put back — after `deleteStream` this callback holds the only copy of it.
   *
   * Undoable even though deleting already takes a two-second hold. The hold
   * stops the accident; undo covers the case a hold cannot, which is meaning
   * it and being wrong.
   */
  const dropStream = useCallback(
    (streamId: string): void => {
      const at = layout.streams.findIndex(stream => stream.id === streamId);
      const target = layout.streams[at];
      setLayout(deleteStream(layout, streamId));
      if (!target) return;
      toast.success(`Deleted "${target.name}"`, {
        action: { label: 'Undo', onClick: () => setLayout(now => insertStream(now, target, at)) },
      });
    },
    [layout],
  );

  // The dial panel is a dev-only tool and does not ship. The settings it used
  // to drive are frozen at their settled values.
  const dev = DEV_DEFAULTS;

  // The sidenav is app chrome, mounted outside this screen, but on `bleed`
  // ground it stops having an edge to hold: the wallpaper runs from behind the
  // rail straight through the stream, and its 1px border reads as a seam across
  // that. Reaching it means a flag on the document rather than a prop — and a
  // flag that is cleaned up, unlike the wallpaper choice, because the rail must
  // get its edge back the moment you leave Streams or dial the ground away.
  // On `bleed` the app's wallpaper runs straight through the stream, and the
  // sidenav's 1px border then reads as a seam across one continuous wash. Reaching
  // it means a flag on the document rather than a prop — and a flag that is cleaned
  // up, because the rail must get its edge back the moment you leave Streams.
  useEffect(() => {
    if (dev.ground !== 'bleed') return;
    // Bracketed, not dotted: `noPropertyAccessFromIndexSignature` is on in
    // `tsconfig.app.json`, and `DOMStringMap` is an index signature.
    document.documentElement.dataset['streamGround'] = 'bleed';
    return (): void => {
      delete document.documentElement.dataset['streamGround'];
    };
  }, [dev.ground]);

  /** The width a new column takes, and what "reset width" resets to. */
  const widthForSource = useCallback(
    (source: ColumnSource): number => Math.max(dev.defaultWidth, surfaceFor(source).minWidth),
    [dev.defaultWidth],
  );

  /**
   * When a column stops counting as unread — a live setting, because none of the
   * candidates is obviously right.
   *
   * `on-leave` was the first attempt and it is subtly wrong: focus sits on
   * whatever you last clicked, so opening a thread in column B silently marked
   * column A read — a column you never looked at. `on-focus` is worse in the
   * other direction, clearing the badge on the column you are actively watching.
   * The default is `never`, and clearing is a click on the badge itself.
   */
  const focusedChannelRef = useRef<string | null>(null);

  useEffect(() => {
    const focused = columns[stream.focus];
    const channelId = focused?.source.kind === 'channel' ? focused.source.channelId : null;
    const left = focusedChannelRef.current;
    focusedChannelRef.current = channelId;
    if (left === channelId) return;
    if (dev.markRead === 'on-leave' && left) markChannelRead(left);
    if (dev.markRead === 'on-focus' && channelId) markChannelRead(channelId);
  }, [columns, stream.focus, markChannelRead, dev.markRead]);

  const setFocus = useCallback(
    (next: number): void => {
      patchStream(current => {
        const focus = Math.max(0, Math.min(next, current.columns.length));
        // Every pointerdown in every column arrives here. Most of them name the
        // focus the stream already has — see `patchStream`.
        return focus === current.focus ? current : { ...current, focus };
      });
    },
    [patchStream],
  );

  /**
   * Step focus, treating an attached pair as one stop.
   *
   * Plain `focus + delta` walks the raw column list, which in focus mode means
   * arrowing from a channel lands on the thread hanging off it — the same panel,
   * shown as its right half with its left half off screen. The pair is one page,
   * so it is also one keyboard stop, and the step continues past the attachment
   * to the next real column.
   *
   * Applied in the wide stream too, and deliberately: focus drives which column
   * the strip centres and which one keyboard verbs act on, and neither of those
   * should ever name half a panel.
   */
  const moveFocus = useCallback(
    (delta: number): void => {
      patchStream(current => {
        const step = delta > 0 ? 1 : -1;
        let focus = current.focus;
        let remaining = Math.abs(delta);
        while (remaining > 0) {
          let next = focus + step;
          // Walk over attachments — they are part of the page you are leaving or
          // the one you are arriving at, never a stop of their own.
          while (
            next > 0 &&
            next < current.columns.length - 1 &&
            current.columns[next]?.attachedTo !== undefined
          ) {
            next += step;
          }
          if (next < 0 || next > current.columns.length - 1) break;
          focus = next;
          remaining -= 1;
        }
        // Landing on an attachment at either end of the stream — where the walk
        // above runs out of room — resolves to its parent rather than stopping
        // on half a panel.
        const landed = current.columns[focus];
        if (landed?.attachedTo !== undefined) {
          const parent = current.columns.findIndex(column => column.id === landed.attachedTo);
          if (parent >= 0) focus = parent;
        }
        // Clamped at both ends, so holding an arrow key at the edge of the stream
        // would otherwise rewrite the layout once per repeat for no movement.
        return focus === current.focus ? current : { ...current, focus };
      });
    },
    [patchStream],
  );

  // ------------------------------------------------------------ one of each

  /**
   * A column already showing this source, if there is one.
   *
   * The stream holds at most one column per source. Two `#product` columns are
   * indistinguishable in the strip, in the overview and in the jump panel — you
   * cannot tell which one you are looking at or which one a notification meant,
   * and the second one is almost always a mis-click rather than an intention.
   */
  const findExisting = useCallback(
    (source: ColumnSource): Column | undefined => {
      // Ask AI is exempt: asking for another one is asking for another one, not
      // a request to be shown the one already open. See `allowsDuplicates`.
      if (allowsDuplicates(source)) return undefined;
      const key = sourceKey(source);
      return columns.find(column => sourceKey(column.source) === key);
    },
    [columns],
  );

  /**
   * Say "it is already here" by lighting the column up for a moment.
   *
   * Silently doing nothing when you ask for a column you already have reads as
   * a broken button. Travelling there and flashing it answers the question you
   * were actually asking, which was where is it.
   */
  const [flashId, setFlashId] = useState<string | null>(null);
  const flashTimerRef = useRef<number | null>(null);

  const flashColumn = useCallback((columnId: string): void => {
    setFlashId(columnId);
    if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(() => setFlashId(null), COLUMN_FLASH_MS);
  }, []);

  useEffect(
    () => (): void => {
      if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
    },
    [],
  );

  // `jumpTo` is defined further down, after the geometry it needs. Reaching it
  // through a ref keeps the stream mutations up here where they belong rather than
  // shuffling the whole file to satisfy declaration order.
  const jumpToRef = useRef<(columnId: string) => void>(() => {});

  /**
   * Travel to a column that is already open, carrying the request with you.
   *
   * Dedupe alone was a downgrade for the case it fires on most: clicking a feed
   * row for a channel you already have open took you to the column and then left
   * you to find the message yourself, which is exactly the work the feed exists
   * to save. So the request's own deep link is applied to the column that
   * already exists — same panel, now pointed at the thing you clicked.
   *
   * Sources are keyed by channel, not by conversation, so this changes the deep
   * link without changing the column's identity.
   */
  const revealExisting = useCallback(
    (column: Column, requested?: ColumnSource): void => {
      if (
        requested?.kind === 'channel' &&
        column.source.kind === 'channel' &&
        requested.focusConversationId &&
        requested.focusConversationId !== column.source.focusConversationId
      ) {
        patchStream(current => ({
          ...current,
          columns: current.columns.map(candidate =>
            candidate.id === column.id
              ? {
                  ...candidate,
                  source: {
                    ...candidate.source,
                    focusConversationId: requested.focusConversationId,
                  } as ColumnSource,
                }
              : candidate,
          ),
        }));
      }
      jumpToRef.current(column.id);
      flashColumn(column.id);
    },
    [flashColumn, patchStream],
  );

  /**
   * Add from the palette — always at the end.
   *
   * The palette *is* the last slot in the strip, so the new column appears where
   * the thing you clicked was standing. Inserting next to the focused column
   * instead meant scrolling to the end, clicking add, and being thrown back to
   * the middle where focus happened to be.
   *
   * Columns opened *by* another column still land beside it — see `openBeside`.
   * The difference is where the action came from: a slot at the end means "put
   * it here", a row inside a column means "put it next to me".
   */
  /**
   * Columns that came into existence just now, and are still arriving.
   *
   * Stream-held rather than derived from mount inside the column, because every
   * column mounts — on load, on a stream switch, on coming back to the tab — and
   * only the ones that were *created* should animate. Membership is temporary:
   * an id goes in when it is made and comes out when the entrance is over, so
   * this never grows and never needs clearing.
   */
  const [opening, setOpening] = useState<ReadonlySet<string>>(() => new Set());

  const markOpening = useCallback((id: string): void => {
    // Reduced motion gets the column, not the journey — same trade the close
    // collapse makes.
    if (scrollBehavior() === 'auto') return;
    setOpening(current => new Set(current).add(id));
    window.setTimeout(() => {
      setOpening(current => {
        if (!current.has(id)) return current;
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }, COLUMN_OPEN_MS);
  }, []);

  const addColumn = useCallback(
    (source: ColumnSource): void => {
      setPaletteOpen(false);
      // At most one column per source — go to the one that exists rather than
      // stacking a second, indistinguishable copy of it.
      const existing = findExisting(source);
      if (existing) {
        revealExisting(existing, source);
        return;
      }
      const created = makeColumn(source, widthForSource(source));
      markOpening(created.id);
      patchStream(current => ({
        ...current,
        columns: [...current.columns, created],
        focus: current.columns.length,
      }));
    },
    [patchStream, widthForSource, findExisting, revealExisting, markOpening],
  );

  // Close is view-only: it removes the column from the stream and touches nothing
  // else. Closing a channel column must never read as leaving the channel.
  //
  // Two steps, because removing it outright was the harshest thing on the page:
  // every column to the right jumped left by 320px with no warning. So the
  // column first collapses in place, and only then leaves the stream.
  const removeColumn = useCallback(
    (id: string): void => {
      patchStream(current => {
        const index = current.columns.findIndex(c => c.id === id);
        if (index < 0) return current;
        // A parent takes its attachment with it. The attached column is a pane
        // of the panel being closed, not a column that happens to sit beside it
        // — leaving it behind would strand a thread with no channel next to it
        // and no way to tell it was ever part of one.
        const held = current.columns.find(c => c.attachedTo === id)?.id;
        const next = current.columns.filter(c => c.id !== id && c.id !== held);

        // Where focus lands. Holding the *index* is what made closing a pane in
        // focus mode travel: the pane's slot is immediately filled by the column
        // to its right, so "same index" quietly means "the next column", and
        // focus mode then scrolled there. You closed a pane; you did not ask to
        // go anywhere.
        //
        // A pane hands focus back to its parent — the channel you were reading,
        // which is still on screen. Anything else clamps to the slot it left.
        const parentId = current.columns[index]?.attachedTo;
        let focus = current.focus;
        if (current.focus === index) {
          const parentAt = parentId ? next.findIndex(c => c.id === parentId) : -1;
          focus = parentAt >= 0 ? parentAt : index;
        } else if (current.focus > index) {
          focus = current.focus - 1;
        }
        return {
          ...current,
          columns: next,
          focus: Math.max(0, Math.min(focus, next.length - 1)),
        };
      });
      setClosing(current => {
        if (!current.has(id)) return current;
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    },
    [patchStream],
  );

  const closeColumn = useCallback(
    (id: string): void => {
      // Reduced motion skips the collapse rather than slowing it: the point of
      // the animation is to soften a jump, and someone who has asked for less
      // movement is better served by the jump than by a longer one.
      if (scrollBehavior() === 'auto') {
        removeColumn(id);
        return;
      }
      // Both halves collapse at once. `removeColumn` drops the attachment along
      // with its parent either way, but without marking it here it would sit at
      // full width until the instant its parent finished collapsing and then
      // vanish — a pane disappearing out of a panel that was mid-animation.
      const held = attachmentOf(columns, id)?.id;
      setClosing(current => {
        if (current.has(id)) return current;
        const next = new Set(current).add(id);
        if (held) next.add(held);
        return next;
      });
      window.setTimeout(() => removeColumn(id), COLUMN_CLOSE_MS);
    },
    [removeColumn, columns],
  );

  const setWidth = useCallback(
    (id: string, pixels: number): void => {
      patchStream(current => {
        const at = current.columns.findIndex(column => column.id === id);
        const target = current.columns[at];
        if (!target) return current;
        const width = Math.max(surfaceFor(target.source).minWidth, clampWidth(pixels));
        // A resize drag spends most of its life against a clamp — the column has
        // hit its minimum or the strip's maximum and the pointer keeps going.
        // Every one of those frames used to rewrite the layout and re-render the
        // stream to arrive at the width it already had.
        if (width === target.width) return current;
        const columns = current.columns.slice();
        columns[at] = { ...target, width };
        return { ...current, columns };
      });
    },
    [patchStream],
  );

  // Insert beside a specific column rather than beside the focused one: a feed
  // row opening its conversation should land next to *that feed*, even if focus
  // has since moved elsewhere.
  //
  // Still one column per source. A feed pointing at three threads in #product
  // used to open three #product columns, which is the duplicate problem at its
  // worst — three identical headers, and no way to tell which thread each was
  // showing. Now it travels to the one that exists.
  const openBeside = useCallback(
    (fromColumnId: string, source: ColumnSource): void => {
      const existing = findExisting(source);
      if (existing) {
        revealExisting(existing, source);
        return;
      }
      patchStream(current => {
        const from = current.columns.findIndex(column => column.id === fromColumnId);
        const at = from >= 0 ? from + 1 : current.columns.length;

        // An item opened out of a channel does not become a column of its own —
        // it fills that channel's one slot, and the pair renders as a single
        // split panel. Anything else (a feed opening a channel, a palette pick)
        // keeps the old behaviour and lands as a free column.
        const host = hostFor(current.columns, fromColumnId);
        if (host && acceptsAttachment(host) && isAttachingSource(source)) {
          const held = attachmentOf(current.columns, host.id);

          // The slot is occupied: swap what is in it rather than adding a
          // second one. Same column id, same width — so the pane you are
          // looking at changes contents without the strip moving at all, which
          // is the entire reason browsing a channel does not cost a column per
          // click.
          if (held) {
            return {
              ...current,
              columns: current.columns.map(column =>
                column.id === held.id ? { ...column, source } : column,
              ),
              focus: current.columns.findIndex(column => column.id === held.id),
            };
          }

          // Empty slot: open one, immediately right of the host. Width comes
          // from `widthForSource` — the same function that sizes a standalone
          // column — so detaching later changes this column's width by exactly
          // zero, and the only thing that animates is the box around it.
          const hostAt = current.columns.findIndex(column => column.id === host.id);
          const slot = hostAt >= 0 ? hostAt + 1 : current.columns.length;
          const next = current.columns.slice();
          const attached = {
            ...makeColumn(source, widthForSource(source)),
            attachedTo: host.id,
            // Inherits the host's pinned state, and it has to.
            //
            // Pinned and scrolling columns render in two different containers —
            // the pinned run sits outside the scroller entirely. `makeColumn`
            // never sets `pinned`, so opening a pane from a pinned channel put
            // the parent in one container and its pane in the other: a pair that
            // is meant to be one box, torn across a boundary, with the seam and
            // the joined borders drawn against neighbours they were never next
            // to. `settleAttachments` already enforces this rule, but only at
            // load — which is why it survived a reload and broke on every open.
            ...(host.pinned === true && { pinned: true as const }),
          };
          markOpening(attached.id);
          next.splice(slot, 0, attached);
          return { ...current, columns: next, focus: slot };
        }

        const next = current.columns.slice();
        const created = makeColumn(source, widthForSource(source));
        markOpening(created.id);
        next.splice(at, 0, created);
        return { ...current, columns: next, focus: at };
      });
    },
    [patchStream, widthForSource, findExisting, revealExisting, markOpening],
  );

  const updateSource = useCallback(
    (columnId: string, source: ColumnSource): void => {
      patchStream(current => ({
        ...current,
        columns: current.columns.map(column =>
          column.id === columnId ? { ...column, source } : column,
        ),
      }));
    },
    [patchStream],
  );

  /**
   * Every column in every *live* stream.
   *
   * Wider than the strip needs, and deliberately: it is what lets the switcher
   * say a stream you are not in has something in it. The cost is one
   * renders-nothing probe per column and no extra subscriptions at all —
   * `useColumnActivity` reads workspace-wide hooks (`useAllUnreadCount`,
   * `useAllVisibleChannels`) that the sidebar already holds open, not a query
   * per column.
   *
   * Archived streams are excluded. A stream you put down should cost nothing, which
   * is most of what archiving means.
   */
  const watchedColumns = useMemo(
    () => liveStreams(layout).flatMap(candidate => candidate.columns),
    [layout],
  );

  // One activity map for every live stream, so the strip knows what is happening
  // in columns scrolled out of sight and the switcher knows about streams that
  // are not on screen at all.
  const {
    activity: streamActivity,
    probes: activityProbes,
    report: reportActivity,
  } = useStreamActivity(watchedColumns);

  /**
   * Stream activity with each attached pane's unread folded into its parent's.
   *
   * `navColumns` drops attached panes from every list that describes the stream,
   * which is right — a pane is not a stop of its own. But dropping the row also
   * dropped its unread, and the folded dock's badge is a sum over exactly that
   * list: a mention arriving in a thread pane would leave the collapsed dock
   * reading "nothing to see" while something inside the stream was waiting for
   * you. The badge is the whole reason folding the dock is safe, so it
   * under-reporting is worse than an extra row would have been.
   *
   * So the pane keeps its own dot in the strip, where it is a column, and lends
   * its count to its parent everywhere the stream is summarised. One entry per
   * stop, and the number still true.
   *
   * Returns the original map untouched when nothing is attached, so the common
   * case allocates nothing and the navigators' memos keep their identity.
   */
  const navActivity = useMemo(() => {
    const attached = columns.filter(column => column.attachedTo !== undefined);
    if (attached.length === 0) return streamActivity;
    const merged: Record<string, ColumnActivity> = { ...streamActivity };
    for (const pane of attached) {
      const parentId = pane.attachedTo;
      if (parentId === undefined) continue;
      const own = merged[pane.id] ?? IDLE;
      const parent = merged[parentId] ?? IDLE;
      merged[parentId] = {
        count: parent.count + own.count,
        hasNew: parent.hasNew || own.hasNew,
      };
    }
    return merged;
  }, [columns, streamActivity]);

  const actions = useMemo(
    () => ({ openBeside, updateSource, reportActivity, closeColumn }),
    [openBeside, updateSource, reportActivity, closeColumn],
  );

  // Attachments open as columns rather than as the app's full-screen viewer.
  // The only item kind that cannot come through `columnIntent`, because a file
  // click is an actor message rather than a navigation.
  useAttachmentColumns(openBeside, focusedIdRef);

  /**
   * Clear a column's badge on purpose.
   *
   * The badge is the control. Nothing else in the stream can honestly claim you
   * read a column — mounting it certainly cannot, and neither can focus, which
   * moves whenever you click anything. A click on the thing that says "unread"
   * is unambiguous, so that is the one gesture wired to it.
   */
  const clearColumnActivity = useCallback(
    (column: Column): void => {
      if (column.source.kind === 'channel') markChannelRead(column.source.channelId);
    },
    [markChannelRead],
  );

  /**
   * Something was dropped on a column.
   *
   * The stream decides what a drop *means*, which is why this lives here and not
   * in the surface registry: the surface said it takes conversations, and the
   * stream is what knows a conversation becomes a prepared question. A board would
   * declare the same `accepts` and mean "make a ticket", and only this function
   * would grow a branch.
   *
   * Focus moves to the column as well. A drop is a deliberate act aimed at a
   * specific panel, and leaving focus where it was would put the question you
   * just prepared somewhere you are not looking.
   */
  const dropOnColumn = useCallback(
    (columnId: string, item: StreamItem): void => {
      setSeeds(current => ({
        ...current,
        [columnId]: {
          query: questionFor(item),
          // Monotonic per column, so dropping the same thread twice seeds twice
          // rather than looking broken the second time.
          nonce: (current[columnId]?.nonce ?? 0) + 1,
        },
      }));
      // Resolved inside the updater rather than against a captured array, so the
      // index is the one that exists at the moment of the drop.
      patchStream(current => {
        const index = current.columns.findIndex(column => column.id === columnId);
        return index >= 0 ? { ...current, focus: index } : current;
      });
    },
    [patchStream],
  );

  const togglePin = useCallback(
    (id: string): void => {
      patchStream(current => {
        const target = current.columns.find(column => column.id === id);
        if (!target) return current;
        const pinned = !target.pinned;
        // The attachment follows, and this is structural rather than polite: the
        // strip renders pinned columns in a different container from scrolling
        // ones, so a pair whose halves disagree about pinning is a pair drawn in
        // two separate places — the parent held at the left edge, its
        // attachment adrift in the scroller sharing a border with a stranger.
        const held = current.columns.find(column => column.attachedTo === id)?.id;
        return {
          ...current,
          columns: current.columns.map(column =>
            column.id === id || column.id === held ? { ...column, pinned } : column,
          ),
        };
      });
    },
    [patchStream],
  );

  /**
   * Promote an attached column to one that stands on its own.
   *
   * The entire operation is one field going away, and that is the payoff of
   * modelling a pair as two sibling columns rather than as two panes inside one:
   * nothing is re-parented, so React never unmounts the surface. A thread keeps
   * its scroll position, a document keeps its editor session, a video keeps
   * playing. The column does not even change width — `openBeside` sized it with
   * the same `widthForSource` a standalone column would have got, precisely so
   * that this moment costs nothing.
   *
   * What visibly changes is the box: the pair's shared border resolves into two,
   * the seam turns back into a gutter, and the parent's slot is now empty so the
   * next thing you open from it arrives fresh instead of replacing this.
   */
  const detachColumn = useCallback(
    (id: string): void => {
      patchStream(current => ({
        ...current,
        columns: current.columns.map(column => {
          if (column.id !== id || column.attachedTo === undefined) return column;
          const { attachedTo: _freed, ...standalone } = column;
          return standalone;
        }),
      }));
    },
    [patchStream],
  );

  const reorder = useCallback(
    (from: number, to: number): void => {
      patchStream(current => {
        if (from < 0 || to < 0 || from >= current.columns.length || to >= current.columns.length) {
          return current;
        }
        const moved = moveColumn(current.columns, from, to);
        if (!moved) return current;
        return { ...current, columns: moved.columns, focus: moved.focus };
      });
    },
    [patchStream],
  );

  const reorderFocused = useCallback(
    (delta: number): void => {
      patchStream(current => {
        const from = current.focus;
        const to = from + delta;
        // `moveColumn` refuses a pane, so shift+H / shift+L over one is a no-op
        // rather than the silent re-parenting the old splice performed.
        const moved = moveColumn(current.columns, from, to);
        if (!moved) return current;
        return { ...current, columns: moved.columns, focus: moved.focus };
      });
    },
    [patchStream],
  );

  // Ask AI, anywhere in the app, opens a global drawer over whatever you were
  // doing. On a stream that is exactly wrong: the drawer covers the columns you
  // assembled to watch. So while Streams is mounted, an Ask AI open becomes a
  // column instead — the same conversation, holding a slot you chose, alongside
  // everything else rather than on top of it.
  //
  // Intercepting the actor rather than every trigger means this works for the
  // sidebar sparkle, a channel header's Ask AI, and anything added later.
  const aiOpen = useSelector(xyneAIActor, state => state.matches('open'));
  const aiChannelId = useSelector(xyneAIActor, state => state.context.channelId);

  useEffect(() => {
    if (!aiOpen) return;
    xyneAIActor.send({ type: 'CLOSE' });
    const source: ColumnSource = { kind: 'agent', ...(aiChannelId && { channelId: aiChannelId }) };
    const key = sourceKey(source);
    setLayout(current => {
      const at = current.streams.findIndex(candidate => candidate.id === current.activeStreamId);
      const target = current.streams[at];
      if (!target) return current;
      const streams = current.streams.slice();
      // Already watching this one — focus it rather than stacking a duplicate.
      const existing = target.columns.findIndex(column => sourceKey(column.source) === key);
      if (existing >= 0) {
        streams[at] = { ...target, focus: existing };
        return { ...current, streams };
      }
      // Beside the column it was triggered from — an Ask AI about #incidents
      // belongs next to #incidents, not at the far end of the stream.
      const insertAt = Math.min(target.focus + 1, target.columns.length);
      const columnsNext = target.columns.slice();
      const created = makeColumn(source, widthForSource(source));
      markOpening(created.id);
      columnsNext.splice(insertAt, 0, created);
      streams[at] = { ...target, columns: columnsNext, focus: insertAt };
      return { ...current, streams };
    });
  }, [aiOpen, aiChannelId, widthForSource, markOpening]);

  // ------------------------------------------------------------- geometry

  const focusedId = columns[stream.focus]?.id;

  /**
   * A focus transition is in flight.
   *
   * All it gates now is the carousel's scroll listener, which must not reassign
   * focus while the stream is mid-change. There is no longer a width clock, a tick,
   * or a pinned body width to track: the FLIP below owns the entire animation and
   * layout is final before the first frame of it.
   */
  const transitioningRef = useRef(false);

  /**
   * The mode change's clock — the only thing that lets a width animate.
   *
   * Zero at rest, so a resize drag stays glued to the cursor; `dev.focusMs` only
   * while a focus transition is in flight. Armed in the *same* commit as the mode
   * flip, because `width` is permanently in the transition list and only its
   * duration moves — which is the case a browser will interpolate.
   */
  const [widthMs, setWidthMs] = useState(0);
  const [focusTick, setFocusTick] = useState(0);
  /** The live transition length, for handlers that must not be rebuilt for it. */
  const durationRef = useRef(dev.focusMs);
  durationRef.current = dev.focusMs;

  useEffect(() => {
    if (focusTick === 0) return;
    const timer = window.setTimeout(() => {
      setWidthMs(0);
      transitioningRef.current = false;
    }, dev.focusMs + 32);
    return (): void => window.clearTimeout(timer);
  }, [focusTick, dev.focusMs]);

  /**
   * Enter or leave focus mode.
   *
   * Entering adopts the column you are actually looking at rather than whichever
   * one `stream.focus` holds — in the wide stream focus and visibility are
   * deliberately independent, so without this it travelled to a column you last
   * clicked, possibly minutes ago.
   *
   * `at` names the column to enter *on*. It is not optional in spirit: focus
   * mode is now only ever entered from a column's own button, which names one.
   * The centred-column fallback is what the stream header used to need, kept as
   * the answer for a caller that has no column in hand.
   */
  const flipFocusMode = useCallback(
    (next: boolean, at?: number): void => {
      if (next) {
        const target = at ?? columnAtCentreRef.current();
        if (target >= 0) setFocus(target);
      }
      if (scrollBehavior() !== 'auto') {
        transitioningRef.current = true;
        setWidthMs(dev.focusMs);
        setFocusTick(tick => tick + 1);
      }
      setFocusMode(next);
    },
    [setFocus, dev.focusMs],
  );

  // Widths are stored in pixels and used as-is. Nothing here derives a size from
  // the viewport: a column keeps the width you gave it when the window changes.
  //
  // Clamped at the point of use as well as on write and on load, so no stored or
  // in-memory value can ever render a column you cannot scroll to the end of.
  //
  // Focus mode does not pass through here at all: the focused column takes its
  // width from CSS (see `fill` in StreamColumn), so nothing measures a strip
  // whose width the rail is still changing. The stored width is never written,
  // which is why leaving the mode restores every column exactly.
  /** The width a column actually occupies right now. */
  const widthFor = useCallback((column: Column): number => clampWidth(column.width), []);

  // The add slot is a column-sized citizen of the strip: it occupies exactly the
  // space the column it creates will occupy.
  const addSlotWidth = dev.defaultWidth;

  // Drives the palette's "in stream" state, so it lists only what genuinely cannot
  // be added twice — Ask AI stays addable however many are already open.
  const presentSources = useMemo(
    () =>
      new Set(
        columns
          .filter(column => !allowsDuplicates(column.source))
          .map(column => sourceKey(column.source)),
      ),
    [columns],
  );

  const columnOrder = useMemo(() => columns.map(column => column.id), [columns]);
  columnOrderRef.current = columnOrder;
  /** Read by `normalizeSlot`, which runs from pointer events rather than render. */
  const columnsRef = useRef(columns);
  columnsRef.current = columns;

  // Published to anything embedded in a column that wants to know what the stream
  // is watching. Ask AI's context picker reads this and puts the stream's own
  // channels above the workspace-wide list — see `StreamContext`.
  const streamChannelIds = useMemo(
    () =>
      columns.flatMap(column =>
        column.source.kind === 'channel' ? [column.source.channelId] : [],
      ),
    [columns],
  );

  /**
   * Publish the stream's channels to the rest of the app.
   *
   * Ask AI's context picker reads this to offer what the stream is already
   * showing, and it lives outside Streams entirely — so the two meet on the
   * actor rather than on an import in either direction.
   *
   * Cleared on unmount, not left standing: Ask AI outlives this screen, and a
   * stale "in this stream" group offering channels from a screen the user has
   * left is worse than no group at all.
   */
  useEffect(() => {
    streamsActor.send({ type: 'CHANNELS_CHANGED', channelIds: streamChannelIds });
  }, [streamChannelIds]);

  useEffect(
    () => () => {
      streamsActor.send({ type: 'STREAM_CLOSED' });
    },
    [],
  );

  /**
   * Raise or drop the veil over the stream, straight on the DOM.
   *
   * Not React state. This fires on every pointer entry to the tab row, and the
   * stream under it is a live view of several channels — putting a hover into the
   * render tree would re-render all of them to change one element's opacity.
   * The attribute drives a CSS transition that owns the rest.
   */
  /**
   * Rows that are taken out of the header's flow and centred on the window.
   *
   * The two have opposite reasons and the same need. `window` is an aperture
   * over the run of columns you can see, so it has to sit where that run is.
   * `index` is a map of the whole stream, and a map belongs over the middle of
   * what it maps — laid out in the title group it would start wherever the
   * stream's name happens to end, which centres it on the header rather than on
   * the strip.
   *
   * Both consequently give the add button back to the verbs: neither is a run of
   * tabs with an end for it to ride.
   */

  /**
   * Go to a column, from anywhere.
   *
   * Focus alone is not enough, which is why the pills did nothing when you
   * clicked them: **focus is not visibility.** You can scroll the strip away
   * from the focused column freely, and then a pill pointing at that same column
   * calls `setFocus` with the index it already has — no state change, no effect,
   * no scroll. So the scroll happens here, unconditionally, and the centring
   * effect is told this one is handled so it does not fire a second one behind it.
   *
   * Except in focus mode, where scrolling here would be measured against a layout
   * that is about to change: the column being jumped to is the one that grows to
   * fill the scroller, and it has not grown yet. Handing the scroll to the effect
   * means it runs after the new widths are committed and lands on the real
   * geometry rather than the one it is replacing.
   */
  /**
   * Which column is currently under the middle of the strip.
   *
   * Rects, for the same reason as everywhere else here: `offsetLeft` is relative
   * to the nearest positioned ancestor, so comparing it against a scroll-space
   * centre biases every column by the same constant — and a constant bias still
   * picks the wrong column, just consistently.
   */
  /**
   * Where the scrolling columns sit, computed rather than measured.
   *
   * The pinned run owns the left edge when it exists, and the scroller's own
   * padding changes to match — so the lead is read from the same condition the
   * style uses rather than being restated as a constant.
   */
  const [stripWidth, setStripWidth] = useState(0);
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return undefined;
    const measure = (): void => setStripWidth(strip.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(strip);
    return (): void => observer.disconnect();
  }, []);

  /**
   * A focus-mode page, in pixels.
   *
   * Focus columns are sized by CSS — `calc(100% - peek)` against the strip's
   * content box — so their width is not `column.width` and cannot be read from
   * state directly. It can be *derived*, and it has to be derived rather than
   * measured once: a cached number goes stale the moment anything changes the
   * viewport, and things do. Arc and Dia slide a sidebar in and out, the nav
   * rail animates, windows resize. `stripWidth` is backed by a `ResizeObserver`
   * on the strip itself, so every one of those updates this on the same frame
   * the layout changes.
   *
   * `100%` resolves against the content box, so the strip's own padding comes
   * off first. Verified against the DOM: 1856 client − 4 padding − 0 peek =
   * 1852, which is what the column measures.
   */
  const focusPageWidth = useMemo(() => {
    const padX = (pinned.length > 0 ? RING_GUTTER : STREAM_LEFT_INSET) + RING_GUTTER;
    const peek = dev.focusPeek ? FOCUS_PEEK : 0;
    return Math.max(0, stripWidth - padX - peek);
  }, [stripWidth, pinned.length, dev.focusPeek]);

  /**
   * What one column occupies along the strip, including the handle after it.
   *
   * A pair is one page split between two columns, so the two halves plus the
   * seam between them come to exactly what a lone column comes to — which is
   * why paging lands the same either way.
   */
  const strideFor = useCallback(
    (column: Column): number => {
      if (!focusMode) return widthFor(column) + HANDLE_PX;
      const partner =
        column.attachedTo !== undefined
          ? columns.find(candidate => candidate.id === column.attachedTo)
          : attachmentOf(columns, column.id);
      if (!partner) return focusPageWidth + HANDLE_PX;
      const total = widthFor(column) + widthFor(partner);
      const share = total > 0 ? widthFor(column) / total : 1;
      return (focusPageWidth - HANDLE_PX) * share + HANDLE_PX;
    },
    [focusMode, focusPageWidth, widthFor, columns],
  );

  const stripLead = pinned.length > 0 ? RING_GUTTER : STREAM_LEFT_INSET;
  const scrollingStrides = useMemo(
    () =>
      columnStrides(
        scrolling.map(column => strideFor(column) - HANDLE_PX),
        stripLead,
      ),
    [scrolling, strideFor, stripLead],
  );

  const scrollingIndexOf = useMemo(() => {
    const index = new Map<string, number>();
    scrolling.forEach((column, at) => index.set(column.id, at));
    return index;
  }, [scrolling]);

  /**
   * Each tab's column in the strip's scroll space, for the top nav to follow.
   *
   * The same arithmetic `columnBox` uses, and `assertStridesMatchDom` holds it
   * to the DOM at rest: a column's left edge on screen is
   * `toClientX(strides.left[i], strip, stripLead)`, so in scroll space it is
   * `strides.left[i] + stripLead`. Handed over rather than measured, because a
   * windowed strip has no node for most columns.
   */
  const navSpans = useMemo(() => {
    const spans = new Map<string, { start: number; end: number }>();
    for (const column of navScrolling) {
      const at = scrollingIndexOf.get(column.id);
      if (at === undefined) continue;
      const start = (scrollingStrides.left[at] ?? 0) + stripLead;
      spans.set(column.id, { start, end: start + (scrollingStrides.width[at] ?? 0) });
    }
    return spans;
  }, [navScrolling, scrollingIndexOf, scrollingStrides, stripLead]);

  /**
   * Where a column is on screen, for anything that has to answer that about a
   * column it cannot see.
   *
   * Three sources, and which one applies is a property of the column rather
   * than a preference:
   *
   * - **Scrolling columns** come from `scrollingStrides`. This is the case the
   *   whole file exists for: after virtualisation an off-screen column has no
   *   node, so the only honest answer is the computed one.
   * - **Pinned columns** are measured. They render in their own run outside the
   *   scroller and never virtualise, so their node is always there and always
   *   right — and the strides deliberately do not cover them.
   * - **Focus mode** is measured throughout, because width there is a
   *   percentage of the strip rather than `column.width`, so the strides do not
   *   describe it. Focus mode is not virtualised yet; when it is, it brings its
   *   own sizing with it.
   */
  const columnBox = useCallback(
    (id: string): ColumnBox | null => {
      const measure = (): ColumnBox | null => {
        const node = panelRef.current?.querySelector<HTMLElement>(`[data-column="${id}"]`);
        if (!node) return null;
        const rect = node.getBoundingClientRect();
        return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      };
      const strip = stripRef.current;
      const at = scrollingIndexOf.get(id);
      // Measured only where the strides cannot answer: a pinned column, which
      // lives outside the scroller and is not in them, and a focus transition,
      // where the strides already hold the destination while the DOM is still
      // on its way there.
      //
      // Focus mode itself is computed like anything else now that it is
      // windowed. It used to measure, which was correct while every page was
      // mounted and became the reason the navigator died the moment it was
      // not: a jump asks where a column is *because it cannot see it*, and an
      // unmounted page has no node to measure, so `columnBox` returned null and
      // the jump gave up without moving.
      if (strip === null || at === undefined || widthMs > 0) return measure();
      const band = columnBand(strip, RING_GUTTER);
      return {
        left: toClientX(scrollingStrides.left[at] ?? 0, strip, stripLead),
        top: band.top,
        width: scrollingStrides.width[at] ?? 0,
        height: band.height,
      };
    },
    [scrollingIndexOf, scrollingStrides, stripLead, widthMs],
  );

  const columnAtCentre = useCallback((): number => {
    const strip = stripRef.current;
    if (!strip) return -1;
    const stripRect = strip.getBoundingClientRect();
    const centre = stripRect.left + stripRect.width / 2;
    let best = -1;
    let bestDistance = Infinity;
    columnOrder.forEach((id, index) => {
      const box = columnBox(id);
      if (!box) return;
      const distance = Math.abs(box.left + box.width / 2 - centre);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    });
    return best;
  }, [columnOrder, columnBox]);

  // Published through a ref so the scroll listener below can use it without
  // taking it as a dependency — re-attaching a scroll handler whenever the stream
  // changes is churn the listener does not need.
  const columnAtCentreRef = useRef(columnAtCentre);
  columnAtCentreRef.current = columnAtCentre;

  const jumpTo = useCallback(
    (columnId: string): void => {
      const index = columnOrder.indexOf(columnId);
      if (index >= 0) setFocus(index);

      // Focus mode hands the trip to the centring effect rather than making it
      // here, and the reason is ordering. That mode is a snap carousel, so a
      // page can only be landed on if it has a snap point — which means it has
      // to be *mounted*. Now that focus mode is windowed, the page being jumped
      // to usually is not: the range only admits it once focus has changed, and
      // focus changes when React commits, which has not happened yet on this
      // line. Scrolling here therefore aimed at a position with no snap target
      // and the browser pulled it straight back to the nearest mounted page —
      // the navigator moving for one column in six, depending on whether the
      // target happened to already be in the window.
      //
      // The centring layout effect runs after that commit, with the page in the
      // document and its snap point with it. Deliberately not claiming
      // `centredOnRef` here is what lets it fire.
      if (focusMode) return;

      // Claimed so the centring effect sees this trip as already handled.
      // Without it, that effect fired `trackFocusedColumn` on top of this one —
      // and that pins `scrollLeft` every frame with `scroll-behavior: auto`,
      // which is precisely a snap.
      centredOnRef.current = columnId;
      const strip = stripRef.current;
      if (!strip) return;

      // Pinned columns live outside the scroller and are always on screen, so
      // there is nothing to scroll to — focus is the whole trip.
      if (!scrollingIndexOf.has(columnId)) return;

      // Computed, not measured, and this is the jump that most needs it: the
      // whole point of jumping to a column is that you cannot see it, which
      // after virtualisation is exactly when it has no node. Asking the DOM
      // here used to fall out through `if (!node) return` — a jump to an
      // off-screen column that silently did nothing at all.
      const box = columnBox(columnId);
      if (!box) return;
      const stripRect = strip.getBoundingClientRect();
      const delta = box.left + box.width / 2 - (stripRect.left + stripRect.width / 2);

      // A jump arrives. It never travels, and the reason is not taste.
      //
      // A smooth scroll is an animation the browser runs internally for
      // hundreds of milliseconds, and *any* assignment to `scrollLeft` during
      // it cancels it where it stands. A column finishing its load in that
      // window does exactly that, through the guard that stops a mounting
      // surface dragging the strip — so the jump would stop partway, or, if the
      // load landed early, never visibly start. Which load lands when is not
      // knowable, so the failure was intermittent: the same button did nothing,
      // then worked, then did nothing.
      //
      // Arriving outright removes the window rather than defending it. It is
      // also cheaper: gliding drags the mounted range across every column in
      // between and builds each one on the way past, where going straight there
      // builds the destination alone.
      const target = Math.max(0, strip.scrollLeft + delta);
      intendStripScroll(target);
      // `instant`, not `auto`. `auto` defers to CSS, and the strip carries
      // `scroll-smooth` — so the glide this exists to avoid would happen
      // anyway, via the stylesheet instead of the call.
      strip.scrollTo({ left: target, behavior: 'instant' });
    },
    [columnOrder, setFocus, focusMode, columnBox, scrollingIndexOf, intendStripScroll],
  );

  // Published for the stream mutations above, which need to travel to a column
  // that already exists but are declared before the geometry this depends on.
  useEffect(() => {
    jumpToRef.current = jumpTo;
  }, [jumpTo]);

  /**
   * Open on the column the "Added to …" toast's "View" asked for.
   *
   * Arriving at Streams deliberately does not travel to the focused column (see
   * the centring effect), so a column added from elsewhere, which goes on the
   * end, was the one thing you could not see when you got here. The request
   * rides in router state rather than in the layout, because it is about this
   * one arrival and not about the stream.
   *
   * Two steps, because the column may be in a stream that is not the active one:
   * switch first, then jump once that stream is the one rendered.
   */
  const revealRef = useRef(readStreamsReveal(location.state));

  useEffect(() => {
    // Consumed once. Replacing the entry drops the request, so a reload or a
    // Back into Streams does not replay the jump.
    if (revealRef.current) void navigate(location.pathname, { replace: true, state: null });
    // Mount only: the request is read once, into the ref above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const reveal = revealRef.current;
    if (!reveal) return;
    if (stream.id !== reveal.streamId) {
      const target = layout.streams.find(candidate => candidate.id === reveal.streamId);
      // Archived or deleted since the toast: stay where Streams opened.
      if (!target || !isLive(target)) {
        revealRef.current = null;
        return;
      }
      chooseStream(reveal.streamId);
      return;
    }
    revealRef.current = null;
    if (!columnOrder.includes(reveal.columnId)) return;
    jumpTo(reveal.columnId);
    flashColumn(reveal.columnId);
  }, [stream.id, layout.streams, columnOrder, chooseStream, jumpTo, flashColumn]);

  /**
   * A pair is one landing site, not two.
   *
   * `moveColumn` already steps past a slot that would tear a pair apart, but it
   * only runs on release — so the marker was still offering the gap inside a
   * pair, and dropping there looked like the stream rejecting the column. Refusing
   * the slot up front means the marker never promises it in the first place.
   */
  const normalizeSlot = useCallback((slot: number, remaining: readonly string[]): number => {
    const live = columnsRef.current;
    let at = slot;
    while (at > 0 && at < remaining.length) {
      const ahead = live.find(column => column.id === remaining[at]);
      if (ahead?.attachedTo !== remaining[at - 1]) break;
      at += 1;
    }
    return at;
  }, []);

  const { beginDrag, consumeSuppressedClick, marker, drag } = useColumnDrag({
    order: columnOrder,
    onReorder: reorder,
    normalizeSlot,
    rootRef: panelRef,
    columnBox,
  });

  /**
   * The strip's own width, measured, because focus mode needs it in pixels.
   *
   * Everything about a focused page is expressed as a percentage in CSS, which
   * is right — it tracks the window without a single re-render. But `scroll-
   * margin` takes lengths only, no percentages, so extending a pair's snap area
   * over its pane needs the one number CSS will not hand back.
   */

  /**
   * Whether the strip is windowed. Both modes; only a transition turns it off.
   *
   * `widthMs` rather than `transitioningRef`, because a ref does not re-render:
   * a focus flip rewrites every width over `dev.focusMs`, and for that span the
   * sizes below describe the destination while the DOM is still travelling
   * there. Windowing against numbers the layout has not reached yet puts every
   * column at the wrong offset, so for those few hundred milliseconds the strip
   * renders whole — which costs nothing, because surfaces are gated separately
   * and the shells are skeletons.
   */
  const virtualize = widthMs === 0;

  /**
   * Column ids that have built a surface, most recent first, capped at
   * `KEEP_BUILT`.
   *
   * State rather than a ref because `keepMounted` has to recompute when it
   * changes — a ref would hold the ids and never widen the window.
   */
  const [builtOrder, setBuiltOrder] = useState<string[]>([]);

  const noteBuilt = useCallback((columnId: string): void => {
    setBuiltOrder(previous => {
      // Same-value bail. Without it every surface mount allocates a new array,
      // which rebuilds `keepMounted`, then `rangeExtractor`, then the
      // virtualiser — for a list that did not change.
      if (previous[0] === columnId) return previous;
      const next = [columnId, ...previous.filter(id => id !== columnId)];
      return next.length > KEEP_BUILT ? next.slice(0, KEEP_BUILT) : next;
    });
  }, []);

  /**
   * Indexes that stay mounted whatever the scroll position says.
   *
   * A dragged column cannot be allowed to unmount: `useColumnDrag` caches the
   * raw nodes at drag start and writes `style.transform` straight onto them
   * every frame, so an unmount mid-gesture leaves it addressing detached nodes
   * and the card freezes under the pointer while the drag carries on around it.
   *
   * The focused column is here for `trackFocusedColumn`, which pins `scrollLeft`
   * against its measured box each frame through a focus flip — it has to be in
   * the document before the flip starts, not once the scroll arrives.
   *
   * Pairs are admitted whole. A channel and the pane it holds are one page, and
   * half a pair is worse than neither half.
   */
  const keepMounted = useMemo(() => {
    const keep = new Set<number>();
    const add = (id: string | undefined): void => {
      if (id === undefined) return;
      const at = scrollingIndexOf.get(id);
      if (at !== undefined) keep.add(at);
    };
    const withPartner = (id: string | undefined): void => {
      if (id === undefined) return;
      add(id);
      add(attachmentOf(columns, id)?.id);
      add(columns.find(column => column.id === id)?.attachedTo);
    };
    withPartner(drag?.columnId);
    add(drag?.partnerId);
    withPartner(columns[stream.focus]?.id);
    // Ask AI columns hold state that exists nowhere else. An unsent question
    // lives in component memory and in no store, so unmounting one loses it
    // with no way back — and `startFreshChat` clears the panel again on the
    // remount, so even a sent conversation does not return. Every other surface
    // rebuilds from a source that outlives it: a channel re-queries Zero, a
    // canvas reconnects to y-sweet and its text comes back. This kind has no
    // such source, so it is held instead.
    //
    // Measured before the fix: a draft typed into an Ask AI column at index 0
    // of fifteen was gone after scrolling to the far end and back.
    for (const column of columns) if (column.source.kind === 'agent') add(column.id);
    // Everything else that has already been built, most recent first. The Ask AI
    // rule above is this same rule with an unbounded budget, and for the reason
    // stated: its state has no source to rebuild from. The others do rebuild —
    // they just take two seconds and 382ms of blocked main thread to do it, and
    // show a skeleton throughout, so the user pays for the scroll twice.
    //
    // `withPartner`, not `add`: a channel and the pane it holds are one page
    // here too, and half a held pair still rebuilds visibly.
    for (const id of builtOrder) withPartner(id);
    return keep;
  }, [drag, columns, stream.focus, scrollingIndexOf, builtOrder]);

  /**
   * The columns actually on screen, as opposed to merely mounted.
   *
   * `rangeExtractor` is handed the visible range *before* overscan widens it,
   * which is the only place that distinction is available — and it is the
   * distinction the drift turns on. A ref rather than state because it is read
   * during the same render the virtualiser triggers: writing state here would
   * loop.
   */
  const onScreenRef = useRef<{ start: number; end: number }>({ start: 0, end: -1 });

  const rangeExtractor = useCallback(
    (range: Range): number[] => {
      onScreenRef.current = { start: range.startIndex, end: range.endIndex };
      const visible = defaultRangeExtractor(range);
      if (keepMounted.size === 0) return visible;
      return Array.from(new Set([...visible, ...keepMounted])).sort((a, b) => a - b);
    },
    [keepMounted],
  );

  /**
   * The strip's window.
   *
   * `estimateSize` is exact rather than estimated: a column's width is state,
   * and the handle after it is a constant, so there is no measure-then-correct
   * cycle and no drift to reconcile. That is the one way this is simpler than
   * the chat list it otherwise follows.
   */
  const columnWindow = useVirtualizer({
    horizontal: true,
    count: scrolling.length,
    getScrollElement: () => stripRef.current,
    estimateSize: (index: number): number => {
      const column = scrolling[index];
      return column ? strideFor(column) : 0;
    },
    getItemKey: (index: number): string => scrolling[index]?.id ?? String(index),
    // Shells, not surfaces — which is why this number is small and no longer
    // load-bearing.
    //
    // A column is not a list row: it is a chat panel that opens Zero queries and
    // builds its own virtualised list, measured at ~100ms to mount. Tuning the
    // overscan was the first attempt at containing that, and it does not work in
    // either direction. Two produced four main-thread stalls of 43-64ms in one
    // five-second scroll, each followed by the queued scroll lurching to catch
    // up; fifteen simply moved the same stalls to whatever column count exceeded
    // it. The cost is in *when a surface is built*, and the window was never the
    // thing deciding that.
    //
    // A surface is built when its column is on screen — see `offScreen` in
    // `renderColumn` — so what the overscan holds either side is a mounted shell
    // with a skeleton in it, which costs nothing. It exists to have the shell in
    // the document before it scrolls into view, so nothing pops in, and five is
    // comfortably more than one gesture reaches.
    overscan: 5,
    rangeExtractor,
    // React 19 changed flushSync semantics; the default adds synchronous
    // layout/paint cycles during scroll. Same reasoning as `ChatListV4`.
    useFlushSync: false,
  });

  const virtualColumns = columnWindow.getVirtualItems();

  /**
   * Whether the strip is in motion, for the columns that have not loaded yet.
   *
   * Only ever postpones. A loaded column ignores this entirely, which is the
   * correction to the first attempt: that one wiped every column on any scroll,
   * including the ones already on screen with their messages in them.
   */
  const windowScrolling =
    (virtualize && columnWindow.isScrolling) ||
    // A focus flip is the other moment nothing may be built. Virtualisation is
    // off in focus mode, so crossing into it mounts every column the window was
    // holding back — thirteen surfaces in one commit, landing on the frames the
    // width transition needs. Same bargain as a scroll: hold the work until the
    // movement is over, then let them fill in.
    widthMs > 0;

  /**
   * The strip is a flex row and stays one.
   *
   * Absolute positioning is the usual way to place virtual items, and it would
   * mean re-deriving every height in here: the columns are `self-stretch` and
   * the handle between them owns the spacing. Spacers instead, which leave every
   * rendered child exactly the flex child it was — so the fade mask, the ring
   * gutter and the handles need no changes at all.
   *
   * A spacer before *every* column rather than one at each end, because the
   * window is not a contiguous run: `rangeExtractor` force-keeps the dragged and
   * focused columns wherever they happen to be, so the rendered set can be
   * 0,1,2,3,6 with a hole in the middle. Padding only the ends closes that hole
   * by sliding everything after it leftward — the focused column landed 736px
   * short of its own position, which is the entire layout wrong from there on.
   * Each gap is carried where it actually falls.
   */
  const windowed = useMemo(() => {
    // The unwindowed case goes through the *same* shape rather than a second
    // branch, and that is not tidiness. A column rendered under a different
    // wrapper is a different position in the tree, so switching branches makes
    // React tear down every column and build it again — which is exactly what
    // made entering focus mode reload a stream that was already sitting there
    // fully loaded. Focus mode changes widths; it has no business changing
    // identities. One shape, all the time, and the only thing that varies is
    // which columns are in it and how much space stands in for the rest.
    if (!virtualize) {
      return {
        items: scrolling.map(column => ({ key: column.id, gap: 0, column })),
        tail: 0,
      };
    }
    const items: { key: string; gap: number; column: Column }[] = [];
    let cursor = 0;
    for (const item of virtualColumns) {
      const column = scrolling[item.index];
      if (!column) continue;
      items.push({ key: column.id, gap: Math.max(0, item.start - cursor), column });
      cursor = item.end;
    }
    return { items, tail: Math.max(0, columnWindow.getTotalSize() - cursor) };
  }, [virtualize, virtualColumns, scrolling, columnWindow]);

  /**
   * Hold the arithmetic to the document's account, while both still answer.
   *
   * Every column is mounted today, so the DOM can be asked the same question
   * `scrollingStrides` computes and the two must agree. That check is only
   * available until the strip virtualises — afterwards there is no second
   * opinion for the columns that matter most, the ones off screen — so it earns
   * its place now, catching a systematic error while it is still cheap to find.
   *
   * Only at rest, and every guard here is a case where the two disagree for a
   * reason that is not a bug: focus mode sizes columns from CSS rather than from
   * `width`, a drag carries a transform, and an open, close or focus flip is a
   * width mid-tween against a state value that already holds the end of it.
   */
  useEffect(() => {
    if (!import.meta.env.DEV) return undefined;
    if (focusMode || transitioningRef.current) return undefined;
    if (drag !== null || widthMs > 0) return undefined;
    if (opening.size > 0 || closing.size > 0) return undefined;
    const strip = stripRef.current;
    if (!strip) return undefined;
    // After the commit that changed them, not during it.
    let cancelCheck: (() => void) | null = null;
    const frame = requestAnimationFrame(() => {
      cancelCheck = assertStridesMatchDom(
        strip,
        scrolling.map(column => column.id),
        scrollingStrides,
        stripLead,
        'deck',
      );
    });
    return (): void => {
      cancelAnimationFrame(frame);
      cancelCheck?.();
    };
  }, [scrolling, scrollingStrides, stripLead, focusMode, drag, widthMs, opening, closing]);

  // Entering or leaving focus mode changes the focused column's width without
  // changing which column is focused, and the effect below short-circuits on
  // exactly that. Clearing the mark first is what lets it travel to the column
  // at its new size.
  //
  // `useLayoutEffect`, and that is the entire fix for "it focuses a random
  // column". Declaration order only orders effects of the *same kind* — React
  // runs every layout effect before any passive one — so as a `useEffect` this
  // ran a phase after the centring layout effect it exists to unblock. The
  // centring effect saw its own stale mark, returned early, and the strip kept
  // whatever `scrollLeft` it had while every column resized underneath it. With
  // a per-column focus button that became the common case rather than the rare
  // one: the button's own pointerdown focuses the column before the click
  // fires, so by the time focus mode flips, focus has *already* arrived and
  // nothing else was left to invalidate the mark.
  useLayoutEffect(() => {
    centredOnRef.current = null;
  }, [focusMode]);

  /**
   * Keep the focused column centred while the widths animate.
   *
   * Each frame it re-centres on the column's *current* box, so the scroll
   * inherits the width transition's duration and easing rather than running its
   * own alongside it.
   */
  /**
   * The box the strip should centre on for a given column.
   *
   * A pair is one page, so it is one target: centring the *column* put whichever
   * half held focus dead in the middle of the stream and left the other half
   * hanging off the edge, half of it past the viewport, with the seam nowhere
   * near the centre. Both halves belong to the same page, so the page is what
   * gets centred — the union of the two boxes, seam included.
   *
   * Returns viewport coordinates, not layout ones, so it works mid-animation
   * while the widths are still changing.
   */

  /**
   * Is the strip moving sideways right now.
   *
   * Only asked in focus mode, and only to decide whether the edge mask shows.
   * A focused page at rest fills the width, so a permanent fade dims text that
   * is entirely on screen; mid-scroll there really is content crossing both
   * edges, which is the case the softening was written for.
   *
   * A timer rather than `scrollend`: that event does not fire until a snap has
   * fully settled, which is a beat after the movement you are watching has
   * visibly stopped — long enough for the fade to read as stuck on.
   */
  const [stripScrolling, setStripScrolling] = useState(false);
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip || !focusMode) {
      setStripScrolling(false);
      return undefined;
    }
    let idle = 0;
    const onScroll = (): void => {
      setStripScrolling(true);
      window.clearTimeout(idle);
      idle = window.setTimeout(() => setStripScrolling(false), 180);
    };
    strip.addEventListener('scroll', onScroll, { passive: true });
    return (): void => {
      strip.removeEventListener('scroll', onScroll);
      window.clearTimeout(idle);
    };
  }, [focusMode]);

  const pageBoxFor = useCallback(
    (strip: HTMLElement, columnId: string): { left: number; width: number } | null => {
      const node = strip.querySelector<HTMLElement>(`[data-column="${columnId}"]`);
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      const live = columnsRef.current;
      const self = live.find(candidate => candidate.id === columnId);
      const otherId = self?.attachedTo ?? attachmentOf(live, columnId)?.id;
      const other = otherId ? strip.querySelector<HTMLElement>(`[data-column="${otherId}"]`) : null;
      if (!other) return { left: rect.left, width: rect.width };
      const otherRect = other.getBoundingClientRect();
      const left = Math.min(rect.left, otherRect.left);
      const right = Math.max(rect.right, otherRect.right);
      return { left, width: right - left };
    },
    [],
  );

  /** `trackFocusedColumn` runs from a rAF loop, so it reads this rather than closing over it. */
  const pageBoxRef = useRef(pageBoxFor);
  pageBoxRef.current = pageBoxFor;

  const trackFocusedColumn = useCallback((columnId: string): void => {
    const strip = stripRef.current;
    if (!strip) return;

    // `scroll-behavior: smooth` applies to assigning `scrollLeft` too, so each
    // frame would otherwise start its own smooth scroll and they would queue.
    const previous = strip.style.scrollBehavior;
    strip.style.scrollBehavior = 'auto';

    const start = performance.now();
    const step = (): void => {
      const box = pageBoxRef.current?.(strip, columnId);
      if (box) {
        const stripRect = strip.getBoundingClientRect();
        const delta = box.left + box.width / 2 - (stripRect.left + stripRect.width / 2);
        strip.scrollLeft = Math.max(0, strip.scrollLeft + delta);
        // Where the strip is *meant* to be, recorded as it travels. The pin
        // that stops a mounting surface dragging the strip restores to this
        // value, and a page arriving is precisely what happens at the end of a
        // jump — so without this the guard would find the pre-jump position
        // still written here and haul the stream back to it. Measured: a jump
        // reached 31,618px, the destination's surface mounted, and the pin
        // returned it to 1,858. The tracker is the only thing that knows where
        // this trip is going, so it is the thing that has to say.
        stripScrollRef.current = strip.scrollLeft;
      }
      if (performance.now() - start < durationRef.current + 32) {
        requestAnimationFrame(step);
        return;
      }
      strip.style.scrollBehavior = previous;
    };
    requestAnimationFrame(step);
  }, []);

  /**
   * One last centring, once the flip's clock has run out and the layout is final.
   *
   * `trackFocusedColumn` runs for a fixed `focusMs + 32`, measured in wall-clock
   * time, so on a heavy stream the frames it was counting on never arrive: at 37
   * columns an exit spent 250–800ms per frame, the loop got one or two tries and
   * stopped with the widths still moving. Whatever it left behind stood, and the
   * strip settled on some other column (0 of 2 exits landed, measured). This runs
   * on the commit that ends the flip, when windowing is back and every width is
   * final, so it cannot be early however slow the frames were.
   */
  const flipWidthRef = useRef(widthMs);
  useLayoutEffect(() => {
    const was = flipWidthRef.current;
    flipWidthRef.current = widthMs;
    if (!(was > 0 && widthMs === 0)) return;
    const strip = stripRef.current;
    const id = focusedIdRef.current;
    if (!strip || !id) return;
    const box = pageBoxFor(strip, id);
    if (!box) return;
    const stripRect = strip.getBoundingClientRect();
    const target = Math.max(
      0,
      strip.scrollLeft + box.left + box.width / 2 - (stripRect.left + stripRect.width / 2),
    );
    intendStripScroll(target);
    const previous = strip.style.scrollBehavior;
    strip.style.scrollBehavior = 'auto';
    strip.scrollLeft = target;
    strip.style.scrollBehavior = previous;
  }, [widthMs, pageBoxFor, intendStripScroll]);

  /**
   * The carousel reports where it came to rest.
   *
   * Without this the rail highlights whatever you last *clicked*, while the
   * scroller shows whatever you last *flicked to* — two different answers to
   * "which column am I on", which is the one question focus mode exists to make
   * unambiguous.
   *
   * On `scroll`, not `scrollend`. `scrollend` was the first instinct — wait for
   * rest, then answer — and it is wrong by a wide margin in practice: it does not
   * fire until the snap animation has fully settled, so the rail kept highlighting
   * the column you had *left* for a beat after the new one had stopped moving.
   * The highlight is meant to answer "which one am I on", and answering it late
   * is the same as answering it wrong.
   *
   * The reason waiting looked necessary was that focus used to change a column's
   * width; in a carousel every column is the same width, so this now moves nothing
   * and there is no scroll in flight for it to fight. It is a highlight.
   *
   * rAF-throttled, and guarded on the value actually changing — `setFocus` writes
   * through `patchStream`, which builds a new stream object and lands in
   * localStorage, so firing it on every scroll event would put a JSON write in
   * the middle of a flick.
   */
  useEffect(() => {
    const strip = stripRef.current;
    if (!focusMode || !strip) return;

    let frame = 0;

    const settle = (): void => {
      frame = 0;
      // The add page's arrival, as a 0→1 value written straight to the node.
      //
      // This is the part that makes the end of the list a destination rather
      // than a wall: the "+" grows in proportion to how far you have pulled,
      // so the gesture has feedback the whole way rather than a result at the
      // end. One custom property, no React state — it changes every frame of a
      // drag, and re-rendering eight live columns per frame is exactly what the
      // rest of the stream is built to avoid.
      const addPage = addPageRef.current;
      if (addPage) {
        // Viewport rects, not `offsetLeft`. `offsetLeft` is measured from the
        // nearest positioned ancestor — which is not the strip, since the strip
        // is statically positioned — so it does not live in the same coordinate
        // space as `scrollLeft` and the distance came out enormous on every
        // frame. Measured, `--enter` sat at exactly 0.000 the whole way in.
        // Comparing two rects has no such assumption to get wrong.
        const pageRect = addPage.getBoundingClientRect();
        const stripRect = strip.getBoundingClientRect();
        const distance = Math.abs(
          pageRect.left + pageRect.width / 2 - (stripRect.left + stripRect.width / 2),
        );
        const progress = Math.max(0, Math.min(1, 1 - distance / pageRect.width));
        addPage.style.setProperty('--enter', progress.toFixed(3));

        // Commit on arrival, the way Arc opens its create sheet when you land —
        // having scrolled a full page to reach this, being asked to then click
        // it would be the journey not counting. Latched, so it fires once per
        // visit rather than on every frame it stays centred, and released only
        // once the page is properly gone.
        // The page is always the palette now, so arriving does not *open*
        // anything — it just decides whose keyboard it is. Focus on arrival so
        // you can scroll to the end and type; blur on the way out so the field
        // does not keep swallowing keys from three columns away.
        const field = addPage.querySelector('input');
        if (progress >= ADD_COMMIT_AT && !addCommittedRef.current) {
          addCommittedRef.current = true;
          field?.focus();
        } else if (progress < 0.5 && addCommittedRef.current) {
          addCommittedRef.current = false;
          if (field && field === document.activeElement) field.blur();
        }
      }

      const best = columnAtCentreRef.current();
      // Not while the stream is rearranging itself. `trackFocusedColumn` scrolls
      // during a transition, those scrolls land here, and picking "nearest to
      // centre" against a layout mid-animation reassigns focus to a column the
      // user never asked for — which then re-targets the tracker. That feedback
      // loop is the other half of why the stream ended up somewhere random.
      if (transitioningRef.current) return;
      if (best < 0 || best === focusRef.current) return;
      // And not when the user didn't scroll. A column finishing its load, the
      // strip pin restoring, or a layout shift all scroll the strip too, and
      // reading those as a swipe moved focus to a neighbour, so leaving focus mode
      // landed on a column nobody chose. Measured: nudging the strip from code,
      // with no gesture, moved focus from column 12 to 13.
      if (performance.now() - lastInputRef.current > CAROUSEL_GESTURE_MS) return;
      // Claim the centring mark too. The effect below would otherwise see focus
      // change, decide the strip needs to travel, and scroll to the column the
      // user is in the middle of scrolling to themselves.
      centredOnRef.current = columnOrder[best] ?? null;
      setFocus(best);
    };

    const onScroll = (): void => {
      if (frame) return;
      frame = requestAnimationFrame(settle);
    };

    strip.addEventListener('scroll', onScroll, { passive: true });
    return (): void => {
      strip.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [focusMode, columnOrder, setFocus]);

  /**
   * Centre the focused column, clamped to the strip's real bounds so the first
   * and last sit flush. The browser does the clamping — that is the whole reason
   * for using a real scroller rather than a transform.
   *
   * Guarded on the focused column having actually *changed*. `columns` is in the
   * dependencies because the node has to exist before it can be scrolled to, and
   * that array changes on every width drag — so resizing an unfocused column
   * fired this and yanked the strip back to the focused one, mid-drag. Which is
   * the correct instinct in general: the stream never scrolls itself except when
   * you move focus.
   */
  // `useLayoutEffect`, not `useEffect`, and that is the whole difference between
  // a mode change that glides and one that lurches on its first frame. A passive
  // effect runs *after* the browser has painted, so the frame where the rail
  // takes its 208px and every column changes width is painted with the old
  // scroll position — you see the row shift, and only then see it corrected.
  // Measured, entering jumped 595px backwards before settling. A layout effect
  // runs after the DOM mutation and before paint, so frame one is already right.
  useLayoutEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const focused = columns[stream.focus];
    if (!focused) return;
    // A column mid-collapse is on its way to 0px wide, so centring on it would
    // slide the strip to a target that is disappearing. Focus lands correctly
    // once it actually leaves the stream.
    if (closing.has(focused.id)) return;
    // Arriving at Streams is not a focus change.
    //
    // `stream.focus` is restored from storage, so on every mount — switching to
    // the tab, and every reload — this found a focused column it had not yet
    // centred on and travelled to it. The tab therefore opened somewhere in the
    // middle of the stream, on a column you last clicked possibly days ago. A view
    // should open at its beginning; the preference is about following focus *as
    // you click around*, which cannot have happened yet.
    //
    // Focus mode is the exception, and has to be: there the focused column is
    // the entire view, so opening at column one would show the wrong thing.
    if (!arrivedRef.current) {
      arrivedRef.current = true;
      if (!focusMode) {
        centredOnRef.current = focused.id;
        return;
      }
    }
    if (centredOnRef.current === focused.id) return;
    // Auto-centring is a preference in the wide stream and a mechanism in focus
    // mode: there, the focused column *is* the view, so not travelling to it
    // leaves you looking at a column you did not pick.
    //
    // A mode *transition* is neither, and must never be gated on the dial. The
    // preference answers "should the strip follow focus as I click around";
    // leaving focus mode is the stream rewriting every column's width from 1376
    // back to 480, and something has to say where the scroller ends up
    // afterwards. With `autoCenter` off this returned immediately and nothing
    // did — so the stream simply kept whatever `scrollLeft` it had and landed on
    // an unrelated column. That is the whole "throws it somewhere random" bug,
    // and it only reproduced for people who had turned the dial off.
    if (!dev.autoCenter && !focusMode && !transitioningRef.current) return;
    // Marked here rather than above the bail-out: the mark means "the strip is
    // centred on this column", and claiming it for a run that scrolled nothing
    // is how the guard above ends up suppressing a travel that never happened.
    centredOnRef.current = focused.id;
    // Pinning the focused column leaves it outside the scroller, so there is
    // nothing to centre — and doing nothing stranded the scroller wherever it
    // happened to be, showing a scrolling column sliced down the middle with no
    // card edge. Send it back to the start so the first one sits flush.
    const behavior = scrollBehavior();
    if (focused.pinned) {
      intendStripScroll(0);
      strip.scrollTo({ left: 0, behavior });
      return;
    }
    // While the widths are animating, follow the focused column frame by frame
    // rather than firing one scroll at a destination that has not finished
    // arriving — leaving focus mode needs this as much as entering it.
    if ((focusMode || transitioningRef.current) && behavior === 'smooth') {
      trackFocusedColumn(focused.id);
      return;
    }
    // Centre the page, not the column — see `pageBoxFor`. `scrollIntoView` can
    // only ever centre one element, so a pair needs the arithmetic done by hand.
    const box = pageBoxFor(strip, focused.id);
    if (!box) return;
    const stripRect = strip.getBoundingClientRect();
    const delta = box.left + box.width / 2 - (stripRect.left + stripRect.width / 2);
    intendStripScroll(Math.max(0, strip.scrollLeft + delta));
    strip.scrollTo({ left: Math.max(0, strip.scrollLeft + delta), behavior });
  }, [
    stream.focus,
    columns,
    dev.autoCenter,
    closing,
    focusMode,
    trackFocusedColumn,
    pageBoxFor,
    intendStripScroll,
  ]);

  // ------------------------------------------------- focus arbitration

  const takeFocus = useCallback((): void => {
    panelRef.current?.focus({ preventScroll: true });
  }, []);

  /**
   * Put the strip back where it was, without animating the trip.
   *
   * `scroll-behavior` has to go to `auto` for the assignment: the strip is
   * `scroll-smooth`, and a smooth correction would be a second animation racing
   * the one it is cancelling.
   */
  const pinStrip = useCallback((): void => {
    const strip = stripRef.current;
    if (!strip) return;
    if (Math.round(strip.scrollLeft) === Math.round(stripScrollRef.current)) return;
    const previous = strip.style.scrollBehavior;
    strip.style.scrollBehavior = 'auto';
    strip.scrollLeft = stripScrollRef.current;
    strip.style.scrollBehavior = previous;
  }, []);

  // Columns mount asynchronously and each chat surface autofocuses its composer,
  // so any timed focus claim loses the race — a column whose data lands late
  // steals the keyboard seconds after arrival. Bounce back focus the user did not
  // ask for. Deterministic, no timers.
  //
  // "Did not ask for" is the whole subtlety. Clicking straight into a composer IS
  // asking, and the intent has to be recorded on pointerdown — before the focus
  // event the click is about to produce. Without this the guard bounces the user
  // out of every composer in every column and the strip reads as unusable.
  const noteComposerIntent = useCallback((event: React.PointerEvent): void => {
    const target = event.target as HTMLElement | null;
    const intentional = Boolean(
      target && (isTypingTarget(target) || target.closest('[data-streams-input]')),
    );
    if (intentional) composerIntentRef.current = true;
  }, []);

  /**
   * Hold the strip still while a surface arrives.
   *
   * Reuses the composer guard's mechanism for a cause it cannot see. A chat
   * panel brings its latest message into view as it mounts, and that scrolls
   * every scrollable ancestor — no JS assigns `scrollLeft`, no focus event
   * fires, so there is nothing to intercept and nothing to cancel. Latching the
   * pin across the arrival stops it on its first frame, exactly as the composer
   * case does.
   *
   * This only became visible once surfaces stopped mounting at page load: they
   * now arrive after a scroll settles, so the stray scroll arrives with them,
   * several hundred milliseconds after the user has come to rest.
   */
  const holdStripThroughMount = useCallback(
    (columnId: string): void => {
      restoreUntilRef.current = performance.now() + FOCUS_SCROLL_GUARD_MS;
      pinStrip();
      // The same call is the stream's only notice that this column now holds a
      // built surface worth keeping.
      noteBuilt(columnId);
    },
    [pinStrip, noteBuilt],
  );

  // The trap this creates: anything Streams opens on purpose must carry
  // `data-streams-input` or its autofocused field is blurred the instant it
  // mounts. That is what made Cascade's rename dialog look broken.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const onFocusIn = (event: FocusEvent): void => {
      if (composerIntentRef.current) return;
      if (!isTypingTarget(event.target)) return;
      if ((event.target as HTMLElement).closest('[data-streams-input]')) return;
      // Bouncing the focus is not enough, and the scroll cannot be pre-empted.
      //
      // Focusing an element makes the browser bring it into view, and on this
      // strip — which carries `scroll-behavior: smooth` — that is an *animated*
      // scroll it runs internally. It never assigns `scrollLeft`, so no JS trap
      // sees it, and it has not started yet when `focusin` fires: measured,
      // every one of these events reports `scrollLeft` still at 0 while the
      // strip ends up 2813px along a moment later. There is nothing to undo
      // synchronously, and nothing to cancel.
      //
      // So the guard latches instead. For the length of the window it pins the
      // strip on every scroll the animation produces, which stops it dead on its
      // first frame. Eight composers autofocus in turn as their channels resolve
      // — this is what stopped the stream opening parked on whichever finished
      // last, on a column nobody chose.
      restoreUntilRef.current = performance.now() + FOCUS_SCROLL_GUARD_MS;
      pinStrip();
      takeFocus();
    };
    panel.addEventListener('focusin', onFocusIn);
    return (): void => panel.removeEventListener('focusin', onFocusIn);
  }, [takeFocus, pinStrip]);

  // The strip's resting position, and the pin that holds it there.
  //
  // Recorded from real scrolls only: a focus-driven one would otherwise
  // overwrite the very value it needs to be put back to.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const onScroll = (): void => {
      // The guard has to tell a scroll the user asked for from one a surface
      // caused, because the two arrive through the same event and only one may
      // be undone. Pinning both would make the strip refuse to move for the
      // length of every arrival; pinning neither is the drift this exists to
      // stop. The user's own input is the only thing that separates them, so
      // any scroll within `INPUT_GRACE_MS` of a real gesture is treated as
      // intended and recorded rather than reverted.
      const now = performance.now();
      const userDriven = now - lastInputRef.current <= INPUT_GRACE_MS;
      if (now < restoreUntilRef.current && !userDriven) {
        pinStrip();
        return;
      }
      stripScrollRef.current = strip.scrollLeft;
    };
    // Capture, so a surface that stops propagation cannot hide the gesture.
    const onInput = (): void => {
      lastInputRef.current = performance.now();
    };
    const inputs = ['wheel', 'pointerdown', 'touchstart', 'keydown'] as const;
    for (const type of inputs)
      strip.addEventListener(type, onInput, { capture: true, passive: true });
    strip.addEventListener('scroll', onScroll, { passive: true });
    return (): void => {
      strip.removeEventListener('scroll', onScroll);
      for (const type of inputs) strip.removeEventListener(type, onInput, { capture: true });
    };
  }, [pinStrip]);

  const enterColumn = useCallback((): void => {
    const focused = columns[stream.focus];
    if (!focused) return;
    composerIntentRef.current = true;
    const node = panelRef.current?.querySelector<HTMLElement>(`[data-column="${focused.id}"]`);
    const field = node?.querySelector<HTMLElement>('textarea, input, [contenteditable="true"]');
    field?.focus();
  }, [columns, stream.focus]);

  const leaveColumn = useCallback((): void => {
    composerIntentRef.current = false;
    takeFocus();
  }, [takeFocus]);

  // ------------------------------------------------------------- keyboard

  // `focusedId` is declared up in the geometry section, where focus mode needs it
  // to decide which column takes the width.
  const keys = { scope: SCOPE, preventDefault: true } as const;

  useShortcut('h', () => moveFocus(-1), keys);
  useShortcut('l', () => moveFocus(1), keys);
  useShortcut('shift+h', () => reorderFocused(-1), keys);
  useShortcut('shift+l', () => reorderFocused(1), keys);
  useShortcut('r', () => focusedId && setWidth(focusedId, dev.defaultWidth), keys);
  useShortcut('x', () => focusedId && closeColumn(focusedId), keys);
  useShortcut('shift+p', () => focusedId && togglePin(focusedId), keys);
  // In focus mode the palette is not a thing to open — it is the last page, so
  // asking for it is a request to go there.
  const openAdd = useCallback((): void => {
    if (!focusMode) {
      setPaletteOpen(true);
      // The palette opens *in place*, as the last citizen of the strip. Asking for
      // it from the header while scrolled to the other end would open it off-screen,
      // so the strip goes to meet it — the same courtesy focus mode already extends.
      // Deferred a frame, so the palette has replaced the slot and `scrollWidth` is final.
      const strip = stripRef.current;
      if (strip) {
        requestAnimationFrame(() => tweenScroll(strip, strip.scrollWidth - strip.clientWidth));
      }
      return;
    }
    const strip = stripRef.current;
    const page = addPageRef.current;
    if (!strip || !page) return;
    const pageRect = page.getBoundingClientRect();
    const stripRect = strip.getBoundingClientRect();
    tweenScroll(
      strip,
      strip.scrollLeft + (pageRect.left - stripRect.left) - (stripRect.width - pageRect.width) / 2,
    );
  }, [focusMode]);

  useShortcut('a', openAdd, keys);
  // The stream has no tabs, so the chord the browser spends on one is free — and
  // "new column" is the thing it would mean here anyway.
  //
  // Safe inside a composer without any guard of its own: `allowInInputs` defaults
  // to false, and the registry skips a shortcut whose target is editable. That
  // matters more here than for the letter keys, because a stream is a screen full
  // of text fields and this one is a chord people fire without looking.
  useShortcut('mod+t', openAdd, keys);
  useShortcut('i', enterColumn, keys);
  for (const digit of ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const) {
    // Registered unconditionally and in a fixed order, so hook order is stable.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useShortcut(
      digit,
      (): void => {
        // Counts stops, not array slots — the same remap `moveFocus` does.
        //
        // `setFocus` indexes `columns`, which includes attached panes; the nav
        // and every other list that describes the stream read `navColumns`,
        // which drops them. So "the third column" means different things to the
        // user and to this array the moment any pane sits earlier in the strip:
        // pressing 3 landed one stop short for every pane before it, and could
        // land *on* a pane — which is not a stop of its own, has no snap point,
        // and leaves the carousel between positions.
        const picked = navColumns[Number(digit) - 1];
        if (!picked) return;
        const at = columns.findIndex(column => column.id === picked.id);
        if (at < 0) return;
        setFocus(at);
      },
      keys,
    );
  }
  // Escape unwinds innermost-first: palette, then the composer, so
  // backing out of the picker never also throws away what you were typing.
  useShortcut(
    'escape',
    (): void => {
      if (paletteOpen) {
        setPaletteOpen(false);
        return;
      }
      leaveColumn();
    },
    { ...keys, allowInInputs: true },
  );

  // ---------------------------------------------------------------- render

  // A column's router is a private dead end, so leaving for the app proper has to
  // drive the real router deliberately.
  const openInApp = useCallback(
    (column: Column): void => {
      const appPath = surfaceFor(column.source).appPath;
      if (!appPath) return;
      void navigate(appPath(column.source, workspaceId ?? ''));
    },
    [navigate, workspaceId],
  );

  /**
   * The stream actions a column can invoke, as they are *right now*.
   *
   * Written during render rather than in an effect, matching `onResizeRef` in
   * `ColumnResizeHandle`: the handlers below are called from user events, which
   * always run after the render that produced this value.
   */
  const columnActionsRef = useRef({
    consumeSuppressedClick,
    setFocus,
    flipFocusMode,
    beginDrag,
    closeColumn,
    togglePin,
    detachColumn,
    openInApp,
    clearColumnActivity,
    dropOnColumn,
    columns,
    focus: stream.focus,
    focusMode,
  });
  columnActionsRef.current = {
    consumeSuppressedClick,
    setFocus,
    flipFocusMode,
    beginDrag,
    closeColumn,
    togglePin,
    detachColumn,
    openInApp,
    clearColumnActivity,
    dropOnColumn,
    columns,
    focus: stream.focus,
    focusMode,
  };

  /**
   * One frozen set of handlers per column, for the life of that column.
   *
   * `StreamColumn` is wrapped in `memo`, and until this existed the wrap did
   * nothing at all: `renderColumn` built nine arrow functions inline on every
   * render, so `memo`'s prop comparison saw nine changed props every time and
   * never once bailed out. React's own documentation names this exact case —
   * memo is "completely useless if the props passed to your component are always
   * different, such as if you pass an object or a plain function defined during
   * rendering". Measured on an 18-column stream, one click cost 265ms of blocked
   * main thread; the same click on `/chat` cost nothing.
   *
   * Keyed by column id and cached rather than rebuilt from the current columns,
   * so adding or reordering a column does not invalidate the other seventeen.
   * Everything that varies is read from `columnActionsRef` at call time, which
   * is what lets these close over nothing but the id and still never go stale.
   *
   * The alternative is React Compiler, which memoizes the JSX at the call site
   * and makes this whole file unnecessary. That is the better long-term answer;
   * this is the version that fits in one PR.
   */
  const handlerCacheRef = useRef(new Map<string, ColumnHandlers>());
  const handlersFor = useCallback((id: string): ColumnHandlers => {
    const cached = handlerCacheRef.current.get(id);
    if (cached) return cached;
    const slotOf = (): number => columnActionsRef.current.columns.findIndex(c => c.id === id);
    const made: ColumnHandlers = {
      onFocus: (): void => {
        const live = columnActionsRef.current;
        if (live.consumeSuppressedClick()) return;
        const slot = slotOf();
        if (slot >= 0) live.setFocus(slot);
      },
      onToggleFocus: (): void => {
        const live = columnActionsRef.current;
        if (slotOf() < 0) return;

        // Focus names a *page*, and an attached pair is one page. So both halves
        // resolve to the parent before anything is compared or set.
        //
        // Without this, focus mode shows a pair — both halves visible, both
        // wearing a focus button — and pressing the pane's button set focus to
        // the attachment. That is a slot the carousel has no snap point for and
        // that `moveFocus` deliberately steps over, so the stream ended up focused
        // on somewhere it will not stop, and the button that should have left
        // focus mode instead travelled half a panel sideways.
        const self = live.columns.find(column => column.id === id);
        const pageId = self?.attachedTo ?? id;
        const page = live.columns.findIndex(column => column.id === pageId);
        if (page < 0) return;

        // The focused column may itself be an attachment — resolve it the same
        // way, so "am I already showing?" compares page to page.
        const shown = live.columns[live.focus];
        const shownPageId = shown?.attachedTo ?? shown?.id;

        // From the stream: enter, on this page. In focus mode: travel to it if it
        // is not the one showing, otherwise this is the way back out.
        if (!live.focusMode) live.flipFocusMode(true, page);
        else if (shownPageId !== pageId) live.setFocus(page);
        else live.flipFocusMode(false);
      },
      // A pane's header is still a handle; it just addresses the pair. Grabbing
      // either half lifts both, and the pane can only ever move by taking its
      // channel with it — which is the rule `moveColumn` enforces on the commit.
      onDragHandleDown: (event: React.PointerEvent): void => {
        const live = columnActionsRef.current;
        const anchor = hostFor(live.columns, id)?.id ?? id;
        live.beginDrag(event, anchor, attachmentOf(live.columns, anchor)?.id);
      },
      onClose: (): void => columnActionsRef.current.closeColumn(id),
      onTogglePin: (): void => columnActionsRef.current.togglePin(id),
      onDetach: (): void => columnActionsRef.current.detachColumn(id),
      onOpenInApp: (): void => {
        const live = columnActionsRef.current;
        const column = live.columns.find(c => c.id === id);
        if (column) live.openInApp(column);
      },
      onClearActivity: (): void => {
        const live = columnActionsRef.current;
        const column = live.columns.find(c => c.id === id);
        if (column) live.clearColumnActivity(column);
      },
      onDropItem: (item: StreamItem): void => columnActionsRef.current.dropOnColumn(id, item),
    };
    handlerCacheRef.current.set(id, made);
    return made;
  }, []);

  // Closed columns leave their handlers behind, and a stream is opened and closed
  // all day. Dropped on the same tick the column list changes rather than in
  // `closeColumn`, so every path that removes a column is covered by one rule.
  useEffect(() => {
    const live = new Set(columnOrder);
    for (const id of handlerCacheRef.current.keys()) {
      if (!live.has(id)) handlerCacheRef.current.delete(id);
    }
  }, [columnOrder]);

  const renderColumn = (column: Column): ReactElement => {
    const handlers = handlersFor(column.id);
    // Whether this column is half of an attached pair, and which half. Derived
    // at render rather than stored: `attachedTo` is the one fact, and both the
    // border treatment and the gutter's reading follow from it.
    const held = attachmentOf(columns, column.id);
    // A pane on its way out has already stopped being part of the box. Reading
    // `holds` as "has a pane" kept the parent squared and seamed for the whole
    // close, then flipped everything back in the single commit that removed the
    // pane — so the pane shrank, the seam sat there, and only afterwards did the
    // corners pop round. Three steps for one event. Dropping the join the moment
    // the pane starts closing puts all of it on the same clock.
    const holds = held !== undefined && !closing.has(held.id);
    const isHeld = column.attachedTo !== undefined;

    // A pair is one focus-mode page, split between its halves in the same
    // proportion they hold in the wide stream — so entering focus mode on a
    // channel with a thread open shows you both, at the ratio you set, rather
    // than making you page between two halves of one panel.
    const partner = isHeld ? columns.find(candidate => candidate.id === column.attachedTo) : held;
    const pairTotal = partner ? widthFor(column) + widthFor(partner) : 0;
    const fillShare = pairTotal > 0 ? widthFor(column) / pairTotal : 1;

    // Mounted but outside the viewport — the overscan band. Read from the range
    // the virtualiser was handed before it widened it; see `onScreenRef`.
    const at = scrollingIndexOf.get(column.id);
    const offScreen =
      at !== undefined && (at < onScreenRef.current.start || at > onScreenRef.current.end);

    // Through the pair. Focus lands on whichever half you opened, but a pair is
    // one page — so the parent reading as unfocused while its own pane held
    // focus is what left its focus button offering to *enter* a mode it was
    // already in.
    const isFocused =
      hostFor(columns, columns[stream.focus]?.id ?? '')?.id === hostFor(columns, column.id)?.id;

    return (
      <Fragment key={column.id}>
        <StreamColumn
          column={column}
          width={widthFor(column)}
          closing={closing.has(column.id)}
          opening={opening.has(column.id)}
          onSurfaceMount={holdStripThroughMount}
          // The focused column is exempt. Everything else waits for the strip to
          // stop, because building during a gesture is what made it stutter —
          // but the column you just asked for is the destination, not something
          // you happen to be passing, and arriving at a skeleton reads as the
          // jump having failed. One surface built during the trip, not twenty.
          // Two reasons to hold a surface back; the focused column overrides
          // both, because it is the destination and arriving at a skeleton
          // reads as the jump having failed.
          //
          // The second is what ends the drift, and it is the same rule in both
          // modes now that both are windowed. A column outside the viewport is
          // mounted but not visible, and a chat panel brings its newest message
          // into view as it loads — which, for an element off screen, scrolls
          // the strip sideways to reach it. No JS assigns that scroll and no
          // focus event fires, so there is nothing to intercept: every guard
          // against it was a bet on when a channel's data would resolve, which
          // is why it failed at random. Not building a surface that is off
          // screen removes the thing that scrolls rather than racing it.
          //
          // Focus mode is where this bit hardest. A page there is 1,852px wide
          // against a 48,000px scroller, so one surface loading twelve pages
          // away dragged the viewport twenty thousand pixels to reach itself —
          // the same cause as the deck's 1,700px nudge, an order of magnitude
          // further.
          scrolling={(windowScrolling || offScreen) && !isFocused}
          focused={isFocused}
          flash={flashId === column.id}
          activity={streamActivity[column.id] ?? IDLE}
          actions={actions}
          // Both halves, or the pane keeps the base z-index while `z-30` lifts
          // only its parent — so the next column paints straight over the pane
          // and the lifted pair looks sliced down the middle.
          dragging={
            drag?.active === true && (drag.columnId === column.id || drag.partnerId === column.id)
          }
          workspaceId={workspaceId ?? ''}
          onFocus={handlers.onFocus}
          // `focusMode && focused`, resolved here rather than passed as the raw
          // mode. The mode flips for every column at once; the *posture* flips
          // for the one you are entering on. Passing the mode made a focus
          // toggle a prop change on all of them — see `--col-anim` below.
          focusHeld={focusMode && isFocused}
          joinRight={holds}
          joinLeft={isHeld}
          onToggleFocus={handlers.onToggleFocus}
          onDragHandleDown={handlers.onDragHandleDown}
          onClose={handlers.onClose}
          onTogglePin={handlers.onTogglePin}
          {...(isHeld && { onDetach: handlers.onDetach })}
          onOpenInApp={handlers.onOpenInApp}
          onClearActivity={handlers.onClearActivity}
          seed={seeds[column.id]}
          onDropItem={handlers.onDropItem}
          // Only a page *start* is a snap point. With one on both halves the
          // carousel could come to rest on the attachment alone, which is the
          // split panel torn down the middle — the state this grouping exists
          // to make unreachable.
          // Not gated on `focusMode`. `scroll-snap-align` is inert unless the
          // scroller declares `scroll-snap-type`, which only focus mode does —
          // so declaring it always is free, and keeps the mode out of the
          // column's props.
          snap={!isHeld}
          fillShare={fillShare}
          // Only the parent, only in focus mode, only when it is holding a pane.
          // The pane itself carries no snap at all, so the pair has exactly one
          // snap target and it spans both halves.
          //
          // The pane's *rendered* width, not its stored one. `widthFor` returns
          // what the pane is worth in the wide stream — 360 — while in focus mode
          // it renders at its share of the page, 585. Extending the snap area by
          // the smaller number left it 225px short of the pair, so the browser
          // centred a box narrower than the thing it was meant to cover and the
          // pair sat 112px left of centre: pane over the right edge, neighbour
          // dragged in on the left.
          snapExtendPx={
            focusMode && held && stripWidth > 0
              ? (stripWidth - (dev.focusPeek ? FOCUS_PEEK : 0) - 8) * (1 - fillShare) + 8
              : 0
          }
        />
        {/* Pixels in, pixels out — no viewport in the conversion. The previous
            version divided the dragged pixels by the measured viewport to get a
            fraction, and on the frame where that measurement was still 0 the
            guard divided by 1 instead, turning an 900px drag into a width of
            900 *screens*. Storing what the user actually dragged removes the
            unit conversion, and with it the whole class of bug. */}
        {/* Dropped the moment the collapse starts rather than collapsed with it.
            It is 8px against a column's 320, so removing it outright was judged
            below the threshold of noticing. That holds for a lone column and not
            for a pane: there the gutter sits against the seam, so the snap lands
            in exactly the spot the eye is on. It now collapses on the close
            clock instead — the "second width transition kept in step with the
            first" that the old note called too costly, which is free now that
            everything in a close shares one clock. */}
        {/* Inert in focus mode, never absent. The focused column's width is
            computed from the viewport there, so dragging it would fight a value
            rewritten on the next render — but this element is also the only
            thing separating one column from the next, so removing it collapsed
            every column edge flush against its neighbour. It keeps its 8px and
            gives up its handlers. */}
        <ColumnResizeHandle
          columnId={column.id}
          // The seam inside a pair, rather than the gap between two columns.
          // Dragging it trades width between the halves and, past the
          // parent's own minimum, squeezes the parent out entirely.
          {...(held && {
            pair: {
              partnerId: held.id,
              partnerPx: widthFor(held),
              // The *pane's* minimum. This read `column.source` — the parent's
              // — for both ends of the clamp, so a drag could push the pane
              // under the width its own surface needs.
              partnerMinPx: Math.max(MIN_WIDTH, surfaceFor(held.source).minWidth),
              onPartnerResize: next => setWidth(held.id, next),
            },
          })}
          widthPx={widthFor(column)}
          minPx={Math.max(MIN_WIDTH, surfaceFor(column.source).minWidth)}
          maxPx={MAX_WIDTH}
          onResize={next => setWidth(column.id, next)}
          inert={focusMode}
          collapsing={closing.has(column.id)}
          seam={holds}
        />
      </Fragment>
    );
  };

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      className={cn(
        'relative flex h-full flex-col overflow-hidden outline-none',
        // `bleed` paints nothing, so the fixed wallpaper layer behind the whole
        // app carries through the stream instead of stopping at its edge.
        dev.ground === 'theme' && 'bg-background',
        dev.ground === 'paper' && 'bg-[#fafafa]',
      )}
      data-testid='streams-screen'
      onPointerDownCapture={noteComposerIntent}
      // The veil's dials — on the same element `data-nav-veiled` lands on
      // — and the index row's geometry, which is read by tabs several
      // levels down and so has to be set above both of the row's two
      // possible homes. Cast because CSSProperties has no index signature
      // for custom properties.
      style={{} as CSSProperties}
    >
      {/* One marker for both layouts, outside either of them. It is measured
              in viewport coordinates, so it must not sit inside the scroller —
              the strip would carry it along as it scrolls. */}
      {marker && <InsertionMarker rect={marker} />}

      {/* Renders nothing. One subscription per column, feeding the single
          activity map the headers, the overview and the jump pills all read. */}
      {activityProbes}

      {/* No divider and no extra height: the columns below already have their own
          borders, so a rule here just adds a second horizontal line in a view
          that is mostly horizontal lines. */}
      {/* Inset to `HEADER_INSET`, not an arbitrary `px-3`: the title lines up
                with the first column's title rather than landing three pixels
                short of it. Height without a `pt-*` — padding on one side of a
                fixed-height box sits its contents off-centre, which is what made
                the row read as sitting low in its own space. */}
      <header
        // `gap-2`, not the 6 this had: the tabs now run the whole width of
        // the title group, so this gap is the distance between the last tab
        // and the first verb. At 24px the two groups read as separate bars.
        // It only shows when the tabs are actually there — with them off the
        // title group still stretches, so the space between the title and
        // the verbs is flex slack, not this.
        className='relative flex shrink-0 items-center gap-2'
        // Asymmetric on purpose, because the space *below* the header is
        // not the header's alone: the strip wrapper adds `STRIP_PAD` and
        // the scroller adds `RING_GUTTER` before the first card. Paying
        // the full 12px on both sides therefore spent 20px underneath
        // against 14 above — measured — which is the gap that reads as
        // heavier than the one over the title. The bottom pays the
        // remainder so the two come out equal.
        style={{
          paddingInline: HEADER_INSET,
          paddingTop: dev.headerPad,
          paddingBottom: dev.headerPad - STRIP_LEAD,
        }}
      >
        {/* One group, flex-1, so the actions sit against the right edge
                  without an `ml-auto` on a sibling — the same shape a channel
                  header uses, and the reason its spacing is even.

                  `min-h-8` so the row is one control tall whether or not the nav
                  is mounted. The nav is the only 32px child — the switcher is
                  23.5px — so an empty stream drew a header 8.5px shorter and the
                  whole strip jumped down the moment you added the first column. */}
        <div className='flex min-h-8 min-w-0 flex-1 items-center gap-2'>
          {/* The screen's title, and there is no separate one.

                    A constant "Streams" label used to hold this slot, with the
                    stream name beside it — two things competing for the same
                    position, one of which never changed and was already said by
                    the sidebar's active item. What varies is which stream you are
                    in, and that is also the thing you navigate by, so it takes
                    the title's weight and the title's place. The heading *is*
                    the control. */}
          {/* `streamActivity`, deliberately, and NOT `navActivity` like every
                    other consumer. The switcher rolls each stream up by summing
                    over that stream's own `columns`, which still contains attached
                    panes — so the raw per-column map is the correct input.
                    `navActivity` folds a pane's count into its parent *and*
                    leaves the pane's own entry in place, which is right for a
                    list that has dropped the pane's row and wrong for anything
                    that sums the whole map. Swapping it here silently doubles
                    every attached pane's unread. */}
          <StreamSwitcher
            layout={layout}
            activity={streamActivity}
            onSwitch={chooseStream}
            onCreate={newStream}
            onRestore={unarchiveStream}
            onRename={nameStream}
            onArchive={putStreamAway}
            onDelete={dropStream}
          />

          {/* On the title row rather than in a lane of its own, which is
                    where it started. A lane costs vertical space the stream wants
                    and, more to the point, it read as a second header — the stream
                    already has one, and this belongs to it. Beside the title it
                    is what the title is *about*: Streams, and here is the stream.

                    It takes the free width between the title and the verbs and
                    scrolls inside it, so a long stream never pushes the actions
                    off the right edge.

                    Kept in focus mode — the strip there is a real snap
                    carousel, which is the shape this was drawn for. */}
          {columns.length > 0 && (
            <StreamTopNav
              pinned={navPinned}
              scrolling={navScrolling}
              activity={navActivity}
              stripRef={stripRef}
              columnSpans={navSpans}
              onJump={jumpTo}
              onAdd={openAdd}
              // Only in focus mode. The wide stream shows five columns at
              // once, so marking one is answering a question the screen
              // does not pose.
              currentId={
                // Through `hostFor`, because a pane has no tab of its own —
                // the row folds a pair into its parent. Naming the pane
                // named a column that was not in the row, so opening one
                // simply cleared the highlight until you closed it again.
                focusMode ? hostFor(columns, columns[stream.focus]?.id ?? '')?.id : undefined
              }
            />
          )}
        </div>
        {/* The stream's verbs, as one group, at the same `gap-1` a channel
                  header puts between its own icon buttons. */}
        <div className='flex shrink-0 items-center gap-1'>
          {/* No overflow menu. It held exactly two rows — reset every width,
                    and a Share that was never wired — and a ⋯ that opens two
                    items, one of them dead, costs more attention than it saves.
                    Reset-all-widths survives as the dev panel's `Apply to every
                    column`; Share comes back as its own verb when there is
                    something behind it. */}
        </div>
      </header>

      <div
        className='flex min-h-0 flex-1 flex-col gap-2'
        // Left is its own number, and not the same one. See `STREAM_LEFT_INSET`:
        // the space between the nav rail and the first column belongs to the
        // rail's symmetry, while the right and bottom are the stream against
        // the window and want the frame.
        style={{
          paddingLeft: STREAM_LEFT_INSET,
          paddingRight: STRIP_PAD,
          paddingBottom: STRIP_PAD,
          paddingTop: 2,
        }}
      >
        {/* No gap between the pinned run and the scroller: each column already
              ends in a resize handle, so an extra gap here stacked handle +
              padding + gap + padding into a dead band wide enough to read as the
              scrolling column being clipped. The handle is the separator. */}
        <div
          className='relative flex min-h-0 flex-1'
          // The mode, and the clock a width change runs on, published once for
          // both column runs to inherit.
          //
          // A focus flip used to change four props on every mounted column —
          // `fill`, `focusMode`, `snap` and `widthMs`, the last one twice — so
          // eighteen columns re-rendered thirty-six times for a change that is
          // entirely presentational. Measured at one 1,001ms task. None of the
          // four is anything but CSS, and a custom property re-resolves during
          // style recalculation without React touching the element at all: the
          // flip is now one attribute and one variable on this node, and the
          // columns below do not re-render for it.
          data-streams-focus={focusMode ? 'on' : 'off'}
          style={
            {
              '--col-anim': `${widthMs}ms`,
              '--focus-peek': `${dev.focusPeek ? FOCUS_PEEK : 0}px`,
            } as CSSProperties
          }
        >
          {/* Pinned columns sit outside the scroller, so they cannot drift.
              Gap is 0 within a column run: the resize handle between each pair
              supplies the spacing, so grabbing it never means aiming at a gap.
              The padding is the focus ring's lane — the ring paints outside the
              border box and every side of this is an overflow edge. */}
          {pinned.length > 0 && (
            <div
              className='flex shrink-0'
              style={{ paddingBlock: RING_GUTTER, paddingLeft: STREAM_LEFT_INSET }}
            >
              {pinned.map(renderColumn)}
            </div>
          )}

          {/* The browser's own scrollbar, given a visible rail via `.streams-strip`
              in global.css. A hand-built thumb was tried and reverted: it has to
              re-derive geometry the browser already owns, and every source of
              drift between the two showed up as jump. */}
          <div className='relative flex min-w-0 flex-1'>
            <div
              ref={stripRef}
              className={cn(
                'streams-strip flex min-w-0 flex-1 items-stretch overflow-x-auto overflow-y-hidden',
                // Scroll anchoring off, and this is a correctness fix rather
                // than a preference. Chrome keeps what you are looking at still
                // by *moving the scroll* whenever the DOM changes outside the
                // viewport — which is the one thing a windowed strip does
                // constantly, mounting and unmounting columns to the left of
                // where you are. The browser reads each of those as content
                // shifting and compensates, so the strip teleports under the
                // hand and a jump lands and is then yanked back off its target.
                // Nothing here needs anchoring: every column's position is
                // computed, and the spacers hold the width of the ones that are
                // absent, so the layout never actually moves for it to correct.
                '[overflow-anchor:none]',
                '[scrollbar-width:auto] [scrollbar-color:hsl(var(--muted-foreground)/0.5)_hsl(var(--muted)/0.6)] [&::-webkit-scrollbar]:h-3 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-track]:bg-[hsl(var(--muted)/0.6)] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:border-[3px] [&::-webkit-scrollbar-thumb]:border-transparent [&::-webkit-scrollbar-thumb]:bg-[hsl(var(--muted-foreground)/0.5)] [&::-webkit-scrollbar-thumb]:bg-clip-content [&::-webkit-scrollbar-thumb:hover]:bg-[hsl(var(--muted-foreground)/0.8)] motion-reduce:scroll-auto',
                'scroll-smooth',
                // Fades, not gutters. A column that ends at a hard edge
                // reads as broken; a fade says "this continues". Each side
                // only appears once something is actually hidden there —
                // an always-on fade dims the first column at rest and
                // looks like a bug. The left one doubles as the boundary
                // with the pinned run, which is why there is no separate
                // fade on the pinned columns themselves.
                //
                // A mask on the scroller rather than two gradient overlays
                // over it. `from-background` could only impersonate the
                // backdrop while the backdrop was flat: against a
                // wallpaper it painted an opaque slab of the wrong colour
                // across both ends. Fading the content itself is the only
                // version that is correct for *any* backdrop, and it costs
                // one CSS class instead of two elements and a re-render
                // per edge crossing. See `.streams-fade-x` in global.css.
                //
                // Always mounted. Toggling the class on and off made the
                // mask appear and vanish between two frames — a hard cut
                // exactly where the point was to soften one. The class
                // stays; what changes is the fade's *width*, tweened from
                // zero, which is only possible because `--fade-x-*` are
                // `@property`-registered lengths.
                'streams-fade-x',
                // Paging, not panning. `mandatory` rather than `proximity`:
                // the whole promise of focus mode is that you are looking
                // at one column, and proximity lets the scroller come to
                // rest halfway between two of them.
                // Engaged through the transition too, not just at rest.
                // This is what keeps the focused column centred while every
                // width on the row changes — and it does it *in the same
                // frame as layout*, which no amount of `requestAnimationFrame`
                // can. rAF callbacks run before style recalculation, so a
                // scroll correction written there is always computed against
                // the previous frame's widths: the row shifts, and the fix
                // lands one frame later. That one-frame lag is the wobble.
                focusMode && 'snap-x snap-mandatory',
              )}
              // The dial steers the left edge only; the right keeps the
              // shared `--fade-x`. Cast because CSSProperties has no index
              // signature for custom properties.
              style={
                {
                  paddingBlock: RING_GUTTER,
                  paddingRight: RING_GUTTER,
                  // Zero, and only when there are no pinned columns holding
                  // the edge — see `STREAM_LEFT_INSET`. When there are, the
                  // pinned run owns the left edge and this is an interior
                  // seam between two runs, where the gutter is right.
                  paddingLeft: pinned.length > 0 ? RING_GUTTER : STREAM_LEFT_INSET,
                  '--fade-x-start': `${dev.leftFade}px`,
                  // Focus mode drives the fade's width rather than its
                  // presence. `off` and a resting `scrolling` collapse both
                  // edges to zero; scrolling opens them again. Tweened, so
                  // the mask grows and shrinks instead of blinking.
                  ...(focusMode &&
                    !(
                      dev.focusFade === 'always' ||
                      (dev.focusFade === 'scrolling' && stripScrolling)
                    ) && { '--fade-x-start': '0px', '--fade-x-end': '0px' }),
                  ...(focusMode && {
                    transition: `--fade-x-start 200ms ${STREAMS_EASE}, --fade-x-end 200ms ${STREAMS_EASE}`,
                  }),
                } as CSSProperties
              }
              data-testid='streams-strip'
            >
              {/* Windowed in deck mode, whole in focus mode. The spacers carry
                  the width of everything not mounted, so the scroll extent and
                  every column's position on it are the same either way — what
                  changes is only how many of them exist. */}
              {windowed.items.map(({ key, gap, column }) => (
                <Fragment key={key}>
                  {gap > 0 && <div aria-hidden className='shrink-0' style={{ width: gap }} />}
                  {renderColumn(column)}
                </Fragment>
              ))}
              {windowed.tail > 0 && (
                <div aria-hidden className='shrink-0' style={{ width: windowed.tail }} />
              )}

              {/* The add slot is a column-sized citizen of the strip, not a chip
              tacked onto the end — it is where the next column will appear.

              In focus mode it is a page like any other, and it has to be: with
              `snap-mandatory` and no snap point of its own, scrolling past the
              last column had nowhere to land and the carousel yanked straight
              back. The end of the list read as a wall.

              Arc does the same thing at the end of its spaces — keep going and
              the "new space" page comes to meet you rather than refusing. Here
              the page already existed; it just was not a stop. */}
              {/* In focus mode the add page is a permanent citizen of the
                        carousel and the palette opens *inside* it — same width,
                        same snap point, contents cross-fading. It used to be two
                        siblings trading places, which is why arriving there cut
                        rather than transitioned.

                        The wide stream keeps the older behaviour: there is no
                        gesture arriving at it, so there is nothing to grow. */}
              {focusMode ? (
                <FocusAddPage
                  ref={addPageRef}
                  present={presentSources}
                  onPick={addColumn}
                  onDismiss={() => setPaletteOpen(false)}
                />
              ) : paletteOpen ? (
                <AddColumnPalette
                  width={addSlotWidth}
                  present={presentSources}
                  onPick={addColumn}
                  onDismiss={() => setPaletteOpen(false)}
                />
              ) : (
                <button
                  type='button'
                  onClick={openAdd}
                  // Radius from the same dial every column reads, never a
                  // `rounded-*` class — a utility would win over the style
                  // and leave the one empty slot a different shape from the
                  // cards beside it.
                  style={{ width: `${addSlotWidth}px`, borderRadius: dev.columnRadius }}
                  // A 1px `border-border` dashed outline over a wallpaper was
                  // very nearly invisible: the slot has no fill of its own, so
                  // the only thing drawing it was a hairline the same value as
                  // the background behind it. A faint card fill gives it a body,
                  // and the dashes are darkened enough to survive on both
                  // wallpapers — still grey, still clearly an empty slot rather
                  // than a column that is already there.
                  className={cn(
                    STREAM_PRESS_ROW,
                    'flex h-full shrink-0 flex-col items-center justify-center gap-2 border-2 border-dashed border-muted-foreground/30 bg-card/40 text-muted-foreground hover:border-muted-foreground/60 hover:bg-card/70 hover:text-foreground',
                  )}
                  data-track-category='Streams'
                  data-track-name='OpenAddPaletteSlot'
                >
                  <PlusDefault size={20} />
                  <span className='text-xs'>Add a column</span>
                  {columns.length === 0 && (
                    <span className='max-w-[15rem] px-6 text-center text-[11px] leading-relaxed text-muted-foreground/70'>
                      A stream is the handful of things you want to watch at once: channels, a
                      board, threads, a topic feed.
                    </span>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

StreamsScreen.displayName = 'StreamsScreen';

export default StreamsScreen;
