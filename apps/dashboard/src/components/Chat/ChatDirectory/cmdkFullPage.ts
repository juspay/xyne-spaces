// Cmd+K <-> /search-results: the grow morph, the collapse stand-in, and the Back hold.
import { searchMetricsService } from '../../../services/searchMetricsService';
import { DEFAULT_SEARCH_FILTERS } from '../../../hooks/useSearchResultsScreen';
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

/**
 * On the page under full page once it is drawn again: lifts the render-skipping full page puts on
 * it while it opens (global.css).
 */
export const KEPT_DRAWN_ATTR = 'data-cmdk-drawn';

/** Inside the full-page target: the results page itself. */
export const RESULTS_PAGE_ATTR = 'data-cmdk-results-page';

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

const prefersReducedMotion = (): boolean =>
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

/**
 * Grow the palette from where it sits to full page. Resolves once it covers the route area, so
 * the caller can hand off to the route; the element keeps its final frame until it unmounts.
 */
export function growToFullPage(el: HTMLElement): Promise<void> {
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
  const query = el.querySelector('[contenteditable="true"]')?.textContent?.trim() ?? '';
  el.append(resultsSkeleton(query));
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

// The results page in outline — its header with the query, the filter row, a column of result
// rows — drawn outside React so it is up even while the page itself is still rendering. Only
// opacity animates (on the compositor), so it keeps moving through that work too.
function resultsSkeleton(query: string): HTMLElement {
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

  const searchBox = document.createElement('div');
  Object.assign(searchBox.style, {
    flex: '1',
    height: '46px',
    border: '1px solid hsl(var(--border))',
    borderRadius: '10px',
    display: 'flex',
    alignItems: 'center',
    padding: '0 16px',
    font: '400 15px/1 inherit',
    color: 'hsl(var(--foreground))',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
  });
  searchBox.textContent = query;
  root.append(
    row(
      block({ width: '20px', height: '20px' }),
      block({ width: '20px', height: '20px' }),
      searchBox,
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
let fullPageReady = false;
let readyWaiters: Array<() => void> = [];

/** An expand is about to hand off: readiness now refers to the page it is navigating to. */
export function expectFullPageReady(): void {
  fullPageReady = false;
}

/** The results page's search for its URL query has settled. */
export function markFullPageReady(): void {
  scheduleDrawPageUnderFullPage();
  fullPageReady = true;
  readyWaiters.splice(0).forEach(resolve => resolve());
}

/** Resolves once the results page is ready, or after `timeoutMs` so the palette never hangs. */
export function whenFullPageReady(timeoutMs: number): Promise<void> {
  if (fullPageReady) return Promise.resolve();
  return new Promise(resolve => {
    const done = (): void => {
      clearTimeout(timer);
      readyWaiters = readyWaiters.filter(waiter => waiter !== done);
      resolve();
    };
    const timer = setTimeout(() => {
      // Handed off without the page's word that it is ready: the page underneath still has to be
      // drawn for a collapse.
      scheduleDrawPageUnderFullPage();
      done();
    }, timeoutMs);
    readyWaiters.push(done);
  });
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

/** Shrink the palette from full page down to where it naturally sits, fading its content in. */
function shrinkFromFullPage(el: HTMLElement, from: Box): void {
  if (prefersReducedMotion()) return;
  const to = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  // The palette's own centring transform, resolved to pixels (a plain translate).
  const base = style.transform === 'none' ? new DOMMatrix() : new DOMMatrix(style.transform);
  // Where its layout box sits before that transform moves it.
  const originLeft = to.left - base.e;
  const originTop = to.top - base.f;
  // Transform-only so it runs on the compositor; corners and shadow follow on the main thread. No
  // fill: once it lands, the palette's own classes take over again.
  el.animate(
    [
      {
        transformOrigin: '0 0',
        transform: `translate(${from.left - originLeft}px, ${from.top - originTop}px) scale(${
          from.width / to.width
        }, ${from.height / to.height})`,
      },
      { transformOrigin: '0 0', transform: `translate(${base.e}px, ${base.f}px) scale(1, 1)` },
    ],
    { duration: MORPH_MS, easing: MORPH_EASE },
  );
  el.animate(
    [
      { borderRadius: '0px', boxShadow: 'none' },
      { borderRadius: MODAL_RADIUS, boxShadow: style.boxShadow },
    ],
    { duration: MORPH_MS, easing: MORPH_EASE },
  );
  // The content fades in over the last stretch, also on the compositor (opacity, a delay rather
  // than a timer), so it arrives on time even while the page underneath renders.
  fadeChildren(el, [{ opacity: 0 }, { opacity: 1 }], {
    duration: CONTENT_FADE_MS,
    delay: MORPH_MS - CONTENT_FADE_MS,
    easing: 'ease',
    fill: 'backwards',
  });
}

// ─── Hand-off from full page back to the palette ────────────────────────────

/**
 * Fired by the results page's collapse button with the page's current search. The app-level
 * palette listens, reopens seeded with that search, and shrinks from full page.
 */
export const COLLAPSE_TO_CMDK_EVENT = 'xyne:collapse-to-cmdk';

/** Where the palette expanded from: its URL and its place in the history stack. */
export interface FullPageOrigin {
  href: string;
  /** React Router's `history.state.idx` of that entry, so collapsing can step back to it. */
  historyIndex: number | null;
}

export interface CollapseToCmdkDetail {
  /** The results page's `location.search`, i.e. the search as it stands, not as it launched. */
  search: string;
  /** Where to put the user back before the palette shrinks, or null to stay on the results page. */
  origin: FullPageOrigin | null;
  /**
   * How to get there, when it is not a plain navigation: a Back from the results page has already
   * moved the URL, and only needs its held popstate let through.
   */
  returnVia?: (() => void) | undefined;
}

// A collapse the palette's next open owes: the box it shrinks from. Module state, not React state:
// it only has to cross one hand-off.
let pendingCollapse: { from: Box } | null = null;

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

/** Draw the page under full page now, for a collapse. */
export function drawPageUnderFullPage(): void {
  if (!isFullPageSearchPath(window.location.pathname)) return;
  const target = Array.from(document.querySelectorAll(`[${FULL_PAGE_TARGET_ATTR}]`)).find(
    el => el.getBoundingClientRect().width > 0,
  );
  pageUnderFullPage(target)?.kept.setAttribute(KEPT_DRAWN_ATTR, '');
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

// The route change takes the layer away for good; a collapse abandoned before it left full page
// puts it back.
function restoreLayer(under: PageUnder | null): void {
  if (!under || !isFullPageSearchPath(window.location.pathname)) return;
  under.layer.style.removeProperty('opacity');
  under.layer.style.removeProperty('pointer-events');
}

function removeStandIn(): void {
  if (!standIn) return;
  clearTimeout(standIn.timer);
  standIn.card?.remove();
  standIn.cover?.remove();
  restoreLayer(standIn.under);
  standIn = null;
}

/**
 * Put the stand-in up. `then` runs once the page underneath is on screen too — or straight away
 * with no stand-in — and is where the palette's own (heavy) render may start.
 */
function startCollapseStandIn(then: () => void): void {
  removeStandIn();
  if (prefersReducedMotion()) {
    then();
    return;
  }
  const target = Array.from(document.querySelectorAll(`[${FULL_PAGE_TARGET_ATTR}]`)).find(
    el => el.getBoundingClientRect().width > 0,
  );
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
  const under = pageUnderFullPage(target);
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
  // Split as in shrinkFromFullPage.
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
  // The layer comes off in the card's first frame, so the card shrinks over the page underneath.
  if (under) liftLayer(under);
  standIn = { card, cover, under, timer: setTimeout(removeStandIn, STAND_IN_MAX_MS) };
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
  pendingCollapse = null;
  landingCard?.remove();
  landingCard = null;
  settleCollapseSoon();
  liftStandIn(true);
}

// `abandoned`: the collapse stopped short, so the full-page layer comes back. Otherwise it stays
// hidden for the route change to take away.
function liftStandIn(abandoned = false): void {
  const current = standIn;
  if (!current) return;
  standIn = null;
  clearTimeout(current.timer);
  current.card?.remove();
  if (abandoned) restoreLayer(current.under);
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
  pendingCollapse = { from: fullPageBox() };
  collapseContentReady = false;
  owedSettle();
  startCollapseStandIn(() => {
    window.dispatchEvent(
      new CustomEvent<CollapseToCmdkDetail>(COLLAPSE_TO_CMDK_EVENT, {
        detail: { search, origin, returnVia },
      }),
    );
  });
}

/**
 * Back from full page to the palette's entry: the palette reopening there collapses too, over the
 * page that is already on screen.
 */
export function armCollapseFromFullPage(): void {
  pendingCollapse = { from: fullPageBox() };
}

// Hold a Back onto the palette's entry until the collapse lands, then replay it to the router.
let replayingPopState = false;
// The results page that is up, if any: hands over its search as it stands, for the palette.
let fullPageWatcher: { currentSearch: () => string } | null = null;

function replayPopState(): void {
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
  const marker = (event.state as { usr?: { xyneOverlay?: unknown } } | null)?.usr?.xyneOverlay;
  if (marker !== 'command-menu') return;
  event.stopImmediatePropagation();
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
let collapseContentReady = true;
let contentWaiters: Array<() => void> = [];
// How long a collapse waits past the card's landing for the palette's search before showing it
// anyway — the search is served from the hand-off cache, so it rarely takes any of it.
const CONTENT_READY_TIMEOUT_MS = 300;

/** The collapsing palette shows the search it carries, settled. */
export function markCollapseContentReady(): void {
  collapseContentReady = true;
  contentWaiters.splice(0).forEach(resolve => resolve());
}

function whenCollapseContentReady(timeoutMs: number): Promise<void> {
  if (collapseContentReady) return Promise.resolve();
  return new Promise(resolve => {
    const done = (): void => {
      clearTimeout(timer);
      contentWaiters = contentWaiters.filter(waiter => waiter !== done);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    contentWaiters.push(done);
  });
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
  pendingCollapse = null;
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
      .then(() => whenCollapseContentReady(CONTENT_READY_TIMEOUT_MS))
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
    shrinkFromFullPage(el, pending.from);
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

/** Called on every route change: remembers where to collapse back to. */
export function noteLocation(href: string): void {
  if (!isFullPageHref(href))
    lastPageOutsideFullPage = { href, historyIndex: currentHistoryIndex() };
}

export function saveFullPageOrigin(href: string): void {
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
  let saved: FullPageOrigin | null = null;
  try {
    const raw = sessionStorage.getItem(ORIGIN_KEY);
    sessionStorage.removeItem(ORIGIN_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<FullPageOrigin>) : null;
    if (parsed && typeof parsed.href === 'string') {
      saved = {
        href: parsed.href,
        historyIndex: typeof parsed.historyIndex === 'number' ? parsed.historyIndex : null,
      };
    }
  } catch {
    // Unreadable: fall back below.
  }
  // An origin that is itself a results page would only swap stale results in underneath.
  if (saved && !isFullPageHref(saved.href)) return saved;
  return lastPageOutsideFullPage;
}

/**
 * Cmd+K or Cmd+F on the results page: the page has its own search box, so rather than open the
 * palette over it, they send the caret there (with a highlight, so it's noticed).
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
  try {
    const owed = sessionStorage.getItem(ANNOUNCE_KEY) === '1';
    sessionStorage.removeItem(ANNOUNCE_KEY);
    return owed;
  } catch {
    return false;
  }
}

// ─── Policy + metrics ───────────────────────────────────────────────────────

interface SessionIds {
  workspaceId: string;
  userId: string;
  searchSessionId: string | null;
}

export function recordExpandToFullPage(
  { workspaceId, userId, searchSessionId }: SessionIds,
  source: SearchFullPageOpenEvent['source'],
): void {
  saveCmdkPolicy(workspaceId, userId, onExpandToFull(loadCmdkPolicy(workspaceId, userId)));
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
  resultId: string,
): void {
  saveCmdkPolicy(
    workspaceId,
    userId,
    onResultOpened(loadCmdkPolicy(workspaceId, userId), Date.now(), query, resultId),
  );
}

/** The return banner was shown, clicked or dismissed. A show counts toward the max shows. */
export function recordReturnBanner(
  { workspaceId, userId, searchSessionId }: SessionIds,
  action: SearchReturnBannerEvent['action'],
): void {
  if (action === 'shown') {
    saveCmdkPolicy(workspaceId, userId, onBannerShown(loadCmdkPolicy(workspaceId, userId)));
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
 * A palette query (a remembered return or a recent search) as results-page params, through the
 * same filter registry the palette's own hand-off uses.
 */
export function resultsParamsForQuery(query: PaletteQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.text.trim()) params.set('query', query.text.trim());
  const docType = TAB_TO_DOC_TYPE[query.tab as keyof typeof TAB_TO_DOC_TYPE];
  if (docType) params.set('tab', docType);
  writeFiltersToParams(
    {
      ...DEFAULT_SEARCH_FILTERS,
      ...filtersFromChips(query.filterChips as ResultsMention[]),
      onlyMyChannels: query.toggles.onlyMyChannels,
      includeBotMessages: query.toggles.includeBotMessages,
    },
    params,
  );
  return params;
}
