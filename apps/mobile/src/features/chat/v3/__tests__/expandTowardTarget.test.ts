import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createdAtBounds, nextExpansion } from '../list/useExpandTowardTarget';

const anchor = {
  kind: 'anchor' as const,
  conversationId: 'm-9',
  messageId: 'm-9',
  createdAt: 50,
};

const loading = {
  status: 'loading' as const,
  target: anchor,
  containsTarget: false,
  isInitialLoadComplete: true,
  hasReachedStart: false,
  oldestCreatedAt: 80,
  newestCreatedAt: 120,
};

describe('nextExpansion', (): void => {
  it('does not paginate while the landing cursor is still unresolved', (): void => {
    assert.equal(nextExpansion({ ...loading, target: { ...anchor, createdAt: 0 } }), null);
  });

  it('does not paginate until the first page has settled', (): void => {
    assert.equal(nextExpansion({ ...loading, isInitialLoadComplete: false }), null);
  });

  it('stops when the window already contains the target', (): void => {
    assert.equal(nextExpansion({ ...loading, containsTarget: true }), null);
  });

  it('loads older when the target is before the current page', (): void => {
    assert.equal(nextExpansion(loading), 'older');
    assert.equal(nextExpansion({ ...loading, hasReachedStart: true }), null);
  });

  it('loads newer when the target is after the current page', (): void => {
    assert.equal(nextExpansion({ ...loading, oldestCreatedAt: 10, newestCreatedAt: 20 }), 'newer');
  });

  it('loads older first when the timestamp sits inside a page that missed the id', (): void => {
    assert.equal(nextExpansion({ ...loading, oldestCreatedAt: 40, newestCreatedAt: 60 }), 'older');
  });
});

describe('createdAtBounds', (): void => {
  it('returns null when no row has a createdAt', (): void => {
    assert.equal(createdAtBounds([{}, {}]), null);
  });

  it('returns the min and max createdAt', (): void => {
    assert.deepEqual(createdAtBounds([{ createdAt: 9 }, { createdAt: 3 }, { createdAt: 7 }]), {
      oldest: 3,
      newest: 9,
    });
  });
});
