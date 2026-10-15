import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createSearchState,
  searchReducer,
  type SearchAction,
  type SearchState,
} from '@/src/features/global-search/hooks/use-search-state';
import type { SearchFilterChip } from '@/src/features/global-search/types';
import type { FilterTrigger } from '@/src/features/global-search/utils/filter-trigger';

function chip(id: string, prefix: SearchFilterChip['prefix'] = 'from:'): SearchFilterChip {
  return { id, label: id, prefix, entityType: prefix === 'from:' ? 'user' : 'channel' };
}

function trigger(query: string, startIndex = 0): FilterTrigger {
  return { kind: 'from', query, startIndex, inMode: 'all' };
}

function reduce(state: SearchState, ...actions: SearchAction[]): SearchState {
  return actions.reduce(searchReducer, state);
}

function ids(state: SearchState): string[] {
  return state.chips.map(c => c.id);
}

const initial = createSearchState('chats');

describe('global search state', () => {
  it('starts empty on the entry tab', () => {
    assert.deepEqual(createSearchState('channels'), {
      tab: 'channels',
      query: '',
      chips: [],
      onlyMyChannels: false,
      trigger: null,
    });
  });

  describe('actions that change nothing', () => {
    // The same object back means no re-render and, for chips, no refetch.
    const noops: [string, SearchAction][] = [
      ['selecting the active tab', { type: 'tabChanged', tab: 'chats' }],
      ['committing the same query', { type: 'queryCommitted', query: '' }],
      ['reporting the same trigger', { type: 'triggerChanged', trigger: null }],
      ['removing a chip that is not there', { type: 'chipRemoved', chip: chip('u1') }],
      ['removing the last chip of none', { type: 'lastChipRemoved' }],
      ['replacing nothing with nothing', { type: 'chipsReplaced', prefix: 'from:', chips: [] }],
      ['clearing an empty search', { type: 'cleared' }],
    ];

    for (const [name, action] of noops) {
      it(`returns the same state when ${name}`, () => {
        assert.equal(searchReducer(initial, action), initial);
      });
    }
  });

  describe('query and trigger', () => {
    it('keeps the committed query and the live trigger apart', () => {
      const state = reduce(initial, { type: 'triggerChanged', trigger: trigger('al') });

      assert.equal(state.query, '');
      assert.deepEqual(state.trigger, trigger('al'));
    });

    it('ignores a trigger that asks for the same suggestions', () => {
      const state = reduce(initial, { type: 'triggerChanged', trigger: trigger('al', 0) });

      // Text typed before the operator moves `startIndex` but not the suggestions.
      const next = searchReducer(state, { type: 'triggerChanged', trigger: trigger('al', 7) });

      assert.equal(next, state);
    });
  });

  describe('chips', () => {
    it('ignores a duplicate', () => {
      const state = reduce(
        initial,
        { type: 'chipAdded', chip: chip('u1') },
        { type: 'chipAdded', chip: chip('u1') },
      );

      assert.deepEqual(ids(state), ['u1']);
    });

    it('treats the same id under another prefix as a different chip', () => {
      const state = reduce(
        initial,
        { type: 'chipAdded', chip: chip('x', 'from:') },
        { type: 'chipAdded', chip: chip('x', 'in:') },
      );

      assert.equal(state.chips.length, 2);
    });

    it('removes the last chip on backspace', () => {
      const state = reduce(
        initial,
        { type: 'chipAdded', chip: chip('u1') },
        { type: 'chipAdded', chip: chip('u2') },
        { type: 'lastChipRemoved' },
      );

      assert.deepEqual(ids(state), ['u1']);
    });

    it('removes one chip by id and prefix', () => {
      const state = reduce(
        initial,
        { type: 'chipAdded', chip: chip('u1') },
        { type: 'chipAdded', chip: chip('c1', 'in:') },
        { type: 'chipRemoved', chip: chip('u1') },
      );

      assert.deepEqual(ids(state), ['c1']);
    });
  });

  describe('replacing a filter from its sheet', () => {
    const withBoth = reduce(
      initial,
      { type: 'chipAdded', chip: chip('u1', 'from:') },
      { type: 'chipAdded', chip: chip('c1', 'in:') },
    );

    it('replaces only its own prefix and keeps the others', () => {
      const state = searchReducer(withBoth, {
        type: 'chipsReplaced',
        prefix: 'from:',
        chips: [chip('u2'), chip('u3')],
      });

      assert.deepEqual(ids(state), ['u2', 'u3', 'c1']);
    });

    it('holds the slot the prefix already occupied', () => {
      const inFirst = reduce(
        initial,
        { type: 'chipAdded', chip: chip('c1', 'in:') },
        { type: 'chipAdded', chip: chip('u1', 'from:') },
      );

      const state = searchReducer(inFirst, {
        type: 'chipsReplaced',
        prefix: 'in:',
        chips: [chip('c2', 'in:')],
      });

      assert.deepEqual(ids(state), ['c2', 'u1']);
    });

    it('returns the same state when an unchanged selection is re-applied', () => {
      const state = searchReducer(withBoth, {
        type: 'chipsReplaced',
        prefix: 'from:',
        chips: [chip('u1')],
      });

      // A new chips array here would fire a request for nothing.
      assert.equal(state, withBoth);
    });

    it('clears a prefix when given an empty selection', () => {
      const state = searchReducer(withBoth, { type: 'chipsReplaced', prefix: 'from:', chips: [] });

      assert.deepEqual(ids(state), ['c1']);
    });

    it('ignores chips of another prefix', () => {
      const state = searchReducer(withBoth, {
        type: 'chipsReplaced',
        prefix: 'from:',
        chips: [chip('u2'), chip('c9', 'in:')],
      });

      assert.deepEqual(ids(state), ['u2', 'c1']);
    });
  });

  describe('only my channels', () => {
    it('toggles', () => {
      const on = searchReducer(initial, { type: 'onlyMyChannelsToggled' });
      const off = searchReducer(on, { type: 'onlyMyChannelsToggled' });

      assert.equal(on.onlyMyChannels, true);
      assert.equal(off.onlyMyChannels, false);
    });
  });

  describe('clearing', () => {
    const busy = reduce(
      initial,
      { type: 'tabChanged', tab: 'files' },
      { type: 'queryCommitted', query: 'hello' },
      { type: 'chipAdded', chip: chip('u1') },
      { type: 'triggerChanged', trigger: trigger('al') },
      { type: 'onlyMyChannelsToggled' },
    );

    it('empties the query, the chips and the trigger together', () => {
      const state = searchReducer(busy, { type: 'cleared' });

      assert.equal(state.query, '');
      assert.deepEqual(state.chips, []);
      assert.equal(state.trigger, null);
    });

    it('keeps the tab and the toggle', () => {
      const state = searchReducer(busy, { type: 'cleared' });

      assert.equal(state.tab, 'files');
      assert.equal(state.onlyMyChannels, true);
    });
  });
});
