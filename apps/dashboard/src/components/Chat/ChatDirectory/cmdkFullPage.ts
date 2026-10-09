// Cmd+K <-> /search-results: the grow morph, the collapse stand-in, and the Back hold.
import { NavigationType } from 'react-router-dom';
import { searchMetricsService } from '../../../services/searchMetricsService';
import { announceFullPageOpened, PAGE_COVERING_EVENT } from '../../../hooks/usePageCoverage';
import { OVERLAY_STATE_KEY } from '../../../hooks/useHistoryBackedOverlay';
import {
  DEFAULT_SEARCH_FILTERS,
  type SearchResultsFilters,
} from '../../../hooks/useSearchResultsScreen';
import {
  filtersFromChips,
  writeFiltersToParams,
  type ResultsMention,
} from '../../../search/filterRegistry';
import { TAB_TO_DOC_TYPE, type TabType } from './ChannelCommandMenu.types';
import {
  loadCmdkPolicy,
  onBannerShown,
  onCollapseToModal,
  onExpandToFull,
  onResultOpened,
  onSessionEnd,
  saveCmdkPolicy,
  type CmdkOpenOrigin,
  type CmdkPolicyOptions,
  type CmdkReturnQuery,
  type CmdkSize,
} from '../../../search/cmdkPolicy';
import type {
  SearchFullPageOpenEvent,
  SearchFullPageSnackbarEvent,
  SearchReturnBannerEvent,
} from '../../../types/searchEvents';

// ─── Motion ─────────────────────────────────────────────────────────────────

const MORPH_MS = 380;
const MORPH_EASE = 'cubic-bezier(.16,1,.3,1)';
const CONTENT_FADE_MS = 160;
// The palette's md:rounded-2xl.
const MODAL_RADIUS = '16px';
// The palette's shadow (its class in ChannelCommandMenu), for the collapse stand-in.
const MODAL_SHADOW =
  '0px 7px 15px 0px #0000000D, 0px 28px 28px 0px #00000017, 0px 62px 37px 0px #0000000D, 0px 111px 44px 0px #00000003';
// Hides the palette's content while it grows into full page, through a rule in global.css rather
// than per-child animations, so rows that render meanwhile stay hidden.
const SURFACE_ONLY_ATTR = 'data-cmdk-surface-only';
// The results-page skeleton the grown palette shows while the page renders; the surface-only rule
// leaves it visible.
const SKELETON_ATTR = 'data-cmdk-skeleton';

/** Results-page param carrying the result that was highlighted when the palette expanded. */
export const SELECTED_RESULT_PARAM = 'sel';

/** Whether `pathname` is full-page search (the results page). */
export const isFullPageSearchPath = (pathname: string): boolean =>
  pathname.endsWith('/search-results');

/** Marks the element full page fills — the `<main>` the workspace routes render into. */
export const FULL_PAGE_TARGET_ATTR = 'data-cmdk-full-page';

/** Inside the full-page target: the page full page opened over, kept mounted and hidden. */
export const KEPT_PAGE_ATTR = 'data-cmdk-kept-page';

/** On the page under full page: its path, for a collapse to tell whether it lands there. */
export const KEPT_PATH_ATTR = 'data-cmdk-kept-path';

/**
 * On the page under full page once it is drawn again: lifts the render-skipping full page puts on
 * it while it opens (global.css).
 */
export const KEPT_DRAWN_ATTR = 'data-cmdk-drawn';

/** Inside the full-page target: the results page itself. */
export const RESULTS_PAGE_ATTR = 'data-cmdk-results-page';

/** The results page's query box. */
export const FULL_PAGE_QUERY_INPUT_ID = 'search-query-input';

/**
 * Navigation state of a results page opened on what was typed as Cmd+K grew into it: the user is
 * still typing, so its first search waits out the typing like any other.
 */
export const TYPED_QUERY_STATE_KEY = 'cmdkTypedQuery';

/**
 * A dialog is open over the page — not one the page itself renders in place (a Desk compose
 * window), which stays mounted under full page, inert, and must not hold up full page's keys or
 * focus.
 */
export function isDialogOpenOverPage(): boolean {
  return Array.from(document.querySelectorAll('[role="dialog"]')).some(
    dialog => !dialog.closest(`[${KEPT_PAGE_ATTR}]`),
  );
}

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Where full page sits on screen: the route area, or the whole viewport when it can't be found. */
export function fullPageBox(): Box {
  const target = Array.from(document.querySelectorAll<HTMLElement>(`[${FULL_PAGE_TARGET_ATTR}]`))
    .map(el => el.getBoundingClientRect())
    .find(rect => rect.width > 0 && rect.height > 0);
  if (target) {
    return { top: target.top, left: target.left, width: target.width, height: target.height };
  }
  return { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight };
}

export const prefersReducedMotion = (): boolean =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Explicit geometry for one end of the morph. `transform: none` and `max-width: none` lift the
// palette's centring translate and max-w cap for the length of the animation.
const frame = (box: Box, borderRadius: string, boxShadow: string): Keyframe => ({
  top: `${box.top}px`,
  left: `${box.left}px`,
  width: `${box.width}px`,
  height: `${box.height}px`,
  borderRadius,
  boxShadow,
  transform: 'none',
  maxWidth: 'none',
});

const fadeChildren = (
  el: HTMLElement,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
): void => {
  Array.from(el.children).forEach(child => child.animate(keyframes, options));
};

// A flag code can wait on: `wait` resolves once it is open, or after `timeoutMs` at the latest so
// nothing waits on it for ever (`onTimeout` runs then).
function createLatch(initiallyOpen: boolean): {
  close: () => void;
  open: () => void;
  wait: (timeoutMs: number, onTimeout?: () => void) => Promise<void>;
} {
  let isOpen = initiallyOpen;
  let waiters: Array<() => void> = [];
  return {
    close: (): void => {
      isOpen = false;
    },
    open: (): void => {
      isOpen = true;
      waiters.splice(0).forEach(resolve => resolve());
    },
    wait: (timeoutMs, onTimeout): Promise<void> => {
      if (isOpen) return Promise.resolve();
      return new Promise(resolve => {
        const done = (): void => {
          clearTimeout(timer);
          waiters = waiters.filter(waiter => waiter !== done);
          resolve();
        };
        const timer = setTimeout(() => {
          onTimeout?.();
          done();
        }, timeoutMs);
        waiters.push(done);
      });
    },
  };
}

/**
 * Grow the palette from where it sits to full page. Resolves once it covers the route area, so
 * the caller can hand off to the route; the element keeps its final frame until it unmounts.
 */
export function growToFullPage(el: HTMLElement): Promise<void> {
  window.dispatchEvent(new Event(PAGE_COVERING_EVENT));
  if (prefersReducedMotion()) return Promise.resolve();
  const from = el.getBoundingClientRect();
  lastModalBox = { top: from.top, left: from.left, width: from.width, height: from.height };
  const shadow = getComputedStyle(el).boxShadow;
  // The content steps aside first so the layout never visibly reflows mid-resize.
  fadeChildren(el, [{ opacity: 1 }, { opacity: 0 }], {
    duration: CONTENT_FADE_MS,
    easing: 'ease',
    fill: 'forwards',
  });
  // Faded out: keep it that way for whatever renders while the palette grows and hands off.
  setTimeout(() => el.setAttribute(SURFACE_ONLY_ATTR, ''), CONTENT_FADE_MS);
  // What fills the page while it renders: the results page's outline, coming in as the palette
  // lands, so the grown palette is never a blank sheet.
  el.append(resultsSkeleton());
  const growth = el.animate(
    [frame(from, MODAL_RADIUS, shadow), frame(fullPageBox(), '0px', 'none')],
    { duration: MORPH_MS, easing: MORPH_EASE, fill: 'forwards' },
  );
  // A cancelled animation (the palette unmounted mid-way) still hands off.
  return growth.finished.then(
    () => undefined,
    () => undefined,
  );
}

// The results page in outline — its header, the filter row, a column of result rows, all plain
// blocks, with no stand-in search box — drawn outside React so it is up even while the page
// itself is still rendering. Only opacity animates (on the compositor), so it keeps moving
// through that work too.
function resultsSkeleton(): HTMLElement {
  const block = (style: Partial<CSSStyleDeclaration>): HTMLElement => {
    const div = document.createElement('div');
    Object.assign(div.style, { background: 'hsl(var(--muted))', borderRadius: '6px' }, style);
    return div;
  };
  const row = (...children: HTMLElement[]): HTMLElement => {
    const div = document.createElement('div');
    Object.assign(div.style, { display: 'flex', alignItems: 'center', gap: '12px' });
    div.append(...children);
    return div;
  };

  const root = document.createElement('div');
  root.setAttribute(SKELETON_ATTR, '');
  root.setAttribute('aria-hidden', 'true');
  Object.assign(root.style, {
    position: 'absolute',
    inset: '0',
    padding: '20px 24px',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    overflow: 'hidden',
    pointerEvents: 'none',
    opacity: '0',
  });

  root.append(
    row(
      block({ width: '20px', height: '20px' }),
      block({ width: '20px', height: '20px' }),
      block({ flex: '1', height: '46px', borderRadius: '10px' }),
    ),
    row(
      ...[86, 72, 60, 48, 48, 44, 74].map(width => block({ width: `${width}px`, height: '28px' })),
    ),
  );

  const list = document.createElement('div');
  Object.assign(list.style, { display: 'flex', flexDirection: 'column', gap: '10px' });
  list.append(block({ width: '90px', height: '12px', marginTop: '4px' }));
  for (let i = 0; i < 9; i++) {
    const card = document.createElement('div');
    Object.assign(card.style, {
      display: 'flex',
      gap: '12px',
      padding: '14px 16px',
      border: '1px solid hsl(var(--border))',
      borderRadius: '12px',
    });
    const lines = document.createElement('div');
    Object.assign(lines.style, { flex: '1', display: 'flex', flexDirection: 'column', gap: '8px' });
    lines.append(
      block({ width: `${120 + ((i * 37) % 80)}px`, height: '12px' }),
      block({ width: `${55 + ((i * 23) % 35)}%`, height: '12px' }),
    );
    card.append(
      block({ width: '32px', height: '32px', borderRadius: '8px', flexShrink: '0' }),
      lines,
    );
    list.append(card);
  }
  root.append(list);

  root.animate([{ opacity: 0 }, { opacity: 1 }], {
    duration: CONTENT_FADE_MS,
    delay: MORPH_MS - CONTENT_FADE_MS,
    easing: 'ease',
    fill: 'forwards',
  });
  // Finite, so it ends on its own once the palette has closed: it covers the longest hand-off (the
  // route and the page's search, each given up on after 3s).
  list.animate([{ opacity: 1 }, { opacity: 0.55 }, { opacity: 1 }], {
    duration: 1400,
    delay: MORPH_MS,
    iterations: 5,
    easing: 'ease-in-out',
  });
  return root;
}

// ─── Resuming a search ─────────────────────────────────────────────────────

// Set when Cmd+K reopens on the search the user just left (the quick return), read once by the
// palette as it starts the session: it keeps the cached response and searches without the typing
// debounce, so the results it had are back at once rather than re-fetched behind an empty list.
let resumingSearch = false;

export function resumeSearchOnOpen(): void {
  resumingSearch = true;
}

export function takeResumingSearch(): boolean {
  const resuming = resumingSearch;
  resumingSearch = false;
  return resuming;
}

// ─── Results page readiness ────────────────────────────────────────────────

// The results page renders a placeholder list before its search for the URL query settles; the
// grown palette waits for that search so it lifts onto the real results, not the placeholder.
const fullPageReady = createLatch(false);

/** An expand is about to hand off: readiness now refers to the page it is navigating to. */
export function expectFullPageReady(): void {
  fullPageReady.close();
}

/** The results page's search for its URL query has settled. */
export function markFullPageReady(): void {
  scheduleDrawPageUnderFullPage();
  fullPageReady.open();
}

/** Resolves once the results page is ready, or after `timeoutMs` so the palette never hangs. */
export function whenFullPageReady(timeoutMs: number): Promise<void> {
  // Handed off without the page's word that it is ready: the page underneath still has to be drawn
  // for a collapse.
  return fullPageReady.wait(timeoutMs, scheduleDrawPageUnderFullPage);
}

/**
 * Lift the grown palette off the results page once the route has rendered underneath it, so the
 * page it grew from never shows through between the two.
 */
export function fadeOutFullPage(el: HTMLElement): Promise<void> {
  if (prefersReducedMotion()) return Promise.resolve();
  return el
    .animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: CONTENT_FADE_MS,
      easing: 'ease',
      fill: 'forwards',
    })
    .finished.then(
      () => undefined,
      () => undefined,
    );
}

// How long a grown card waits for the results page's search before lifting anyway.
const GROWN_CARD_READY_TIMEOUT_MS = 3000;
// The card growing into full page for a Cmd+K that opens there, until it lifts.
let growingCard: HTMLElement | null = null;

/** A Cmd+K is already growing into full page. */
export const isGrowingToFullPage = (): boolean => growingCard !== null;

/**
 * Cmd+K with full page as the default: grows into it as the palette does when it expands — a
 * palette-sized card from where the palette opens out to full page, the results page's outline
 * coming in — then runs `navigate` under it, with what was typed while it grew, and lifts once the
 * page's search has settled.
 */
export function growCardToFullPage(navigate: (typed: string) => void): void {
  if (growingCard) return;
  window.dispatchEvent(new Event(PAGE_COVERING_EVENT));
  // Focus leaves the page being covered (often its composer), so full page's search box takes it.
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  const typing = holdTypingForFullPage();
  if (prefersReducedMotion()) {
    navigate(typing.take());
    announceFullPageOpened();
    return;
  }
  const from = modalBox();
  const card = document.createElement('div');
  Object.assign(card.style, {
    position: 'fixed',
    top: `${from.top}px`,
    left: `${from.left}px`,
    width: `${from.width}px`,
    height: `${from.height}px`,
    overflow: 'hidden',
    background: 'hsl(var(--card))',
    border: '1px solid hsl(var(--border))',
    borderRadius: MODAL_RADIUS,
    boxShadow: MODAL_SHADOW,
    // Where the palette sits; over the page until the results page is under it.
    zIndex: '9999',
  });
  card.append(resultsSkeleton());
  document.body.append(card);
  growingCard = card;
  card.animate([{ opacity: 0 }, { opacity: 1 }], { duration: CONTENT_FADE_MS, easing: 'ease' });
  const lift = (): void => {
    if (growingCard !== card) return;
    growingCard = null;
    void fadeOutFullPage(card).then(() => {
      card.remove();
      announceFullPageOpened();
    });
  };
  void card
    .animate([frame(from, MODAL_RADIUS, MODAL_SHADOW), frame(fullPageBox(), '0px', 'none')], {
      duration: MORPH_MS,
      easing: MORPH_EASE,
      fill: 'forwards',
    })
    .finished.then(
      () => undefined,
      () => undefined,
    )
    .then(() => {
      expectFullPageReady();
      navigate(typing.take());
      void whenFullPageReady(GROWN_CARD_READY_TIMEOUT_MS).then(() => requestAnimationFrame(lift));
    });
}

// How long after the route change typing is held for a query box that never takes focus.
const HOLD_TYPING_AFTER_ROUTE_MS = 2000;

/**
 * Typing after a Cmd+K that opens full page is meant for its query box, not whatever had focus
 * underneath (usually a composer), so it is held until that box has focus. `take` hands over what
 * was typed so far, for the query full page opens on; the rest goes into the box once it has focus.
 * Focus landing anywhere else stops the hold: keys go where they normally would. So does the box
 * not having focus HOLD_TYPING_AFTER_ROUTE_MS after the route change — what was held then goes
 * into the box, focused, if it is there (a slow hand-off), and is dropped only with no box at all.
 */
function holdTypingForFullPage(): { take: () => string } {
  let typed = '';
  // Backspaces past what was typed since the last take: they erase from the box.
  let erased = 0;
  let taken = false;
  let written = false;
  let giveUp = 0;
  const hold = (event: KeyboardEvent): void => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
    if (event.key.length === 1) typed += event.key;
    else if (event.key !== 'Backspace') return;
    else if (typed) typed = typed.slice(0, -1);
    else if (taken) erased += 1;
    event.preventDefault();
    event.stopPropagation();
  };
  const release = (): void => {
    window.removeEventListener('keydown', hold, true);
    document.removeEventListener('focusin', onFocus, true);
    clearTimeout(giveUp);
  };
  // Once: the box taking focus and the give-up can both reach here (focus landing late, past the
  // give-up, in a long render), and what was held goes in only once.
  const writeInto = (box: HTMLInputElement): void => {
    release();
    if (written) return;
    written = true;
    if (!typed && !erased) return;
    const next = box.value.slice(0, Math.max(0, box.value.length - erased)) + typed;
    // Through the native setter and an input event, so the page's own change handling runs.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(box, next);
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.setSelectionRange(next.length, next.length);
  };
  const onFocus = (event: FocusEvent): void => {
    const box = event.target;
    if (!(box instanceof HTMLInputElement) || box.id !== FULL_PAGE_QUERY_INPUT_ID) {
      release();
      return;
    }
    document.removeEventListener('focusin', onFocus, true);
    // The box takes focus as the page mounts, before the page has synced its search to the URL
    // query: written once that render is over, so the search follows the box. Keys stay held until
    // then, so they land in order.
    setTimeout(() => writeInto(box));
  };
  const giveUpHold = (): void => {
    const box = document.getElementById(FULL_PAGE_QUERY_INPUT_ID);
    if (!(box instanceof HTMLInputElement)) {
      release();
      return;
    }
    writeInto(box);
    const active = document.activeElement;
    if (!active || active === document.body) box.focus({ preventScroll: true });
  };
  window.addEventListener('keydown', hold, true);
  document.addEventListener('focusin', onFocus, true);
  return {
    // Trailing spaces stay held for the box: the query full page opens on is trimmed.
    take: (): string => {
      const text = typed.trimEnd();
      typed = typed.slice(text.length);
      taken = true;
      giveUp = window.setTimeout(giveUpHold, HOLD_TYPING_AFTER_ROUTE_MS);
      return text;
    },
  };
}

// ─── Hand-off from full page back to the palette ────────────────────────────

/**
 * Fired by the results page's collapse button with the page's current search. The app-level
 * palette listens, reopens seeded with that search, and shrinks from full page.
 */
export const COLLAPSE_TO_CMDK_EVENT = 'xyne:collapse-to-cmdk';

/**
 * A collapse has begun, in the frame full page's layer comes off the page underneath. Its detail is
 * the collapse's origin (`FullPageOrigin | null`, null where it stays on full page): the page it
 * lands on is on screen from here.
 */
export const COLLAPSE_STARTED_EVENT = 'xyne:collapse-started';

/** The palette closed mid-collapse while still on full page: full page is back over the page. */
export const COLLAPSE_ABANDONED_EVENT = 'xyne:collapse-abandoned';

/** Dispatched on window as the palette closes, however it closed. */
export const CMDK_CLOSED_EVENT = 'xyne:cmdk-closed';

/** Where the palette expanded from: its URL and its place in the history stack. */
export interface FullPageOrigin {
  href: string;
  /** React Router's `history.state.idx` of that entry, so collapsing can step back to it. */
  historyIndex: number | null;
}

export interface CollapseToCmdkDetail {
  /** The results page's `location.search`, i.e. the search as it stands, not as it launched. */
  search: string;
  /** How the session of the full page collapsing started: a Cmd+F one reopens as one. */
  openedFrom: CmdkOpenOrigin;
  /** Where to put the user back before the palette shrinks, or null to stay on the results page. */
  origin: FullPageOrigin | null;
  /**
   * How to get there, when it is not a plain navigation: a Back from the results page has already
   * moved the URL, and only needs its held popstate let through.
   */
  returnVia?: (() => void) | undefined;
}

// A collapse the palette's next open owes. Module state, not React state: it only has to cross one
// hand-off.
let pendingCollapse = false;

// Resolves once the collapsing palette is up and animating — the moment the collapse lets the page
// it returns to render underneath.
let collapseSettled: Promise<void> | null = null;
let settleCollapse: (() => void) | null = null;
function owedSettle(): void {
  collapseSettled = new Promise(resolve => {
    settleCollapse = resolve;
  });
}
// Settles once the palette's collapse animations have reached the compositor — two frames after
// they start. From there they run on their own, so the page underneath can render alongside them.
function settleCollapseSoon(): void {
  const settle = settleCollapse;
  settleCollapse = null;
  if (settle) requestAnimationFrame(() => requestAnimationFrame(() => settle()));
}

/** Resolves when the collapse in progress has settled, or after `timeoutMs` at the latest. */
export function whenCollapseSettled(timeoutMs: number): Promise<void> {
  const settled = collapseSettled;
  if (!settled) return Promise.resolve();
  return Promise.race([settled, new Promise<void>(resolve => setTimeout(resolve, timeoutMs))]).then(
    () => {
      if (collapseSettled === settled) collapseSettled = null;
    },
  );
}

// ─── Collapse stand-in ──────────────────────────────────────────────────────
// A DOM card shrinks on the compositor while the returning page renders; the palette mounts under
// it and takes over once it has landed, filled. With no page kept under full page, a cover instead.

interface CollapseStandIn {
  /** Null once the palette has taken the card over (see `landingCard`). */
  card: HTMLElement | null;
  cover: HTMLElement | null;
  /** The page under full page and the full-page layer lifted off it. */
  under: PageUnder | null;
  timer: ReturnType<typeof setTimeout>;
}
let standIn: CollapseStandIn | null = null;

// Never leave a stand-in up longer than this, whatever happens to the palette.
const STAND_IN_MAX_MS = 6000;

// Where the modal palette sits: measured as it grows (the shrink lands back there), or worked out
// from its classes — centred, md:max-w-3xl wide, md:h-[549px] tall, md:top-[14vh].
let lastModalBox: Box | null = null;
function modalBox(): Box {
  if (lastModalBox) return lastModalBox;
  const width = Math.min(768, window.innerWidth);
  return {
    top: window.innerHeight * 0.14,
    left: (window.innerWidth - width) / 2,
    width,
    height: Math.min(549, window.innerHeight),
  };
}

// The color the route area paints, for the cover: the first opaque background from the full-page
// target up.
function pageBackground(target: Element | null): string {
  for (let el = target; el; el = el.parentElement) {
    const color = getComputedStyle(el).backgroundColor;
    if (color && color !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(color)) return color;
  }
  return 'hsl(var(--background))';
}

interface PageUnder {
  kept: HTMLElement;
  layer: HTMLElement;
}

// The page under full page and the layer over it, when there is a page to show.
function pageUnderFullPage(target: Element | undefined): PageUnder | null {
  const kept = target?.querySelector<HTMLElement>(`:scope > [${KEPT_PAGE_ATTR}]`);
  const layer = target?.querySelector<HTMLElement>(`:scope > [${RESULTS_PAGE_ATTR}]`);
  if (!kept || !layer || kept.childElementCount === 0) return null;
  return { kept, layer };
}

// The page under full page skips rendering while full page opens, which keeps the expand light.
// Once full page has settled it is drawn again, under the layer, so a collapse only has to lift
// the layer off it — in the very frame it starts. Drawn after the expand's hand-off (the palette
// lifts 160ms after the page is ready), and as the pointer reaches the collapse button, so even a
// collapse right after landing finds it drawn.
const DRAW_UNDER_DELAY_MS = 400;

// The full-page target on screen (the route area full page fills).
const fullPageTarget = (): Element | undefined =>
  Array.from(document.querySelectorAll(`[${FULL_PAGE_TARGET_ATTR}]`)).find(
    el => el.getBoundingClientRect().width > 0,
  );

/** Draw the page under full page now, for a collapse. */
export function drawPageUnderFullPage(): void {
  if (!isFullPageSearchPath(window.location.pathname)) return;
  pageUnderFullPage(fullPageTarget())?.kept.setAttribute(KEPT_DRAWN_ATTR, '');
}

function scheduleDrawPageUnderFullPage(): void {
  setTimeout(() => {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(drawPageUnderFullPage, { timeout: 1000 });
    } else {
      drawPageUnderFullPage();
    }
  }, DRAW_UNDER_DELAY_MS);
}

// Opacity, not display, so nothing re-lays out — and not visibility, which rows that set their
// own `visibility: visible` would show through.
function liftLayer({ kept, layer }: PageUnder): void {
  kept.setAttribute(KEPT_DRAWN_ATTR, '');
  layer.style.opacity = '0';
  layer.style.pointerEvents = 'none';
}

function showLayer(under: PageUnder | null): void {
  under?.layer.style.removeProperty('opacity');
  under?.layer.style.removeProperty('pointer-events');
}

// The route change takes the layer away for good; a stand-in given up on while still on full page
// puts it back.
function restoreLayer(under: PageUnder | null): void {
  if (isFullPageSearchPath(window.location.pathname)) showLayer(under);
}

function removeStandIn(): void {
  if (!standIn) return;
  clearTimeout(standIn.timer);
  standIn.card?.remove();
  standIn.cover?.remove();
  restoreLayer(standIn.under);
  standIn = null;
}

// A stand-in still up long past any collapse: gone, and with the route still on full page, full
// page is back over the page — covered again, as when a collapse is abandoned. A Back held for it
// has moved only the URL: it steps forward again, so the URL is full page's, as the screen is.
function standInTimedOut(): void {
  const onFullPage = heldBack || isFullPageSearchPath(window.location.pathname);
  if (heldBack) {
    heldBack = false;
    window.history.forward();
  }
  removeStandIn();
  if (onFullPage) window.dispatchEvent(new Event(COLLAPSE_ABANDONED_EVENT));
}

/**
 * Whether a collapse to `origin` lands on the page kept under full page (`kept`, its wrapper). Not
 * always: a result opened from full page becomes that page, and a Back from it and then from full
 * page goes on to the palette's entry, where it expanded from.
 */
export function collapseLandsOnKeptPage(
  kept: Element | null | undefined,
  origin: FullPageOrigin | null,
): boolean {
  const keptPath = kept?.getAttribute(KEPT_PATH_ATTR);
  if (!origin || !keptPath) return false;
  return new URL(origin.href, window.location.origin).pathname === keptPath;
}

/**
 * Put the stand-in up. `then` runs once the page underneath is on screen too — or straight away
 * with no stand-in — and is where the palette's own (heavy) render may start.
 */
function startCollapseStandIn(origin: FullPageOrigin | null, then: () => void): void {
  removeStandIn();
  const started = (): void => {
    window.dispatchEvent(
      new CustomEvent<FullPageOrigin | null>(COLLAPSE_STARTED_EVENT, { detail: origin }),
    );
  };
  if (prefersReducedMotion()) {
    started();
    then();
    return;
  }
  const target = fullPageTarget();
  const from = fullPageBox();
  const to = modalBox();
  const place = (el: HTMLElement, box: Box): void => {
    Object.assign(el.style, {
      position: 'fixed',
      top: `${box.top}px`,
      left: `${box.left}px`,
      width: `${box.width}px`,
      height: `${box.height}px`,
      zIndex: '9998',
      pointerEvents: 'none',
    });
  };
  // The layer comes off only over the page the collapse returns to; another page stays hidden
  // under a cover, as with no page kept.
  const page = pageUnderFullPage(target);
  const under = page && collapseLandsOnKeptPage(page.kept, origin) ? page : null;
  let cover: HTMLElement | null = null;
  if (!under) {
    cover = document.createElement('div');
    place(cover, from);
    cover.style.background = pageBackground(target ?? null);
    cover.style.borderRadius = target ? getComputedStyle(target).borderRadius : '0px';
    document.body.append(cover);
  }
  const card = document.createElement('div');
  place(card, to);
  Object.assign(card.style, {
    background: 'hsl(var(--card))',
    border: '1px solid hsl(var(--border))',
    borderRadius: MODAL_RADIUS,
    boxShadow: MODAL_SHADOW,
    transformOrigin: '0 0',
    // Over the palette (z-[9999]), which mounts under it at rest and waits there to take over.
    zIndex: '10000',
  });
  document.body.append(card);
  // Transform-only so it runs on the compositor; corners and shadow follow on the main thread.
  card.animate(
    [
      {
        transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${
          from.width / to.width
        }, ${from.height / to.height})`,
      },
      { transform: 'none' },
    ],
    { duration: MORPH_MS, easing: MORPH_EASE, fill: 'forwards' },
  );
  card.animate(
    [
      { borderRadius: '0px', boxShadow: 'none' },
      { borderRadius: MODAL_RADIUS, boxShadow: MODAL_SHADOW },
    ],
    { duration: MORPH_MS, easing: MORPH_EASE, fill: 'forwards' },
  );
  // The layer comes off in the card's first frame, so the card shrinks over the page underneath —
  // uncovered in that same frame (see COLLAPSE_STARTED_EVENT).
  if (under) liftLayer(under);
  started();
  standIn = { card, cover, under, timer: setTimeout(standInTimedOut, STAND_IN_MAX_MS) };
  // Two frames to paint the stand-in before the palette's render takes the main thread.
  requestAnimationFrame(() => requestAnimationFrame(then));
}

/**
 * The page the palette collapsed back to is on screen: lift the cover off it. Not while the
 * palette has yet to mount and take the stand-in's place — it lifts the cover itself then.
 */
export function revealCollapseOrigin(): void {
  if (pendingCollapse) return;
  liftStandIn();
}

/** The palette closed before a collapse finished: drop whatever of it is left. */
export function abandonCollapse(): void {
  // Still on full page as the router sees it: a Back held for the collapse has moved only the URL.
  const onFullPage = heldBack || isFullPageSearchPath(window.location.pathname);
  if (heldBack) {
    // The URL is on the palette's entry, which the router never saw: step forward again, so the URL
    // is full page's, as the screen is.
    heldBack = false;
    window.history.forward();
  }
  if (onFullPage) window.dispatchEvent(new Event(COLLAPSE_ABANDONED_EVENT));
  pendingCollapse = false;
  landingCard?.remove();
  landingCard = null;
  settleCollapseSoon();
  liftStandIn();
  // Full page comes back over the page: whatever is left of the stand-in, and also when there is
  // none left — a return still on its way when the palette took over lifted it and left the layer
  // off for the route change that never came.
  if (onFullPage) showLayer(pageUnderFullPage(fullPageTarget()));
}

// The layer stays off for the route change to take away; abandonCollapse puts it back.
function liftStandIn(): void {
  const current = standIn;
  if (!current) return;
  standIn = null;
  clearTimeout(current.timer);
  current.card?.remove();
  const { cover } = current;
  if (!cover) return;
  void cover
    .animate([{ opacity: 1 }, { opacity: 0 }], { duration: CONTENT_FADE_MS, easing: 'ease' })
    .finished.then(
      () => cover.remove(),
      () => cover.remove(),
    );
}

export function collapseToCmdk(
  search: string,
  origin: FullPageOrigin | null,
  returnVia?: () => void,
): void {
  pendingCollapse = true;
  collapseContentReady.close();
  owedSettle();
  // The full page's history entry as the router last rendered it: a Back has already moved the URL
  // on, but not the router.
  const openedFrom = fullPageSessionAt(fullPageEntryKey);
  startCollapseStandIn(origin, () => {
    window.dispatchEvent(
      new CustomEvent<CollapseToCmdkDetail>(COLLAPSE_TO_CMDK_EVENT, {
        detail: { search, openedFrom, origin, returnVia },
      }),
    );
  });
}

// Hold a Back onto the palette's entry until the collapse lands, then replay it to the router.
let replayingPopState = false;
// A Back is held: the URL has moved on, the router has not.
let heldBack = false;
// The results page that is up, if any: hands over its search as it stands, for the palette.
let fullPageWatcher: { currentSearch: () => string } | null = null;

function replayPopState(): void {
  heldBack = false;
  replayingPopState = true;
  try {
    window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state as unknown }));
  } finally {
    replayingPopState = false;
  }
}

function onPopState(event: PopStateEvent): void {
  if (!fullPageWatcher || replayingPopState || standIn || prefersReducedMotion()) return;
  if (isFullPageSearchPath(window.location.pathname)) return;
  const usr = (event.state as { usr?: Record<string, unknown> } | null)?.usr;
  if (usr?.[OVERLAY_STATE_KEY] !== 'command-menu') return;
  event.stopImmediatePropagation();
  heldBack = true;
  const { pathname, search, hash } = window.location;
  collapseToCmdk(
    fullPageWatcher.currentSearch(),
    { href: `${pathname}${search}${hash}`, historyIndex: null },
    replayPopState,
  );
}

/**
 * The results page is up: a Back from it onto the palette's entry collapses into the palette.
 * `currentSearch` gives the page's search as it stands. Returns the cleanup.
 */
export function watchBackFromFullPage(currentSearch: () => string): () => void {
  const watcher = { currentSearch };
  fullPageWatcher = watcher;
  return (): void => {
    if (fullPageWatcher === watcher) fullPageWatcher = null;
  };
}

// In the capture phase, so it gets the event before the router's listener (added for the bubble
// phase), which renders the navigation — unmounting the results page — wherever it was added.
window.addEventListener('popstate', onPopState, { capture: true });
// A hot reload evaluates this module again; its old listener must not hold events too.
import.meta.hot?.dispose(() =>
  window.removeEventListener('popstate', onPopState, { capture: true }),
);

// The palette's content is ready to be seen after a collapse: it shows the search it carries over,
// settled. Until then the card stays over it, so the palette never shows empty first and fills in
// after.
const collapseContentReady = createLatch(true);
// How long a collapse waits past the card's landing for the palette's search before showing it
// anyway — the search is served from the hand-off cache, so it rarely takes any of it.
const CONTENT_READY_TIMEOUT_MS = 300;

/** The collapsing palette shows the search it carries, settled. */
export function markCollapseContentReady(): void {
  collapseContentReady.open();
}

// The card a mounted palette is taking over from, until it lets the card go.
let landingCard: HTMLElement | null = null;

/**
 * Play the collapse this open is owed, if any. With a stand-in up, the palette has mounted at rest
 * under the card: once the card has landed and the palette's content is ready, the card goes and
 * the content fades in — one shrink, one palette. `stillReturning` says whether the page it returns
 * to is still on its way; if not, the cover lifts now.
 */
export function playPendingCollapse(el: HTMLElement, stillReturning: boolean): void {
  const pending = pendingCollapse;
  pendingCollapse = false;
  if (!pending || prefersReducedMotion()) {
    settleCollapseSoon();
    if (!stillReturning) liftStandIn();
    return;
  }
  const card = standIn?.card;
  if (standIn && card) {
    standIn.card = null;
    landingCard = card;
    el.setAttribute(SURFACE_ONLY_ATTR, '');
    const landed = Promise.all(
      card.getAnimations().map(animation =>
        animation.finished.then(
          () => undefined,
          () => undefined,
        ),
      ),
    );
    void landed
      .then(() => collapseContentReady.wait(CONTENT_READY_TIMEOUT_MS))
      .then(() => {
        // Abandoned (the palette closed), or another collapse has begun.
        if (landingCard !== card) return;
        landingCard = null;
        el.removeAttribute(SURFACE_ONLY_ATTR);
        fadeChildren(el, [{ opacity: 0 }, { opacity: 1 }], {
          duration: CONTENT_FADE_MS,
          easing: 'ease',
        });
        // The palette's surface is the card's, in the same place: dropping the card is seamless.
        card.remove();
        settleCollapseSoon();
      });
  } else {
    settleCollapseSoon();
  }
  if (!stillReturning) liftStandIn();
}

// Where the palette was opened before expanding, so collapsing puts the user back there rather
// than leaving the modal over the results page. Session-scoped: it only means anything within
// the tab that expanded.
const ORIGIN_KEY = 'xyne:cmdk-full-page-origin';

const currentHistoryIndex = (): number | null => {
  const index = (window.history.state as { idx?: unknown } | null)?.idx;
  return typeof index === 'number' ? index : null;
};

const isFullPageHref = (href: string): boolean =>
  isFullPageSearchPath(new URL(href, window.location.origin).pathname);

// The last page the user was on outside full page, kept app-wide. A collapse with no recorded
// origin — the results page reached by Forward, a reload, a link — goes back there instead of
// leaving the palette over the results.
let lastPageOutsideFullPage: FullPageOrigin | null = null;

/**
 * Called on every route change: remembers where to collapse back to. A page outside full page
 * after the expand (a result opened from it) is the page full page covers from then on, so the
 * origin saved on expand no longer is: a collapse goes back to that page instead.
 */
export function noteLocation(href: string): void {
  if (isFullPageHref(href)) return;
  lastPageOutsideFullPage = { href, historyIndex: currentHistoryIndex() };
  takeSessionItem(ORIGIN_KEY);
}

// How each full page's session started, by its history entry — React Router's `key` for it, which
// Back/Forward and a reload keep and no other entry has (its `idx` starts again at 0 with every
// document load, so another load's entries would share theirs) — so a collapse from it reopens the
// palette as that: a Cmd+F one stays one. Session-scoped, like the entries themselves; the latest
// ones are kept.
const FULL_PAGE_SESSIONS_KEY = 'xyne:cmdk-full-page-sessions';
const MAX_FULL_PAGE_SESSIONS = 200;
// This document load. An entry's `idx` is its slot in one load's history, so only the slots of the
// same load are compared.
const DOCUMENT_LOAD = Math.random().toString(36).slice(2);

/** An entry's session: its key, how it started, and the load and slot it was written in. */
type FullPageSession = [key: string, session: unknown, load?: unknown, slot?: unknown];
let openingFullPageFrom: CmdkOpenOrigin | null = null;
// The history entry full page is at, as the router last rendered it: the one a Back leaves.
let fullPageEntryKey: string | null = null;

// The entries' sessions, oldest first.
function readFullPageSessions(): FullPageSession[] {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(FULL_PAGE_SESSIONS_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed)
      ? parsed.filter(
          (entry): entry is FullPageSession => Array.isArray(entry) && typeof entry[0] === 'string',
        )
      : [];
  } catch {
    return [];
  }
}

/**
 * The route is on full page, at the history entry `entryKey` (the router's location key), which it
 * may not have been on before. Opened anew from another page (`fromFullPage` false), the entry
 * starts a session; one pushed on full page itself (a palette opened over it, a search in it), or
 * replacing the entry it was on (the results page's own URL rewrites), carries on the session of
 * the entry it came from. Back and Forward land on an entry that has its own already. The entries
 * that have left history lose theirs: after a push, those from its slot on; after a replace, the one
 * it took the place of — those after it are still there for Forward.
 */
export function noteFullPageEntry(
  navigation: NavigationType,
  fromFullPage: boolean,
  entryKey: string,
): void {
  const openedFrom = openingFullPageFrom ?? 'search';
  openingFullPageFrom = null;
  const cameFrom = fullPageEntryKey;
  // A document's first entry has no key of its own: no session is kept for it.
  const key = entryKey === 'default' ? null : entryKey;
  fullPageEntryKey = key;
  if (navigation === NavigationType.Pop || key === null) return;
  const session = fromFullPage ? fullPageSessionAt(cameFrom) : openedFrom;
  // The entry's slot, read while history is still on it, against this load's entries: a push has
  // dropped those from its slot on, a replace only the one in its slot — however many navigations
  // React rendered as this one. Unknown, nothing is dropped.
  const state = window.history.state as { key?: unknown; idx?: unknown } | null;
  const slot = state?.key === key && typeof state.idx === 'number' ? state.idx : null;
  const left = (entrySlot: unknown): boolean =>
    slot !== null &&
    typeof entrySlot === 'number' &&
    (navigation === NavigationType.Push ? entrySlot >= slot : entrySlot === slot);
  const sessions = readFullPageSessions().filter(
    ([at, , load, entrySlot]) => at !== key && !(load === DOCUMENT_LOAD && left(entrySlot)),
  );
  sessions.push([key, session, DOCUMENT_LOAD, slot]);
  try {
    sessionStorage.setItem(
      FULL_PAGE_SESSIONS_KEY,
      JSON.stringify(sessions.slice(-MAX_FULL_PAGE_SESSIONS)),
    );
  } catch {
    // Storage blocked: collapses reopen the palette as Cmd+K.
  }
}

/** How the session of the full page at the history entry `key` started. */
function fullPageSessionAt(key: string | null): CmdkOpenOrigin {
  if (key === null) return 'search';
  const session = readFullPageSessions().find(([at]) => at === key)?.[1];
  return session === 'findInChannel' ? 'findInChannel' : 'search';
}

// Read a session-storage item once: it is removed as it is read. Null when absent or unreadable.
function takeSessionItem(key: string): string | null {
  try {
    const value = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    return value;
  } catch {
    return null;
  }
}

// A saved origin, read back; null when absent or unreadable.
function readOrigin(raw: string | null): FullPageOrigin | null {
  try {
    const parsed = raw ? (JSON.parse(raw) as Partial<FullPageOrigin>) : null;
    if (!parsed || typeof parsed.href !== 'string') return null;
    return {
      href: parsed.href,
      historyIndex: typeof parsed.historyIndex === 'number' ? parsed.historyIndex : null,
    };
  } catch {
    return null;
  }
}

/** Full page is opening from a palette session that started as `openedFrom`, at `href`. */
export function saveFullPageOrigin(href: string, openedFrom: CmdkOpenOrigin = 'search'): void {
  openingFullPageFrom = openedFrom;
  const origin: FullPageOrigin = { href, historyIndex: currentHistoryIndex() };
  try {
    sessionStorage.setItem(ORIGIN_KEY, JSON.stringify(origin));
  } catch {
    // Storage blocked: collapsing just stays on the results page.
  }
}

/**
 * Where to collapse back to: the origin saved on expand (read and forgotten — it is good for one
 * collapse), else the last page outside full page, else null.
 */
export function takeFullPageOrigin(): FullPageOrigin | null {
  const saved = readOrigin(takeSessionItem(ORIGIN_KEY));
  // An origin that is itself a results page would only swap stale results in underneath.
  if (saved && !isFullPageHref(saved.href)) return saved;
  return lastPageOutsideFullPage;
}

/**
 * Cmd+K or Cmd+F on the results page: the page has its own search box, so rather than open the
 * palette over it, they send the caret there, after the query.
 */
export const FOCUS_FULL_PAGE_SEARCH_EVENT = 'xyne:focus-full-page-search';

/**
 * Asks the results page to take the keystroke into its search box. True when it did — false
 * off the results page, or where it doesn't listen (mobile), and the palette opens as usual.
 */
export function focusFullPageSearch(): boolean {
  if (!isFullPageSearchPath(window.location.pathname)) return false;
  return !window.dispatchEvent(new Event(FOCUS_FULL_PAGE_SEARCH_EVENT, { cancelable: true }));
}

// The "Search now opens in full page" snackbar is owed on the results page the palette sends the
// user to, which mounts after the navigation — so the debt crosses it in session storage.
const ANNOUNCE_KEY = 'xyne:cmdk-announce-full-page';

export function owedFullPageAnnouncement(): void {
  try {
    sessionStorage.setItem(ANNOUNCE_KEY, '1');
  } catch {
    // Storage blocked: the switch just goes unannounced.
  }
}

/** Read and clear the pending announcement — it is shown once. */
export function takeFullPageAnnouncement(): boolean {
  return takeSessionItem(ANNOUNCE_KEY) === '1';
}

// ─── Policy + metrics ───────────────────────────────────────────────────────

interface SessionIds {
  workspaceId: string;
  userId: string;
  searchSessionId: string | null;
}

/**
 * The palette expanded to full page. Only the app-level palette on desktop teaches the open-size
 * policy (`teachesPolicy`); every palette's expand is counted.
 */
export function recordExpandToFullPage(
  { workspaceId, userId, searchSessionId }: SessionIds,
  source: SearchFullPageOpenEvent['source'],
  teachesPolicy: boolean,
): void {
  if (teachesPolicy) {
    saveCmdkPolicy(workspaceId, userId, onExpandToFull(loadCmdkPolicy(workspaceId, userId)));
  }
  try {
    searchMetricsService.trackFullPageOpen({
      searchSessionId: searchSessionId ?? '',
      userId,
      source,
    });
  } catch {
    // Metrics must never block the expand.
  }
}

/** Cmd+K opened straight into full page because that is the learned default. */
export function recordDefaultFullPageOpen(userId: string): void {
  try {
    searchMetricsService.trackFullPageOpen({ searchSessionId: '', userId, source: 'default' });
  } catch {
    // Metrics must never block the open.
  }
}

export function recordCollapseToModal({ workspaceId, userId, searchSessionId }: SessionIds): void {
  const policy = loadCmdkPolicy(workspaceId, userId);
  saveCmdkPolicy(workspaceId, userId, onCollapseToModal(policy));
  // Only a learned full-page default being undone is a preference switch.
  if (policy.preferredSize !== 'full') return;
  try {
    searchMetricsService.trackSizePreferenceSwitch({
      searchSessionId: searchSessionId ?? '',
      userId,
      to: 'modal',
      reason: 'collapse',
    });
  } catch {
    // Metrics must never block the collapse.
  }
}

/**
 * A Cmd+K session ended. Enough sessions ending in full page switch the default to full page;
 * that switch is logged here, the one place it happens.
 */
export function recordSessionEnd(
  { workspaceId, userId, searchSessionId }: SessionIds,
  endedIn: CmdkSize,
  origin: CmdkOpenOrigin,
  options: CmdkPolicyOptions,
): void {
  const before = loadCmdkPolicy(workspaceId, userId);
  const after = onSessionEnd(before, endedIn, origin, options);
  saveCmdkPolicy(workspaceId, userId, after);
  if (before.preferredSize === after.preferredSize) return;
  try {
    searchMetricsService.trackSizePreferenceSwitch({
      searchSessionId: searchSessionId ?? '',
      userId,
      to: after.preferredSize,
      reason: 'streak',
    });
  } catch {
    // Metrics must never break the palette.
  }
}

/** A search result was opened from the palette: remember its query for a quick return. */
export function recordResultOpened(
  { workspaceId, userId }: Omit<SessionIds, 'searchSessionId'>,
  query: CmdkReturnQuery,
): void {
  saveCmdkPolicy(
    workspaceId,
    userId,
    onResultOpened(loadCmdkPolicy(workspaceId, userId), Date.now(), query),
  );
}

/** The return banner was shown, clicked or dismissed. A show counts toward the max shows. */
export function recordReturnBanner(
  { workspaceId, userId, searchSessionId }: SessionIds,
  action: SearchReturnBannerEvent['action'],
  options: CmdkPolicyOptions,
): void {
  if (action === 'shown') {
    saveCmdkPolicy(
      workspaceId,
      userId,
      onBannerShown(loadCmdkPolicy(workspaceId, userId), options),
    );
  }
  try {
    searchMetricsService.trackReturnBanner({
      searchSessionId: searchSessionId ?? '',
      userId,
      action,
    });
  } catch {
    // Metrics must never break the banner.
  }
}

/** The "now opens in full page" snackbar was shown, undone or dismissed. */
export function recordFullPageSnackbar(
  userId: string,
  action: SearchFullPageSnackbarEvent['action'],
): void {
  try {
    searchMetricsService.trackFullPageSnackbar({ searchSessionId: '', userId, action });
  } catch {
    // Metrics must never break the snackbar.
  }
}

/** The snackbar's Undo: the learned full-page default goes back to the modal. */
export function recordUndoFullPageDefault({
  workspaceId,
  userId,
}: Omit<SessionIds, 'searchSessionId'>): void {
  saveCmdkPolicy(workspaceId, userId, onCollapseToModal(loadCmdkPolicy(workspaceId, userId)));
  try {
    searchMetricsService.trackSizePreferenceSwitch({
      searchSessionId: '',
      userId,
      to: 'modal',
      reason: 'undo',
    });
  } catch {
    // Metrics must never block the undo.
  }
  recordFullPageSnackbar(userId, 'undo');
}

// ─── Queries as results-page URLs ───────────────────────────────────────────

interface PaletteQuery {
  text: string;
  filterChips: ReadonlyArray<{ id: string; type: string; prefix?: string; name?: string }>;
  tab: TabType;
  toggles: { onlyMyChannels: boolean; includeBotMessages: boolean };
}

/**
 * A search as results-page params — its text, results tab and chips, and the palette's scope
 * toggles — through the filter registry the page reads them back with, so the two directions can't
 * drift. All is the page's default, which it leaves out of its URL: written here, the page would
 * strip it again straight away, a second URL change for nothing. Returns the filters too, for the
 * palette's label.
 */
export function searchToResultsParams(search: {
  text: string;
  chips: readonly ResultsMention[];
  docType: SearchResultsFilters['docType'] | undefined;
  toggles: { onlyMyChannels: boolean; includeBotMessages: boolean };
}): { params: URLSearchParams; filters: SearchResultsFilters } {
  const params = new URLSearchParams();
  if (search.text.trim()) params.set('query', search.text.trim());
  if (search.docType && search.docType !== 'all') params.set('tab', search.docType);
  const filters: SearchResultsFilters = {
    ...DEFAULT_SEARCH_FILTERS,
    ...filtersFromChips(search.chips as ResultsMention[]),
    ...search.toggles,
  };
  writeFiltersToParams(filters, params);
  return { params, filters };
}

/** A palette query (a remembered return or a recent search) as results-page params. */
export function resultsParamsForQuery(query: PaletteQuery): URLSearchParams {
  return searchToResultsParams({
    text: query.text,
    chips: query.filterChips as ResultsMention[],
    docType: TAB_TO_DOC_TYPE[query.tab as keyof typeof TAB_TO_DOC_TYPE],
    toggles: query.toggles,
  }).params;
}
