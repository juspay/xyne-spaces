import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  canSavePauseSelection,
  collectPauseUntilCandidates,
  formatPauseCustomSummary,
  formatPauseDate,
  initialCustomPauseTime,
  isPauseActive,
  resolveNotificationsPausedUntil,
  resolvePauseUntil,
} from '@/src/utils/pauseNotifications';

const TOLERANCE_MS = 5_000;

describe('resolvePauseUntil', () => {
  it('uses dashboard duration offsets, not end-of-day', () => {
    const ignored = new Date(Date.now() + 86_400_000);
    const cases: Array<
      ['30min' | '1hour' | '2hours' | '4hours' | 'tomorrow' | 'nextWeek', number]
    > = [
      ['30min', 30 * 60 * 1000],
      ['1hour', 60 * 60 * 1000],
      ['2hours', 2 * 60 * 60 * 1000],
      ['4hours', 4 * 60 * 60 * 1000],
      ['tomorrow', 24 * 60 * 60 * 1000],
      ['nextWeek', 7 * 24 * 60 * 60 * 1000],
    ];

    for (const [option, offset] of cases) {
      const actual = resolvePauseUntil(option, ignored);
      assert.ok(
        Math.abs(actual - (Date.now() + offset)) < TOLERANCE_MS,
        `${option} should land ~${offset}ms out`,
      );
    }
  });

  it('returns the custom instant exactly', () => {
    const chosen = new Date(Date.now() + 3 * 86_400_000);
    assert.equal(resolvePauseUntil('custom', chosen), chosen.getTime());
  });
});

describe('resolveNotificationsPausedUntil', () => {
  it('keeps only a future timestamp', () => {
    assert.equal(resolveNotificationsPausedUntil(Date.now() - 1000, null, undefined), undefined);
    const future = Date.now() + 60_000;
    assert.equal(resolveNotificationsPausedUntil(Date.now() - 1000, future), future);
  });
});

describe('collectPauseUntilCandidates', () => {
  it('reads users and presenceStatus, matching the dual-write', () => {
    const values = collectPauseUntilCandidates(
      { notificationsPausedUntil: 1 },
      { presenceStatus: { notificationsPausedUntil: 2 } },
    );
    assert.deepEqual(values, [1, undefined, undefined, 2]);
  });
});

describe('formatPauseDate', () => {
  it('labels today and tomorrow', () => {
    const now = new Date(2026, 8, 11, 15, 26);
    assert.equal(formatPauseDate(now, now), 'Today');
    const tomorrow = new Date(2026, 8, 12, 9, 0);
    assert.equal(formatPauseDate(tomorrow, now), 'Tomorrow');
  });
});

describe('formatPauseCustomSummary', () => {
  it('formats custom summary with ordinal day', () => {
    assert.equal(
      formatPauseCustomSummary(new Date(2026, 9, 28, 12, 28)),
      'October 28th at 12:28 PM',
    );
    assert.equal(formatPauseCustomSummary(new Date(2026, 0, 1, 9, 5)), 'January 1st at 9:05 AM');
    assert.equal(formatPauseCustomSummary(new Date(2026, 2, 2, 15, 0)), 'March 2nd at 3:00 PM');
    assert.equal(formatPauseCustomSummary(new Date(2026, 4, 3, 0, 0)), 'May 3rd at 12:00 AM');
    assert.equal(
      formatPauseCustomSummary(new Date(2026, 10, 11, 18, 45)),
      'November 11th at 6:45 PM',
    );
  });
});

describe('isPauseActive', () => {
  it('is true only for a future timestamp', () => {
    const now = 1_000_000;
    assert.equal(isPauseActive(undefined, now), false);
    assert.equal(isPauseActive(null, now), false);
    assert.equal(isPauseActive(now, now), false);
    assert.equal(isPauseActive(now - 1, now), false);
    assert.equal(isPauseActive(now + 1, now), true);
  });
});

describe('canSavePauseSelection', () => {
  it('stays off until a future option is chosen', () => {
    const now = Date.now();
    const past = new Date(now - 60_000);
    const future = new Date(now + 60_000);

    assert.equal(canSavePauseSelection(null, future, now), false);
    assert.equal(canSavePauseSelection('custom', past, now), false);
    assert.equal(canSavePauseSelection('custom', future, now), true);
    assert.equal(canSavePauseSelection('30min', past, now), true);
  });
});

describe('initialCustomPauseTime', () => {
  it('is in the future and on a 5-minute mark', () => {
    const next = initialCustomPauseTime();
    assert.ok(next.getTime() > Date.now());
    assert.equal(next.getMinutes() % 5, 0);
    assert.equal(next.getSeconds(), 0);
  });
});
