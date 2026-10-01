/**
 * From an agent's profile to editing it: the canvas glides from where the
 * profile had it to its place beside the Build chat, while the Build chat
 * slides in from the right edge, both on one curve so they move together.
 * Leaving runs it backwards: the Build chat slides out and the canvas glides
 * toward the profile's spot, and the profile picks the glide up from wherever
 * the canvas had got to.
 *
 * The animations only fill backwards, so nothing stays on the elements once
 * they land: a leftover transform would make them the containing block for
 * fixed-position menus inside.
 */

import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/** Marks the canvas column on both pages, so the edit page knows where the profile had it. */
export const CANVAS_COLUMN_ATTR = 'data-create-canvas-column';

const SLIDE_MS = 480;
/** Leaving is quicker than arriving: the user asked to go. */
const EXIT_MS = 360;
const SLIDE_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
const REDUCED_FADE_MS = 200;
/** The Build chat starts this far past the right edge, clear of its shadow. */
const PANEL_OFFSCREEN_PX = 24;
/** The profile's canvas column: up to this wide, inside a 16px gutter (AgentCreateCanvas, profile layout). */
const PROFILE_COLUMN_MAX_PX = 860;
const PROFILE_GUTTER_PX = 16;

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Where the canvas column is on screen now, to hand to the next page. */
export function canvasColumnLeft(): number | undefined {
  const column = document.querySelector(`[${CANVAS_COLUMN_ATTR}]`);
  return column ? column.getBoundingClientRect().left : undefined;
}

/**
 * Moves the canvas from `fromLeft` (where its column was on the last page) to
 * where it is now. `root` moves; `column` is what was measured.
 */
export function glideCanvasFrom(
  root: HTMLElement,
  column: HTMLElement,
  fromLeft: number,
): () => void {
  const dx = fromLeft - column.getBoundingClientRect().left;
  if (Math.abs(dx) < 1 || reducedMotion()) return () => undefined;
  const animation = root.animate(
    { transform: [`translateX(${dx}px)`, 'none'] },
    { duration: SLIDE_MS, easing: SLIDE_EASE, fill: 'backwards' },
  );
  return () => animation.cancel();
}

/** Brings the Build chat in from the right edge. */
export function slideInPanel(panel: HTMLElement): () => void {
  const animation = reducedMotion()
    ? panel.animate({ opacity: [0, 1] }, { duration: REDUCED_FADE_MS, easing: 'ease-out' })
    : panel.animate(
        {
          transform: [`translateX(calc(100% + ${PANEL_OFFSCREEN_PX}px))`, 'none'],
          opacity: [0, 1],
        },
        { duration: SLIDE_MS, easing: SLIDE_EASE, fill: 'backwards' },
      );
  return () => animation.cancel();
}

/**
 * The way out to the profile, played before leaving: the Build chat slides
 * off to the right and the canvas glides to where the profile will put it
 * (`profileLeft`, where it was on the way in, else worked out from the page).
 * Both hold their end state until the page goes.
 */
export function slideOutToProfile(page: HTMLElement, profileLeft?: number): Promise<void> {
  const panel = page.querySelector<HTMLElement>('[data-testid="create-agent-side-card"]');
  const root = page.querySelector<HTMLElement>('[data-component="AgentCreateCanvas"]');
  const column = page.querySelector<HTMLElement>(`[${CANVAS_COLUMN_ATTR}]`);
  const reduced = reducedMotion();
  const timing = {
    duration: reduced ? REDUCED_FADE_MS : EXIT_MS,
    easing: SLIDE_EASE,
    fill: 'forwards' as const,
  };
  const animations: Animation[] = [];
  if (panel) {
    animations.push(
      panel.animate(
        reduced
          ? { opacity: [1, 0] }
          : {
              transform: ['none', `translateX(calc(100% + ${PANEL_OFFSCREEN_PX}px))`],
              opacity: [1, 0],
            },
        timing,
      ),
    );
  }
  if (!reduced && root && column) {
    const rect = page.getBoundingClientRect();
    const width = Math.min(PROFILE_COLUMN_MAX_PX, rect.width - PROFILE_GUTTER_PX * 2);
    const target = profileLeft ?? rect.left + (rect.width - width) / 2;
    const dx = target - column.getBoundingClientRect().left;
    if (Math.abs(dx) >= 1) {
      animations.push(root.animate({ transform: ['none', `translateX(${dx}px)`] }, timing));
    }
  }
  return Promise.all(animations.map(animation => animation.finished.catch(() => undefined))).then(
    () => undefined,
  );
}

/**
 * Where the canvas was on the page before, if it came with the navigation
 * (`state.canvasLeft`). Read once, then taken out of the history entry so a
 * reload doesn't glide again.
 */
export function useArrivalCanvasLeft(): number | undefined {
  const location = useLocation();
  const navigate = useNavigate();
  const [left] = useState(() => {
    const value = (location.state as { canvasLeft?: unknown } | null)?.canvasLeft;
    return typeof value === 'number' ? value : undefined;
  });
  useEffect(() => {
    if (left === undefined) return;
    const { canvasLeft: _used, ...rest } = (location.state ?? {}) as Record<string, unknown>;
    void navigate(`${location.pathname}${location.search}`, {
      replace: true,
      state: Object.keys(rest).length > 0 ? rest : null,
    });
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return left;
}
