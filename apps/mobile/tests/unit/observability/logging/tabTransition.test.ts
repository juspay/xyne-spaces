import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  beginTabTransition,
  cancelPendingTabTransition,
  completeTabTransition,
  getPendingTabTransition,
  isTabName,
} from '@/src/observability/logging/navigation/tabTransition';

describe('tabTransition', () => {
  afterEach(() => {
    cancelPendingTabTransition();
  });

  it('treats only the five tab routes as tab names', () => {
    assert.equal(isTabName('dms'), true);
    assert.equal(isTabName('channels'), true);
    assert.equal(isTabName('tabPress'), false);
    assert.equal(isTabName(null), false);
  });

  it('starts on a different-tab press and completes once for that destination', () => {
    assert.equal(beginTabTransition('dms', 'calls', { nowMs: 1_000 }), true);

    const first = completeTabTransition('calls', 1_348);
    assert.deepEqual(first, {
      fromTab: 'dms',
      toTab: 'calls',
      durationMs: 348,
    });

    assert.equal(completeTabTransition('calls', 1_400), null);
  });

  it('ignores a second press to the same destination so one tap cannot log twice', () => {
    assert.equal(beginTabTransition('dms', 'calls', { nowMs: 1_000 }), true);
    assert.equal(beginTabTransition('dms', 'calls', { nowMs: 1_005 }), false);

    assert.deepEqual(completeTabTransition('calls', 1_480), {
      fromTab: 'dms',
      toTab: 'calls',
      durationMs: 480,
    });
  });

  it('ignores pressing the tab that is already active', () => {
    assert.equal(beginTabTransition('dms', 'dms', { nowMs: 1_000 }), false);
    assert.equal(getPendingTabTransition(), null);
  });

  it('replaces an unfinished switch when the user presses a different tab', () => {
    assert.equal(beginTabTransition('dms', 'channels', { nowMs: 1_000 }), true);
    assert.equal(beginTabTransition('dms', 'calls', { nowMs: 1_010 }), true);

    assert.equal(completeTabTransition('channels', 1_100), null);
    assert.deepEqual(completeTabTransition('calls', 1_500), {
      fromTab: 'dms',
      toTab: 'calls',
      durationMs: 490,
    });
  });

  it('ignores a ready report from a tab that is not the pending destination', () => {
    assert.equal(beginTabTransition('dms', 'calls', { nowMs: 1_000 }), true);
    assert.equal(completeTabTransition('channels', 1_200), null);
  });

  it('keeps an unfinished switch until the destination reports ready', () => {
    assert.equal(beginTabTransition('dms', 'calls', { nowMs: 1_000 }), true);

    assert.deepEqual(completeTabTransition('calls', 26_000), {
      fromTab: 'dms',
      toTab: 'calls',
      durationMs: 25_000,
    });
  });
});
