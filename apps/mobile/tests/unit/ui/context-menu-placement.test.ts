import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { clampMenuWidth, placeMenu } from '@/src/ui/context-menu/placement';
import {
  MENU_ANCHOR_GAP,
  MENU_MAX_WIDTH,
  MENU_MIN_WIDTH,
  MENU_SCREEN_PADDING,
} from '@/src/ui/context-menu/constants';

const SCREEN = { width: 390, height: 844, insetTop: 59, insetBottom: 34 };
const MENU = { width: 220, height: 120 };

/** A row partway down the list. */
const row = (y: number) => ({ x: 16, y, width: 358, height: 76 });

describe('placeMenu', () => {
  it('sits below the anchor when there is room', () => {
    const anchor = row(200);
    const placement = placeMenu(anchor, MENU, SCREEN);

    assert.equal(placement.top, anchor.y + anchor.height + MENU_ANCHOR_GAP);
    assert.equal(placement.origin, 'top');
  });

  it('flips above when the menu would run off the bottom', () => {
    const anchor = row(700);
    const placement = placeMenu(anchor, MENU, SCREEN);

    assert.equal(placement.top, anchor.y - MENU_ANCHOR_GAP - MENU.height);
    assert.equal(placement.origin, 'bottom');
  });

  it('keeps the menu inside the safe area at the very top', () => {
    // A row under the status bar, with a menu too tall to fit above it.
    const placement = placeMenu(row(60), { width: 220, height: 700 }, SCREEN);
    assert.ok(placement.top >= SCREEN.insetTop + MENU_SCREEN_PADDING);
  });

  it('keeps the menu inside the safe area at the very bottom', () => {
    const placement = placeMenu(row(780), MENU, SCREEN);
    const safeBottom = SCREEN.height - SCREEN.insetBottom - MENU_SCREEN_PADDING;
    assert.ok(placement.top + MENU.height <= safeBottom);
  });

  it('covers the anchor rather than overflowing when nothing fits', () => {
    // Taller than the usable screen: it has to overlap something.
    const tall = { width: 220, height: 900 };
    const placement = placeMenu(row(400), tall, SCREEN);

    assert.equal(placement.top, SCREEN.insetTop + MENU_SCREEN_PADDING);
  });

  it('follows the anchor horizontally', () => {
    const placement = placeMenu({ x: 40, y: 200, width: 100, height: 76 }, MENU, SCREEN);
    assert.equal(placement.left, 40);
  });

  it('pulls back from the right edge instead of running off it', () => {
    const placement = placeMenu({ x: 340, y: 200, width: 40, height: 76 }, MENU, SCREEN);

    assert.equal(placement.left, SCREEN.width - MENU.width - MENU_SCREEN_PADDING);
    assert.ok(placement.left + MENU.width <= SCREEN.width - MENU_SCREEN_PADDING);
  });

  it('never starts left of the screen padding', () => {
    const placement = placeMenu({ x: -20, y: 200, width: 60, height: 76 }, MENU, SCREEN);
    assert.equal(placement.left, MENU_SCREEN_PADDING);
  });

  it('keeps the transform origin on the card even when shifted', () => {
    const placement = placeMenu({ x: 340, y: 200, width: 40, height: 76 }, MENU, SCREEN);

    assert.ok(placement.originX >= 0);
    assert.ok(placement.originX <= MENU.width);
  });

  it('points the origin at the anchor centre when unshifted', () => {
    const anchor = { x: 40, y: 200, width: 100, height: 76 };
    const placement = placeMenu(anchor, MENU, SCREEN);

    // anchor centre 90, card left 40 -> 50 into the card
    assert.equal(placement.originX, 50);
  });
});

describe('clampMenuWidth', () => {
  it('holds a floor and a ceiling', () => {
    assert.equal(clampMenuWidth(10), MENU_MIN_WIDTH);
    assert.equal(clampMenuWidth(1000), MENU_MAX_WIDTH);
    assert.equal(clampMenuWidth(240), 240);
  });
});
