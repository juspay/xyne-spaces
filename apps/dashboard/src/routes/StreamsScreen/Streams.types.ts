/**
 * Streams — data model.
 *
 * Vocabulary, held exactly:
 *   Streams  the tab
 *   stream     a named, ordered arrangement of columns; the thing you open
 *   strip    the horizontally scrolling row of columns inside one stream
 *   column   one panel — a channel, a board, a thread list
 *
 * The model is a *composition*, not a projection: a stream is an explicit list a
 * person assembled, never derived from a grouping key. Membership is the point.
 */

export type SurfaceKind = 'channel' | 'board' | 'agent' | 'ticket' | 'thread' | 'document' | 'file';

/**
 * A DM is a channel with a different type, so it needs no variant of its own —
 * only its own category in the add palette, where the distinction is what the
 * user is actually looking for.
 *
 * Two families live in this union, and the difference is worth naming. Most
 * kinds are *places* — a channel, a board, the thread list — things you go to,
 * pick from a palette, and keep. The last four are *items*: one ticket, one
 * thread, one document, one file. You never pick an item from a palette,
 * because you do not know its id; you arrive at one by clicking it inside a
 * place that lists it, and the stream lays it down beside the place you came
 * from. That is the whole reason they are columns rather than modals — opening
 * the ticket does not cost you the board it came from.
 */
export type ColumnSource =
  /**
   * `focusConversationId` deep-links the panel to one thread — set when a column
   * is opened *from* something, such as a feed row, so it lands on the message
   * you clicked rather than at the bottom of the channel.
   */
  | { kind: 'channel'; channelId: string; focusConversationId?: string }
  | { kind: 'board'; viewMode: 'my-tickets' | 'board'; channelId?: string }
  /** `channelId` carries the context the Ask AI column was opened from. */
  | { kind: 'agent'; channelId?: string }
  /**
   * One ticket.
   *
   * `channelId` and `conversationId` are carried because the discussion under a
   * ticket lives in a channel thread, and the column offers a way across to it
   * — without them the column could still render the ticket but would be a dead
   * end, which is the thing a stream exists not to be.
   */
  | { kind: 'ticket'; ticketId: string; channelId?: string; conversationId?: string }
  /**
   * One thread.
   *
   * Distinct from a `channel` column carrying `focusConversationId`: that is a
   * channel *scrolled to* a message, still showing everything around it. This is
   * the thread on its own, the way the app's thread panel shows it.
   */
  | { kind: 'thread'; channelId: string; conversationId: string; ticketId?: string }
  /** One canvas document. `channelId` is the channel it was opened from, if any. */
  | { kind: 'document'; canvasId: string; channelId?: string }
  /**
   * One attachment, rendered in place rather than in the global viewer modal.
   *
   * Name and mime type are stored rather than looked up, because the file
   * viewer needs both to choose a renderer *before* anything is fetched, and a
   * column that had to resolve its own title from a query would show an empty
   * header on every reload. The download URL is derived from the id, so it is
   * not stored — a URL in localStorage is a URL that goes stale.
   */
  | {
      kind: 'file';
      attachmentId: string;
      fileName: string;
      mimeType: string;
      fileSize?: number;
      channelId?: string;
    };

export interface Column {
  /**
   * Column-local id, deliberately NOT the entity id. Two columns may point at
   * the same channel — filtered differently, or just watched twice — so layout
   * must never be keyed by what a column is showing.
   */
  id: string;
  source: ColumnSource;
  /**
   * Width in **pixels**, fixed.
   *
   * Deliberately not a fraction of the viewport. A fraction means every column
   * silently resizes whenever the window does, which fights the one rule the
   * whole layout rests on: a column stays where you put it, at the size you made
   * it. Width is the user's, and only a drag on the handle changes it.
   *
   * A consequence worth knowing: on a narrower screen the stream simply extends
   * further right and you pan to reach it, rather than every column shrinking to
   * stay in view. That is the correct trade for a spatial layout.
   */
  width: number;
  /** User override; the surface resolves its own title when absent. */
  title?: string;
  /** Pinned columns hold the left edge and never scroll away. */
  pinned?: boolean;
  /**
   * The column this one belongs to, by id. Absent means it stands alone.
   *
   * An *attached* column is the stream's answer to "I opened this from somewhere,
   * and it makes no sense without that somewhere" — a thread read out of a
   * channel, a ticket picked off a board. It renders immediately right of its
   * parent, sharing one outer border, so the pair reads as a single split panel
   * rather than as two columns that happen to be adjacent.
   *
   * A parent holds at most one. Opening a second thing from the same channel
   * replaces what is in the slot rather than growing the stream — which is the
   * point: a channel is a place you browse, and browsing should not cost you a
   * column per click. `detach` is how you say "keep this one", and it does
   * nothing but clear this field.
   *
   * Why a flat id on the child rather than nesting the child inside the parent:
   * everything in the stream — focus index, drag-to-reorder, the FLIP, the width
   * transitions — walks `columns` as a flat list, and a nested column would be
   * invisible to all of it. As a sibling with a back-pointer, an attached column
   * *is* a column, and detaching is a field going away rather than a subtree
   * being re-parented. That is what makes detach free of a remount: the React
   * element never moves.
   */
  attachedTo?: string;
  /**
   * Half of a pair, currently squeezed out in favour of the other half.
   *
   * Set on the *parent* when you drag the seam left past the channel's own
   * minimum width: the channel gives way and the pane it was holding takes the
   * whole panel. That is the narrow end of the same gesture that opened it —
   * two columns wide you get both, squeeze it down and you get the thing you
   * opened.
   *
   * A flag rather than a width of zero, because `width` has to go on meaning
   * the width to come *back* to. A collapsed column keeps its size, its
   * subscriptions and its mounted surface; it is only not drawn. Restoring is
   * dragging the seam back right, and it lands exactly where it left.
   */
  collapsed?: boolean;
  addedAt: number;
}

/**
 * Something dropped on a column, on its way into that column's surface.
 *
 * Deliberately *not* part of `Column`, and so never persisted: a question
 * prepared by a drag is a live gesture, and finding it still sitting in the
 * composer after a reload two days later would be the stream remembering
 * something nobody asked it to.
 */
export interface ColumnSeed {
  /** Text to place in the column's composer, unsent. */
  query: string;
  /** Bumped on every drop, so dropping the same thread twice seeds twice. */
  nonce: number;
}

export interface Stream {
  id: string;
  name: string;
  columns: Column[];
  /** Index into `columns`. May equal `columns.length` — the "+ add" slot. */
  focus: number;
  createdAt: number;
  /**
   * When the stream was archived. Absent means live.
   *
   * Archiving is the deliberate alternative to deleting, and it exists because
   * the arrangement *is* the work: which channels, in which order, at which
   * widths, is a thing you assembled once and would have to reassemble from
   * memory otherwise. A stream you are finished with for now is not a stream you
   * want to rebuild.
   *
   * A timestamp rather than a boolean, because "when did I put this down" is
   * the only question anyone asks of an archived stream, and a flag cannot
   * answer it.
   *
   * An archived stream's columns are never mounted, and that is the point of the
   * state rather than an optimisation on top of it: every column holds a live
   * subscription, so a stream you archived away still costing you notifications
   * would be the opposite of what archiving means.
   */
  archivedAt?: number;
}

export interface StreamsLayout {
  version: 1;
  streams: Stream[];
  /**
   * The open stream, by id.
   *
   * An id, not an index into `streams` — which is what this was for as long as
   * there was only ever one stream and the index was always zero. Every stream
   * operation moves elements around that array: create appends, delete splices,
   * archive changes which entries count. An index has to be fixed up by each of
   * them, and the failure when one forgets is silent — you land on a different
   * stream than the one you asked for, with no error to notice. An id has no
   * relationship to position and so cannot drift.
   *
   * Always names a stream that exists and is not archived. `loadLayout` and every
   * helper in `streamsLayout.ts` enforce that through one `settle` call.
   */
  activeStreamId: string;
}

/**
 * Default column width in pixels.
 *
 * Wide enough that Xyne's channel panel — avatar gutter, timestamps, ticket
 * cards — does not read cramped, narrow enough that two columns plus part of a
 * third are on screen at once. The point of a stream is seeing several things, so
 * a default that fills the viewport defeats it.
 */
export const DEFAULT_WIDTH = 360;
/** Hard floor and ceiling for a dragged column, whatever the surface asks for. */
/**
 * The narrowest each surface stays usable at.
 *
 * Data rather than a lookup on the surface registry, and deliberately so: the
 * registry imports every surface component, so anything importing it to read one
 * number drags the whole component graph in with it. `useAddToStream` is mounted
 * from a ticket page and a canvas, both of which the registry itself imports —
 * reading the width from there closed an import cycle and left the registry
 * holding `undefined` components at module-init.
 */
export const SURFACE_MIN_WIDTHS: Record<SurfaceKind, number> = {
  channel: 320,
  board: 600,
  agent: 420,
  ticket: 400,
  thread: 340,
  document: 420,
  file: 320,
};

export const MIN_WIDTH = 280;
export const MAX_WIDTH = 1600;
export const COLUMN_GAP = 10;
/**
 * Inset around the whole strip, in px.
 *
 * Four, not ten. Ten put the stream adrift from the app's own edges — the nav's
 * icons and the first card read as belonging to two different layouts. The focus
 * ring still has room because `RING_GUTTER` inside the scroller is what reserves
 * it; this is only the outer frame.
 *
 * Applies to the right and the bottom. The left is `STREAM_LEFT_INSET`, and the
 * reason those are different numbers is below.
 */
export const STRIP_PAD = 4;
/** Room for the focus ring to paint outside a column without being clipped. */
export const RING_GUTTER = 4;

/**
 * How far the stream's content sits from the side nav, in px. Zero, deliberately.
 *
 * The side nav is a 60px rail holding 32px icons on a 12px pad, so every icon
 * in it — including the workspace avatar at the top — sits 14px from the window
 * edge and 14px from the rail's own trailing edge. Anything the stream adds on top
 * of that lands *only* on the right of those icons, so the rail stops reading as
 * a rail with even margins and starts reading as one shoved against the left
 * edge. `STRIP_PAD` plus `RING_GUTTER` was adding eight, which is more than half
 * the inset again.
 *
 * That gap was right when the nav had a divider: a border needs air on both
 * sides of it or the first column looks welded to the chrome. The bleed ground
 * removed the divider, and with it the thing the eight pixels were spacing away
 * from — leaving a gap measuring the absence of a line.
 *
 * Zero rather than a smaller number because the ring lane it would otherwise
 * preserve is not in use: the focus ring is settled off (`focusRing` in
 * `DEV_DEFAULTS`), so nothing paints outside a column's border box and there is
 * nothing on the left edge left to clip. Turning the ring back on means giving
 * this back `RING_GUTTER`, and accepting that the nav reads asymmetric again.
 */
export const STREAM_LEFT_INSET = 0;

/**
 * Horizontal inset of the screen header, in px.
 *
 * Derived rather than picked: the stream starts at `STREAM_LEFT_INSET`, a column
 * adds its own 1px border, and a column header sits at `px-3` inside that. Land
 * the screen header on the same number and "Streams" starts on the same vertical
 * as the first column's icon — leftmost content to leftmost content — instead of
 * stopping a few pixels short, the kind of gap that has no name but reads as
 * sloppy.
 */
export const HEADER_INSET = STREAM_LEFT_INSET + 1 + 12;

/**
 * Vertical breathing room around the screen header, in px.
 *
 * Matches the `py-3` a channel header carries. Only the *top* gets it whole —
 * see the note where it is applied.
 */
export const HEADER_PAD = 12;

/**
 * What already sits between the header and the first card, in px.
 *
 * The strip wrapper's own inset plus the scroller's ring gutter, less the couple
 * of pixels the header's flex centring leaves under its text. Measured rather
 * than derived: the arithmetic of the three boxes says eight, and the rendered
 * result is six, so the arithmetic is missing something and the ruler is not.
 * The header subtracts this from its bottom padding so the gap under the title
 * comes out equal to the one above it.
 */
export const STRIP_LEAD = 6;

/**
 * How much of the next column stays visible past the focused one in focus mode.
 *
 * Not zero. A column that fills the scroller exactly looks like the only thing
 * there is, and the whole promise of focus mode is that the rest of the stream is
 * still alive one scroll away — the sliver is what says so.
 */
export const FOCUS_PEEK = 56;

/**
 * How long the whole focus-mode change takes.
 *
 * One number for three things that must move as one: the focused column's width,
 * the strip's scroll position, and the rail sliding in. When they had separate
 * timings the mode change read as three unrelated events — the layout snapped
 * instantly with no tween at all, and then the strip drifted for another second
 * on native smooth-scroll behind it.
 *
 * 260ms is a layout change of most of the viewport. Shorter reads as a cut;
 * much longer and you are waiting for a mode you already chose.
 */
export const FOCUS_MS = 260;

/**
 * The stream's easing, everywhere. Already the curve every column transition uses;
 * named here so the focus transition cannot quietly drift onto a different one.
 */
export const STREAMS_EASE = 'cubic-bezier(0.23, 1, 0.32, 1)';

/**
 * The curve for the focus-mode change specifically — symmetric, gentle at both
 * ends, rather than the stream's usual hard ease-out.
 *
 * The reason is not taste. The commit that starts this transition is expensive
 * (eight chat panels relayout), so the first *painted* frame lands some way into
 * the curve. Under an ease-out, which does most of its travel immediately, that
 * late first frame skips a huge distance — measured, a single jump of 550px out
 * of 896px of travel. A curve that starts slowly has barely moved by then, so
 * the same lost time costs almost nothing on screen.
 *
 * `STREAMS_EASE` stays the stream's default everywhere else, where transitions
 * start on a cheap commit and the snappier ease-out is the better read.
 */
export const FOCUS_EASE = 'cubic-bezier(0.65, 0, 0.35, 1)';

/**
 * How long a jump between columns takes in focus mode.
 *
 * Shorter than the mode change, and deliberately: entering focus mode rearranges
 * the screen, while moving between two columns is one page sliding to the next.
 * Native smooth scrolling is not used here because its duration scales with
 * distance — and in focus mode every jump is at least one full page wide, which
 * is exactly where Chrome's curve takes about twice this and reads as sluggish.
 */
export const FOCUS_SCROLL_MS = 200;

/**
 * How centred the add page has to be before it opens the palette by itself.
 *
 * Not 1. Snap lands within a pixel or two of exact, and momentum can leave it a
 * hair short, so demanding a perfect centre means the commit sometimes silently
 * never happens — which is the old dead-end behaviour with extra steps. Not much
 * below this either: committing while a column is still half on screen would fire
 * on someone scrolling *past* it, and this opens a panel that takes the keyboard.
 */
export const ADD_COMMIT_AT = 0.92;

/**
 * How long a closing column takes to collapse before it leaves the stream.
 *
 * Shared because two files have to agree on it: `StreamColumn` transitions its
 * width over this, and `StreamsScreen` waits exactly this long before dropping
 * the column from the stream. Split them and you get either a column torn out
 * mid-collapse or a 0px gap sitting in the strip.
 *
 * The one place the stream animates a layout property, and worth it: removing a
 * column outright threw every column to its right sideways with no warning.
 */
export const COLUMN_CLOSE_MS = 200;

/**
 * How long the "it is already open, and it is here" ring stays lit, in ms.
 *
 * Must match the `streams-column-flash` animation in global.css: this drives the
 * timer that removes the class, and a timer shorter than the keyframe cuts the
 * ring off mid-fade while a longer one leaves a dead class on the node.
 *
 * 300, down from 900. The flash answers a glance — you asked for a column you
 * already had, and it says where. Something that outlasts the glance stops
 * reading as an answer and starts reading as an alert, which is the opposite of
 * what a "you already have this" cue should feel like.
 */
export const COLUMN_FLASH_MS = 300;

/**
 * How long a new column takes to open, in ms.
 *
 * Longer than the close, following the rule the focus ring already sets in
 * `StreamColumn`: arriving settles, leaving gets out of the way. A column
 * appearing is something you asked for and want to watch land; a column closing
 * is something you are finished with and want gone.
 *
 * The animation is a *reveal*, not a squash. The column's own box grows from
 * zero while its contents hold their final width behind an overflow clip, so
 * the panel is uncovered rather than unfolded. That is both the better read —
 * text does not stretch into place — and much the cheaper one, since a live chat
 * panel is not relaid out on every frame of the tween.
 */
export const COLUMN_OPEN_MS = 240;
/**
 * Nominal viewport used to convert widths saved by the earlier fraction-based
 * build into pixels, so an existing stream keeps its proportions on first load.
 */
export const LEGACY_VIEWPORT = 1440;

/**
 * The stream's header actions, as a channel header writes them.
 *
 * Not a hand-rolled button: `Button variant='ghost'` carries the hover fill, the
 * focus ring, the disabled treatment and the transition that every other icon
 * button in the app has, and reimplementing four of those five by hand is how
 * this bar ended up looking like a different product. The only additions are the
 * box size and the muted-at-rest colour, which is exactly what
 * `ConversationHeader` adds too.
 */
export const STREAM_ACTION = 'h-7 w-7 rounded-lg shrink-0';
/**
 * Idle-to-hover, in ink rather than in a colour.
 *
 * `ghost`'s own `hover:bg-accent` is a solid grey, which is right on the opaque
 * page every other header sits on and wrong here: this bar can sit directly on
 * the wallpaper, and an opaque swatch over a gradient reads as a grey patch
 * stuck to the screen rather than as the button lighting up. An alpha overlay
 * composites with whatever is underneath — gradient, `#fafafa` or plain white —
 * and it inverts for free in dark mode, where `--foreground` is near-white.
 *
 * twMerge lets this win over the variant's own hover, the same way
 * `ConversationHeader` overrides its text colours.
 */
export const STREAM_ACTION_IDLE =
  'text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground';
