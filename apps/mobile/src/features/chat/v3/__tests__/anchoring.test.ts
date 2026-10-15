import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  distanceFromBottom,
  initialScrollMode,
  reduceScrollMode,
  shouldRestorePosition,
  shouldReturnToFollowTail,
  TAIL_FOLLOW_THRESHOLD_PX,
  type ScrollMode,
} from '../list/anchoring';
import type { OpenState } from '../machine/openState';

const statuses: OpenState['status'][] = [
  'idle',
  'resolving',
  'loading',
  'placing',
  'ready',
  'error',
];
const modes: ScrollMode[] = ['follow-tail', 'anchored', 'user-owned'];

describe('reduceScrollMode', (): void => {
  it('follow-tail → user-owned on drag; anchored → user-owned on drag', (): void => {
    assert.equal(reduceScrollMode('follow-tail', { type: 'userDrag' }), 'user-owned');
    assert.equal(reduceScrollMode('anchored', { type: 'userDrag' }), 'user-owned');
  });

  it('user-owned → follow-tail when the user returns to the bottom', (): void => {
    assert.equal(reduceScrollMode('user-owned', { type: 'returnedToBottom' }), 'follow-tail');
    assert.equal(reduceScrollMode('anchored', { type: 'returnedToBottom' }), 'anchored');
    assert.equal(reduceScrollMode('follow-tail', { type: 'returnedToBottom' }), 'follow-tail');
  });

  it('retarget follows the new landing kind', (): void => {
    assert.equal(
      reduceScrollMode('user-owned', { type: 'retarget', targetKind: 'tail' }),
      'follow-tail',
    );
    assert.equal(
      reduceScrollMode('follow-tail', { type: 'retarget', targetKind: 'anchor' }),
      'anchored',
    );
  });

  it('jump-to-latest always returns to follow-tail', (): void => {
    assert.equal(reduceScrollMode('anchored', { type: 'jumpedToTail' }), 'follow-tail');
    assert.equal(reduceScrollMode('user-owned', { type: 'jumpedToTail' }), 'follow-tail');
  });

  it('opens tail in follow-tail and anchored opens in anchored', (): void => {
    assert.equal(initialScrollMode({ kind: 'tail' }), 'follow-tail');
    assert.equal(
      initialScrollMode({ kind: 'anchor', conversationId: 'c1', messageId: 'c1', createdAt: 1 }),
      'anchored',
    );
  });
});

describe('shouldRestorePosition', (): void => {
  for (const mode of modes) {
    for (const status of statuses) {
      it(`${mode} × ${status}`, (): void => {
        const restored = shouldRestorePosition({
          mode,
          status,
          rowId: 'row-1',
          lockedRowId: 'row-1',
          distanceFromBottomPx: 80,
        });
        if (status === 'idle' || status === 'error') {
          assert.equal(restored, false);
          return;
        }
        if (mode === 'follow-tail') {
          assert.equal(restored, false);
          return;
        }
        if (mode === 'user-owned') {
          assert.equal(restored, 80 > TAIL_FOLLOW_THRESHOLD_PX);
          return;
        }
        assert.equal(restored, true);
      });
    }
  }

  it('anchored mode only restores the locked row when a lock exists', (): void => {
    assert.equal(
      shouldRestorePosition({
        mode: 'anchored',
        status: 'placing',
        rowId: 'other',
        lockedRowId: 'target',
        distanceFromBottomPx: 0,
      }),
      false,
    );
    assert.equal(
      shouldRestorePosition({
        mode: 'anchored',
        status: 'placing',
        rowId: 'target',
        lockedRowId: 'target',
        distanceFromBottomPx: 0,
      }),
      true,
    );
  });

  it('user-owned at the true bottom does not restore (maintainScrollAtEnd owns the tail)', (): void => {
    assert.equal(
      shouldRestorePosition({
        mode: 'user-owned',
        status: 'ready',
        rowId: 'row-1',
        lockedRowId: null,
        distanceFromBottomPx: 0,
      }),
      false,
    );
  });
});

describe('distanceFromBottom', (): void => {
  it('is content leftover below the viewport, floored at 0', (): void => {
    assert.equal(
      distanceFromBottom({ contentLength: 1000, scroll: 400, scrollLength: 500, isAtEnd: false }),
      100,
    );
    assert.equal(
      distanceFromBottom({ contentLength: 500, scroll: 400, scrollLength: 500, isAtEnd: true }),
      0,
    );
  });
});

describe('shouldReturnToFollowTail', (): void => {
  it('only leaves user-owned when the viewport is at the end', (): void => {
    assert.equal(shouldReturnToFollowTail('user-owned', true), true);
    assert.equal(shouldReturnToFollowTail('user-owned', false), false);
    assert.equal(shouldReturnToFollowTail('follow-tail', true), false);
    assert.equal(shouldReturnToFollowTail('anchored', true), false);
  });
});
