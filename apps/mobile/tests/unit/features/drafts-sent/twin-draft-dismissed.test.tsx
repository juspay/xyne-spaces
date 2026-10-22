import { beforeEach, describe, expect, it } from '@jest/globals';
import {
  __resetDismissedTwinDraftsForTests,
  clearDismissedTwinDrafts,
  dismissTwinDraftLocally,
  filterDismissedTwinDrafts,
  getDismissedTwinDraftIds,
  undismissTwinDraftLocally,
} from '@/src/features/drafts-sent/twin-draft-dismissed';

describe('twin-draft-dismissed', () => {
  beforeEach(() => {
    __resetDismissedTwinDraftsForTests();
  });

  it('dismisses and undismisses draft ids', () => {
    dismissTwinDraftLocally('a');
    expect(getDismissedTwinDraftIds().has('a')).toBe(true);

    undismissTwinDraftLocally('a');
    expect(getDismissedTwinDraftIds().has('a')).toBe(false);
  });

  it('ignores blank ids and is idempotent', () => {
    dismissTwinDraftLocally('  ');
    expect(getDismissedTwinDraftIds().size).toBe(0);

    dismissTwinDraftLocally('a');
    dismissTwinDraftLocally('a');
    expect(getDismissedTwinDraftIds().size).toBe(1);

    undismissTwinDraftLocally('missing');
    expect(getDismissedTwinDraftIds().has('a')).toBe(true);
  });

  it('filters dismissed drafts without mutating the source list', () => {
    const drafts = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    dismissTwinDraftLocally('b');

    expect(filterDismissedTwinDrafts(drafts, getDismissedTwinDraftIds()).map(d => d.id)).toEqual([
      'a',
      'c',
    ]);
    expect(drafts.map(d => d.id)).toEqual(['a', 'b', 'c']);
  });

  it('keeps dismissals for the session (no prune on empty Zero reload)', () => {
    dismissTwinDraftLocally('handled');
    // Empty reload / zombie reappear must not clear the local hide set.
    expect(filterDismissedTwinDrafts([{ id: 'handled' }], getDismissedTwinDraftIds())).toEqual([]);
    expect(getDismissedTwinDraftIds().has('handled')).toBe(true);
  });

  it('is pure with respect to the dismissed set argument', () => {
    const drafts = [{ id: 'a' }, { id: 'b' }];
    expect(filterDismissedTwinDrafts(drafts, new Set(['b'])).map(d => d.id)).toEqual(['a']);
    expect(filterDismissedTwinDrafts(drafts, new Set()).map(d => d.id)).toEqual(['a', 'b']);
  });

  it('clears on session boundary without requiring Zero prune', () => {
    dismissTwinDraftLocally('handled');
    expect(getDismissedTwinDraftIds().has('handled')).toBe(true);

    clearDismissedTwinDrafts();
    expect(getDismissedTwinDraftIds().size).toBe(0);
    expect(filterDismissedTwinDrafts([{ id: 'handled' }], getDismissedTwinDraftIds())).toEqual([
      { id: 'handled' },
    ]);
  });
});
