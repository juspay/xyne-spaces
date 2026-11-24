import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  formatShortRelative,
  resetShortRelativeFormatter,
} from '@/src/features/conversation/model/relative-time';

const NOW = new Date(2026, 9, 20, 12, 0, 0, 0).getTime();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('formatShortRelative', () => {
  it('reads "now" inside the first minute and for times ahead of now', () => {
    assert.equal(formatShortRelative(NOW, NOW), 'now');
    assert.equal(formatShortRelative(NOW - 59_999, NOW), 'now');
    assert.equal(formatShortRelative(NOW + 5 * MIN, NOW), 'now');
  });

  it('counts whole minutes, then hours, then days', () => {
    assert.equal(formatShortRelative(NOW - MIN, NOW), '1m ago');
    assert.equal(formatShortRelative(NOW - 10 * MIN, NOW), '10m ago');
    assert.equal(formatShortRelative(NOW - 59 * MIN - 59_000, NOW), '59m ago');
    assert.equal(formatShortRelative(NOW - HOUR, NOW), '1h ago');
    assert.equal(formatShortRelative(NOW - 23 * HOUR - 59 * MIN, NOW), '23h ago');
    assert.equal(formatShortRelative(NOW - DAY, NOW), '1d ago');
    assert.equal(formatShortRelative(NOW - 6 * DAY - 23 * HOUR, NOW), '6d ago');
  });

  it('switches to a date from a week out', () => {
    resetShortRelativeFormatter();
    const label = formatShortRelative(new Date(2026, 8, 22, 9, 0).getTime(), NOW);
    // The month name follows the device locale ("Sep 22", "22 sept."), so only the day is fixed.
    assert.match(label, /\b22\b/);
    assert.doesNotMatch(label, /ago|now/);
  });

  it('is empty without a time', () => {
    assert.equal(formatShortRelative(0, NOW), '');
  });
});
