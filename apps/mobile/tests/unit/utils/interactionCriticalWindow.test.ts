import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import {
  beginCriticalWindow,
  CRITICAL_WINDOW_TIMEOUT_MS,
  endCriticalWindow,
  getChatCriticalWindowTag,
  isCriticalWindowActive,
} from '@/src/utils/interactionCriticalWindow';

describe('interaction critical window', () => {
  it('uses one stable tag per channel across route replacements', () => {
    assert.equal(getChatCriticalWindowTag('channel-a'), 'chat:channel-a');
  });

  it('keeps overlapping windows active until every owner releases', () => {
    beginCriticalWindow('chat:a');
    beginCriticalWindow('tab:dms');

    assert.equal(isCriticalWindowActive(), true);
    endCriticalWindow('chat:a');
    assert.equal(isCriticalWindowActive(), true);
    endCriticalWindow('tab:dms');
    assert.equal(isCriticalWindowActive(), false);

    // Ending an already-released tag is intentionally idempotent.
    endCriticalWindow('tab:dms');
    assert.equal(isCriticalWindowActive(), false);
  });

  it('automatically releases a window at the safety cap', () => {
    mock.timers.enable({ apis: ['setTimeout'] });

    try {
      beginCriticalWindow('chat:timeout');
      assert.equal(isCriticalWindowActive(), true);
      mock.timers.tick(CRITICAL_WINDOW_TIMEOUT_MS);
      assert.equal(isCriticalWindowActive(), false);
    } finally {
      endCriticalWindow('chat:timeout');
      mock.timers.reset();
    }
  });
});
