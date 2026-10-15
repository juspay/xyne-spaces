import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  HANDOFF_LAST_OP_RECENT_MS,
  hashMmkvKey,
  isSharedStoreFallbackAllowed,
  isSuspendEligible,
  shouldPublishHandoffLastOp,
} from '@/src/storage/mmkv/lastHandoffOpPolicy';

describe('mmkv lastHandoffOpPolicy', () => {
  it('hashes keys stably without emitting the raw key', () => {
    assert.equal(hashMmkvKey('@lotus_user_id'), hashMmkvKey('@lotus_user_id'));
    assert.notEqual(hashMmkvKey('@lotus_user_id'), hashMmkvKey('settings:v1'));
    assert.equal(hashMmkvKey(''), '1505');
  });

  it('treats headless and non-active app states as suspend-eligible', () => {
    assert.equal(isSuspendEligible({ runtime: 'headless', appState: 'active' }), true);
    assert.equal(isSuspendEligible({ runtime: 'main', appState: 'background' }), true);
    assert.equal(isSuspendEligible({ runtime: 'main', appState: 'inactive' }), true);
    assert.equal(isSuspendEligible({ runtime: 'main', appState: 'active' }), false);
  });

  it('allows App Group fallback for cache keys only in the foreground main app', () => {
    assert.equal(isSharedStoreFallbackAllowed({ runtime: 'main', appState: 'active' }), true);
    assert.equal(isSharedStoreFallbackAllowed({ runtime: 'headless', appState: 'active' }), false);
    assert.equal(isSharedStoreFallbackAllowed({ runtime: 'main', appState: 'background' }), false);
  });

  it('publishes last-op RCA only for recent suspend-eligible ops', () => {
    const now = 1_000_000;
    const eligible = {
      ts: now - 1_000,
      op: 'get',
      caller: 'notification',
      keyHash: 'abc',
      appState: 'background' as const,
      runtime: 'headless' as const,
    };
    assert.equal(shouldPublishHandoffLastOp(eligible, now), true);
    assert.equal(
      shouldPublishHandoffLastOp({ ...eligible, ts: now - HANDOFF_LAST_OP_RECENT_MS - 1 }, now),
      false,
    );
    assert.equal(
      shouldPublishHandoffLastOp({ ...eligible, runtime: 'main', appState: 'active' }, now),
      false,
    );
  });
});
