import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  SEARCH_SIDE_MARGIN,
  SEARCH_BAR_HEIGHT,
  SEARCH_BAR_ICON_SIZE,
  SEARCH_BAR_TEXT_FONT_SIZE,
  SEARCH_BAR_TEXT_LINE_HEIGHT,
  SEARCH_FILTER_ROW_TOP_GAP,
  SEARCH_FILTER_ROW_HEIGHT,
  SEARCH_FILTER_ROW_GAP,
  SEARCH_CATEGORY_ROW_TOP_GAP,
  SEARCH_CATEGORY_ROW_HEIGHT,
  SEARCH_CATEGORY_ROW_GAP,
  SEARCH_BADGE_INTRINSIC_HEIGHT,
  SEARCH_FILTER_ROW_COLLAPSE_DISTANCE,
  TABS_SEARCH_BAR_VERTICAL_GAP,
  TABS_SEARCH_COLLAPSE_DISTANCE,
} from '@/src/features/global-search/constants';

describe('global-search motion constants', () => {
  it('pins the current search-bar layout metrics', () => {
    assert.equal(SEARCH_SIDE_MARGIN, 16);
    assert.equal(SEARCH_BAR_HEIGHT, 44);
    assert.equal(SEARCH_BAR_ICON_SIZE, 18);
    assert.equal(SEARCH_BAR_TEXT_FONT_SIZE, 16);
    assert.equal(SEARCH_BAR_TEXT_LINE_HEIGHT, 22);
  });

  it('pins the filter row metrics', () => {
    assert.equal(SEARCH_FILTER_ROW_TOP_GAP, 10);
    assert.equal(SEARCH_FILTER_ROW_HEIGHT, 40);
    assert.equal(SEARCH_FILTER_ROW_GAP, 8);
    assert.equal(TABS_SEARCH_BAR_VERTICAL_GAP, 12);
    assert.equal(TABS_SEARCH_COLLAPSE_DISTANCE, 200);
  });

  it('pins the category tag row metrics', () => {
    assert.equal(SEARCH_CATEGORY_ROW_TOP_GAP, 10);
    assert.equal(SEARCH_CATEGORY_ROW_HEIGHT, 40);
    assert.equal(SEARCH_CATEGORY_ROW_GAP, 8);
  });

  it('pins the toolbar collapse distance', () => {
    assert.equal(SEARCH_FILTER_ROW_COLLAPSE_DISTANCE, 72);
  });

  it('collapses the filter row over more than the row it hides', () => {
    // The row is clipped by the shrinking toolbar, so a runway shorter than the
    // row itself would wipe it away faster than the scroll that caused it.
    assert.ok(SEARCH_FILTER_ROW_COLLAPSE_DISTANCE > SEARCH_FILTER_ROW_HEIGHT);
  });

  it('keeps the line height at least as tall as the font size', () => {
    assert.ok(SEARCH_BAR_TEXT_LINE_HEIGHT >= SEARCH_BAR_TEXT_FONT_SIZE);
  });

  it('keeps both toolbar rows at least as tall as a badge', () => {
    // A horizontal ScrollView whose content overflows its frame becomes
    // grabbable on the vertical axis — the bug the search pill already hit.
    assert.ok(SEARCH_BADGE_INTRINSIC_HEIGHT <= SEARCH_FILTER_ROW_HEIGHT);
    assert.ok(SEARCH_BADGE_INTRINSIC_HEIGHT <= SEARCH_CATEGORY_ROW_HEIGHT);
  });

  it('gives the two badge rows identical metrics, since they are one family', () => {
    assert.equal(SEARCH_FILTER_ROW_HEIGHT, SEARCH_CATEGORY_ROW_HEIGHT);
    assert.equal(SEARCH_FILTER_ROW_GAP, SEARCH_CATEGORY_ROW_GAP);
    assert.equal(SEARCH_FILTER_ROW_TOP_GAP, SEARCH_CATEGORY_ROW_TOP_GAP);
  });
});
