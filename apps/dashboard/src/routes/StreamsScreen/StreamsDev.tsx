import { createContext, useContext } from 'react';
// Shipped as a separate entry point, and the panel is unusable without it — the
// controls render as raw block elements at page width and shove the app down.
import { DEFAULT_WIDTH } from './Streams.types';
import type { StreamNavVariant } from './StreamTopNav';

/**
 * Streams' dev dials.
 *
 * Several of the decisions in here are genuinely arguable — whether unfocused
 * columns should dim, whether looking at a column counts as reading it, what
 * the stream sits on. Arguing them in the abstract is slower and worse than
 * flipping them and seeing which one feels right, so they are live switches
 * rather than constants.
 *
 * A dial earns its slot by being *undecided*. Once a question is answered the
 * dial is the wrong shape for the answer: it invites re-litigating a settled
 * call, and it keeps a branch alive that only one side of will ever ship. So
 * settled questions leave the panel and become fixed values in `DEV_DEFAULTS`.
 * They stay on the settings object rather than being inlined at each consumer,
 * because that keeps reopening one a one-line change instead of a refactor.
 *
 * The tuning panel itself is a development tool and is not part of this
 * feature — these are the values it settled on, frozen. Nothing in the product
 * reads them directly: they land in a context and the components take them from
 * there, so reopening a question is restoring a panel over this same object.
 */
export interface StreamsDevSettings {
  /** Scroll the focused column to the middle of the strip. Settled: off. */
  autoCenter: boolean;
  /** Draw the ring and shadow on the focused column. Settled: off. */
  focusRing: boolean;
  /** Width a new column gets, and what "reset width" resets to. */
  defaultWidth: number;
  /** When a channel column stops counting as unread. */
  markRead: MarkReadPolicy;
  /** Edge pills pointing at off-screen activity. */
  jumpPills: boolean;
  /** Whether they list everything off screen, or only what has something new. */
  pillScope: PillScope;
  /**
   * The stream as a row of tabs, on the header's own line.
   *
   * The other answer to the same question the jump pills answer, and undecided
   * against them rather than replacing them — one is a list of what you cannot
   * see, the other is the whole stream with your place in it. They do not collide,
   * so both can be on while the question is open.
   *
   * The five rows are in turn undecided against each other. They draw the same
   * tabs and the same signal — every column on screen is lit, in proportion to
   * how much of it is — and differ only in how the row handles a stream wider than
   * the space it has: scroll with the stream, scroll by hand, shrink each tab to
   * its column's share, drop the labels outside the run, or mask down to an
   * aperture.
   */
  topNav: StreamNavMode;
  /** Peak opacity of the veil's wash, in percent. */
  veilDim: number;
  /** Peak blur behind the veil, in px. 0 makes it a plain dim. */
  veilBlur: number;
  /**
   * The index row's geometry, all in px.
   *
   * `tickPitch` is the hit target and therefore the spacing; `tickW` is only the
   * mark, which is why they are two numbers rather than one. The three heights
   * are the whole state vocabulary of the row — off, on screen, and pointed at —
   * so the distance between them is the distance between "I can see that column"
   * and "I cannot", which is the thing worth being able to turn by hand.
   */
  tickPitch: number;
  tickW: number;
  tickOff: number;
  tickOn: number;
  tickHover: number;
  /**
   * Which edge the marks sit on.
   *
   * `center` grows every tick from its own middle, so the row reads as a rule
   * with weight either side of one line. `top` hangs them all from the top and
   * grows them down, which gives the row a hard shared edge and turns the lit
   * run into something closer to a bar chart. They are different objects, not
   * two settings of one.
   */
  tickAnchor: TickAnchor;
  /** Paint columns with unread activity in the accent. */
  tickAlerts: boolean;
  /**
   * The floating stream dock: every column, always, wherever you put it.
   *
   * Off by default. It is a fourth answer to "where is everything", alongside
   * the jump pills, the tab row and the focus rail, and the point of having all
   * four at once is to use them against each other — not to ship all four.
   */
  /**
   * Mark the tab row the way the rest of the workspace marks a channel.
   *
   * The sidebar makes one distinction and Streams should not invent a second:
   * a **numeric pill** for things addressed to you, and a **bold name** for a
   * channel that simply moved. `ColumnActivity` already carries exactly those
   * two tiers — `count` and `hasNew` — so this is a rendering choice, not new
   * data.
   *
   * A dial rather than a decision because it costs something real: a name that
   * goes bold is a name that gets wider, and this row is laid out from its
   * labels. See `NavPill` in StreamTopNav.tsx.
   */
  navBadges: boolean;
  /**
   * Drop the lit run: every tab, and every tick, the same grey.
   *
   * The lighting answers "which columns am I looking at", and the honest case
   * against it is that the screen already answers that — the columns are right
   * there. What the row is *for* might just be "here is the stream, jump to one",
   * in which case a highlight that tracks the scroll is a second thing moving
   * for no new information.
   *
   * Hover still lifts. This removes the readout, not the response.
   */
  navFlat: boolean;
  /**
   * Dress the tab row as a sidebar nav item.
   *
   * The app's sidebar already has a settled answer for "a row you can click that
   * names a place": `text-sidebar-foreground` at rest, `bg-sidebar-accent` plus
   * `text-sidebar-accent-foreground` on hover, `font-medium`, a transparent
   * border that the accent fills in, and `transition-colors`. The stream header
   * invented its own vocabulary for the same object.
   *
   * Note what this necessarily removes: the sidebar has no concept of a lit run,
   * so neither does this mode. Taking its behaviour means taking its silence
   * about which items you are currently looking at.
   */
  navSidebar: boolean;
  /**
   * Breathing room above and below the header strip, in px.
   *
   * A dial rather than the constant because the header carries three things now
   * — the title, the stream switcher and the nav row — and how much air that wants
   * is not a thing to settle by arithmetic. The row below it subtracts
   * `STRIP_LEAD` from this, so the gap to the first card stays proportional
   * however this moves.
   */
  headerPad: number;
  /** The per-column "Catch me up" digest, above a channel's messages. */
  columnCatchUp: boolean;
  /** Whether the stream's column list draws across the top or down the side. */
  navPlacement: NavPlacement;
  /**
   * Let the neighbouring columns show at the page edges in focus mode.
   *
   * Off, the focused page is the whole width — no sliver of the next column, no
   * hint that there is one. It is the difference between focus mode as "this
   * column, with the stream still around it" and as "only this column".
   */
  focusPeek: boolean;
  /** When the strip's edge fade shows in focus mode. */
  focusFade: FocusFade;
  streamDock: boolean;
  /**
   * Render the dock in the opposite theme to the app.
   *
   * Dark panel on a light stream, light panel on a dark one. A floating navigator
   * has a different job from the content under it, and matching the content is
   * what makes it read as part of the stream rather than as something sitting on
   * top of it. Whether that is worth the contrast cost is a thing to look at
   * rather than argue about, hence a dial.
   */
  dockInvert: boolean;
  /**
   * Width of the strip's left-edge fade, in px. 0 turns it off.
   *
   * A dial because the right amount is a function of what is *behind* the stream,
   * which is itself dialled: the fade is a mask, so it reveals the wallpaper
   * rather than painting over it, and how far in it has to travel before the
   * column stops reading as cut off depends on how busy that wallpaper is. The
   * left edge alone, because it is the one that doubles as the boundary with
   * the pinned run — the right edge only ever meets the page.
   */
  leftFade: number;
  /** A line of what is happening on each Overview card. Settled: off. */
  overviewSummaries: boolean;
  /** One line above the strip for what changed across the stream. Settled: off. */
  streamCatchUp: boolean;
  /** How long entering or leaving focus mode takes, in ms. Settled: 430. */
  focusMs: number;
  /**
   * Draw the 1px edge on each column.
   *
   * Off, the columns read as panes of one surface separated by the gap alone;
   * on, as a set of cards laid on it. Which is right depends on how many are
   * open — three cards look deliberate, eight look like a table — so it is a
   * switch rather than a decision.
   */
  columnBorders: boolean;
  /** Corner radius of a column, in px. Settled: 20. */
  columnRadius: number;
  /** Which end of the column header the focus button sits at. */
  focusSide: FocusSide;
  /** What the stream sits on. See `StreamGround`. */
  ground: StreamGround;
}

export type MarkReadPolicy = 'never' | 'on-leave' | 'on-focus';

/**
 * What the stream sits on.
 *
 * `theme` — the app's own opaque page colour, like every other screen.
 * `paper` — a flat off-white, slightly lifted from the theme.
 * `bleed` — nothing at all, so the fixed wallpaper layer behind the whole app,
 * the one the sidenav floats on, carries straight through the stream instead
 * of stopping at its edge. The columns then read as cards laid on the page
 * rather than panes cut out of a slab.
 */
export type StreamGround = 'theme' | 'paper' | 'bleed';

/**
 * `activity` — a notification: only columns with something new.
 * `always` — a navigator: everything currently off screen.
 *
 * The second use turned up by accident. Once every off-screen column is named
 * and one click away, the panel stops being a thing that interrupts you and
 * becomes the fastest way around a wide stream.
 */
export type NavPlacement = 'top' | 'side' | 'off';

export type FocusFade = 'off' | 'scrolling' | 'always';

export type PillScope = 'activity' | 'always';

/**
 * `off` — no tab row. `list` — every tab, in the header's flex slot, current one
 * weighted. `window` — an aperture centred on the screen over the run of columns
 * you can see, widening to the whole stream on hover and marking nothing.
 */
export type StreamNavMode = 'off' | StreamNavVariant;

/** Which edge the index's marks sit on and grow from. */
export type TickAnchor = 'center' | 'top';

/**
 * Which end of a column header the focus button sits at.
 *
 * `left` puts it beside the pin, with the verbs that say something about *this
 * column's place in the stream*. `right` puts it at the head of the group that
 * ends in close, with the verbs that change how much of the stream you see.
 *
 * Both readings are defensible and neither survives being argued in the
 * abstract — the button is 14px, and which group it belongs to is a question
 * about the shape of the whole row at a glance.
 */
export type FocusSide = 'left' | 'right';

/**
 * Option labels are kept to a word or two on purpose.
 *
 * The panel puts a control's name and its current value on one line in about
 * 305px, so an option label reading "Bleed — the sidenav ground, through" has
 * nowhere to go: it collides with the name to its left and then truncates. What
 * each option *means* belongs in the doc comment on its type, which is where a
 * sentence can actually be read — not in a string competing for 140px.
 */

export const DEV_DEFAULTS: StreamsDevSettings = {
  // Settled, both off. Recentring moved the whole stream sideways every time you
  // clicked into a column — the strip is a place, and a place should not shift
  // under you for looking at part of it. The ring was a second focus signal on
  // top of the one the column's own chrome already carries.
  autoCenter: false,
  focusRing: false,
  defaultWidth: DEFAULT_WIDTH,
  // Off by default, and the reason is the bug that produced this panel: with
  // `on-leave`, clicking anything in column B silently cleared column A's badge
  // — a column you never read, marked read because focus happened to be sitting
  // there. Clearing is the badge's own click until a policy earns the default.
  markRead: 'never',
  // Off. The strip's own edge fade and the nav's overflow marks both answer
  // "what is off screen and wants you" now, and three answers to one question is
  // two too many. Still a dial, because which of the three survives is undecided.
  jumpPills: false,
  pillScope: 'always',
  topNav: 'scroll',
  // Off by default. It is a strong effect over live content, and a stream that
  // dims every time the pointer crosses the header is a stream that flinches.
  veilDim: 55,
  veilBlur: 6,
  tickPitch: 12,
  tickW: 1,
  tickOff: 7,
  tickOn: 15,
  tickHover: 21,
  tickAnchor: 'center' as TickAnchor,
  tickAlerts: false,
  // On. The badge is the only thing in the top nav that says *which* column
  // wants you, and without it the row is a map with no you-are-here.
  navBadges: true,
  navFlat: false,
  // Settled on. The sidebar reading of the row is the one that survived: the
  // alternatives all wanted the tab to be a label, and a stream's tabs are places.
  navSidebar: true,
  // 8, not `HEADER_PAD`'s 12. The header carries three things now — the stream
  // name, the switcher and the nav row — and at 12 the band above the strip read
  // as a gap rather than as breathing room.
  headerPad: 6,
  // Off. It is a live query per channel column and a second header above the
  // one the column already has — worth reaching for, not worth every column
  // carrying it at rest.
  columnCatchUp: false,
  navPlacement: 'top' as NavPlacement,
  // Off. The sliver of the next column was a reminder that a stream surrounds
  // the one you are reading; in practice it reads as a page that did not finish
  // arriving.
  focusPeek: false,
  // While scrolling. The edge mask earns its place in the wide stream, where
  // content really does run off both sides. A focused page at rest has nothing
  // running off it — it *is* the width — so a permanent fade only dims the first
  // and last few characters of text that is entirely on screen. Mid-scroll there
  // genuinely is content crossing both edges, which is the moment the softening
  // is for.
  focusFade: 'off' as FocusFade,
  streamDock: false,
  dockInvert: false,
  // Settled at 16. Thirty-two was `w-8`, the size of the gradient overlays the
  // mask replaced — inherited rather than chosen. With the stream now flush against
  // the nav rail (`STREAM_LEFT_INSET`), a 32px fade ate half the first column's
  // header before you reached its title, so the column read as half-arrived
  // rather than as the leftmost thing on screen. 16 still softens the cut where
  // content passes under the rail without dimming anything you are trying to read.
  leftFade: 16,
  // Settled, both off. A summary is a live query per card, and twelve of them
  // read as a wall rather than as information; the catch-up line above the
  // strip says what the dots on the columns already say.
  overviewSummaries: false,
  streamCatchUp: false,
  // Settled at 280. It was 430, chosen to hide an expensive first frame: the
  // commit that starts the transition relayouts every chat panel and mounts the
  // rail, so the curve had already begun by the time anything painted, and a
  // long duration made that lost head start a small share of the whole.
  //
  // That was compensating for the render blocking rather than for the motion.
  // With the stream's commit cost fixed (stable column callbacks, `patchStream`
  // bailing on no-op focus writes) the first frame lands on time, and 430ms of
  // travel with nothing to hide reads as sluggish. UI transitions want to stay
  // under 300ms; 280 is the top of that band, which suits a move this large.
  focusMs: 280,
  columnBorders: true,
  // Settled at 20. The `rounded-xl` this shipped with read as a pane cut out of
  // the page; at 20 a column reads as a card laid on it, which is the model the
  // rest of the stream is built on.
  columnRadius: 20,
  focusSide: 'right',
  ground: 'bleed',
};

const StreamsDevContext = createContext<StreamsDevSettings>(DEV_DEFAULTS);

export const StreamsDevProvider = StreamsDevContext.Provider;

export const useStreamsDev = (): StreamsDevSettings => useContext(StreamsDevContext);
