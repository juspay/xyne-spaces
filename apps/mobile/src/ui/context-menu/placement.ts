import { MENU_ANCHOR_GAP, MENU_MAX_WIDTH, MENU_MIN_WIDTH, MENU_SCREEN_PADDING } from './constants';

/** Where the thing that opened the menu is, in window coordinates. */
export type MenuAnchor = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type MenuSize = {
  width: number;
  height: number;
};

/** The screen, less anything the system is already occupying. */
export type MenuBounds = {
  width: number;
  height: number;
  insetTop: number;
  insetBottom: number;
};

export type MenuPlacement = {
  left: number;
  top: number;
  /** Which edge the card grows from, so it appears to come out of the anchor. */
  origin: 'top' | 'bottom';
  /** Horizontal origin, in points from the card's left edge. */
  originX: number;
};

/** The width a menu is allowed to be, before it knows its content. */
export function clampMenuWidth(contentWidth: number): number {
  return Math.min(Math.max(contentWidth, MENU_MIN_WIDTH), MENU_MAX_WIDTH);
}

/**
 * Where to put the card.
 *
 * Below the anchor when it fits, above when it does not, and whichever side
 * has more room when neither does — in that last case the card is clamped
 * into the safe area and will overlap the anchor, which is the honest
 * outcome: a menu taller than the screen has to cover something, and
 * covering the row you pressed is better than running off the edge.
 *
 * Horizontally it follows the anchor's left edge and is then clamped, so a
 * row near the right edge slides the card left rather than off-screen. The
 * transform origin tracks the anchor's centre through all of it, so the card
 * still looks like it came from what was pressed.
 */
export function placeMenu(anchor: MenuAnchor, size: MenuSize, bounds: MenuBounds): MenuPlacement {
  const safeTop = bounds.insetTop + MENU_SCREEN_PADDING;
  const safeBottom = bounds.height - bounds.insetBottom - MENU_SCREEN_PADDING;

  const anchorBottom = anchor.y + anchor.height;
  const spaceBelow = safeBottom - (anchorBottom + MENU_ANCHOR_GAP);
  const spaceAbove = anchor.y - MENU_ANCHOR_GAP - safeTop;

  const fitsBelow = size.height <= spaceBelow;
  const placeBelow = fitsBelow || spaceBelow >= spaceAbove;

  const unclampedTop = placeBelow
    ? anchorBottom + MENU_ANCHOR_GAP
    : anchor.y - MENU_ANCHOR_GAP - size.height;

  // Never past an edge, even when that means covering the anchor.
  const maxTop = Math.max(safeTop, safeBottom - size.height);
  const top = Math.min(Math.max(unclampedTop, safeTop), maxTop);

  const minLeft = MENU_SCREEN_PADDING;
  const maxLeft = Math.max(minLeft, bounds.width - size.width - MENU_SCREEN_PADDING);
  const left = Math.min(Math.max(anchor.x, minLeft), maxLeft);

  // Clamped into the card so a heavily shifted menu still scales from a point
  // on itself rather than from somewhere in the margin.
  const anchorCenterX = anchor.x + anchor.width / 2;
  const originX = Math.min(Math.max(anchorCenterX - left, 0), size.width);

  return { left, top, origin: placeBelow ? 'top' : 'bottom', originX };
}
