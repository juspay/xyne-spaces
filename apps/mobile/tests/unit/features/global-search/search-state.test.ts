import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createSearchState,
  searchReducer,
  type SearchAction,
  type SearchState,
} from '@/src/features/global-search/hooks/use-search-state';
import type { SearchFilterChip } from '@/src/features/global-search/types';
import { DEFAULT_STRUCTURED_FILTERS } from '@/src/features/global-search/utils/filter-model';
import {
  DEFAULT_RANK_PROFILE,
  DEFAULT_SORT_BY,
} from '@/src/features/global-search/utils/rank-sort';
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
      structured: DEFAULT_STRUCTURED_FILTERS,
      onlyMyChannels: false,
      includeBotMessages: false,
      exactMatch: false,
      sortBy: DEFAULT_SORT_BY,
      rankProfile: DEFAULT_RANK_PROFILE,
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

  describe('sort and rank via Filters apply', () => {
    const apply = (
      state: SearchState,
      overrides: Partial<{
        sortBy: SearchState['sortBy'];
        rankProfile: string;
        onlyMyChannels: boolean;
      }> = {},
    ): SearchState =>
      searchReducer(state, {
        type: 'structuredApplied',
        structured: DEFAULT_STRUCTURED_FILTERS,
        chips: [],
        onlyMyChannels: false,
        sortBy: DEFAULT_SORT_BY,
        rankProfile: DEFAULT_RANK_PROFILE,
        ...overrides,
      });

    it('applies sort and rank from the drawer', () => {
      const state = apply(initial, { sortBy: 'newest', rankProfile: 'personalized' });

      assert.equal(state.sortBy, 'newest');
      assert.equal(state.rankProfile, 'personalized');
    });

    it('returns the same state when an unchanged Filters apply is re-committed', () => {
      const once = apply(initial, { sortBy: 'oldest', rankProfile: 'personalized' });
      const again = apply(once, { sortBy: 'oldest', rankProfile: 'personalized' });

      assert.equal(again, once);
    });

    it('can change sort without touching rank', () => {
      const ranked = apply(initial, { rankProfile: 'personalized' });
      const sorted = apply(ranked, { sortBy: 'newest', rankProfile: 'personalized' });

      assert.equal(sorted.sortBy, 'newest');
      assert.equal(sorted.rankProfile, 'personalized');
    });

    it('can reset sort and rank back to defaults from the drawer', () => {
      const busy = apply(initial, { sortBy: 'newest', rankProfile: 'personalized' });
      const cleared = apply(busy);

      assert.equal(cleared.sortBy, DEFAULT_SORT_BY);
      assert.equal(cleared.rankProfile, DEFAULT_RANK_PROFILE);
    });

    it('resets rank when the tab changes but keeps sort', () => {
      const ranked = apply(initial, { sortBy: 'newest', rankProfile: 'personalized' });
      const next = searchReducer(ranked, { type: 'tabChanged', tab: 'tickets' });

      assert.equal(next.tab, 'tickets');
      assert.equal(next.rankProfile, DEFAULT_RANK_PROFILE);
      assert.equal(next.sortBy, 'newest');
    });

    it('drops structured fields that do not apply when the tab changes', () => {
      const onMessages = searchReducer(initial, { type: 'tabChanged', tab: 'messages' });
      const busy = searchReducer(onMessages, {
        type: 'structuredApplied',
        structured: {
          ...DEFAULT_STRUCTURED_FILTERS,
          priority: 'HIGH',
          assignees: [{ id: 'u1', label: 'Ada' }],
          withUsers: [{ id: 'u2', label: 'Bob' }],
        },
        chips: [{ id: 'u9', label: 'From', prefix: 'from:', entityType: 'user' }],
        onlyMyChannels: false,
        sortBy: 'newest',
        rankProfile: DEFAULT_RANK_PROFILE,
      });
      const onTickets = searchReducer(busy, { type: 'tabChanged', tab: 'tickets' });

      assert.equal(onTickets.structured.priority, 'HIGH');
      assert.deepEqual(onTickets.structured.assignees, [{ id: 'u1', label: 'Ada' }]);
      assert.deepEqual(onTickets.structured.withUsers, []);
      assert.equal(onTickets.chips.length, 1);

      const backToMessages = searchReducer(onTickets, { type: 'tabChanged', tab: 'messages' });
      assert.equal(backToMessages.structured.priority, '');
      assert.deepEqual(backToMessages.structured.assignees, []);
    });

    it('does not reset rank when re-selecting the same tab', () => {
      const ranked = apply(initial, { rankProfile: 'personalized' });
      const same = searchReducer(ranked, { type: 'tabChanged', tab: 'chats' });

      assert.equal(same, ranked);
      assert.equal(same.rankProfile, 'personalized');
    });
  });

  describe('bot and exact mode toggles', () => {
    it('toggles include bot messages', () => {
      const on = searchReducer(initial, { type: 'includeBotMessagesToggled' });
      const off = searchReducer(on, { type: 'includeBotMessagesToggled' });

      assert.equal(on.includeBotMessages, true);
      assert.equal(off.includeBotMessages, false);
    });

    it('toggles exact match', () => {
      const on = searchReducer(initial, { type: 'exactMatchToggled' });
      const off = searchReducer(on, { type: 'exactMatchToggled' });

      assert.equal(on.exactMatch, true);
      assert.equal(off.exactMatch, false);
    });

    it('turns exact match on when the user types quotes', () => {
      const state = searchReducer(initial, {
        type: 'queryCommitted',
        query: '"payment failed"',
      });

      assert.equal(state.exactMatch, true);
      assert.equal(state.query, '"payment failed"');
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
      { type: 'includeBotMessagesToggled' },
      { type: 'exactMatchToggled' },
      {
        type: 'structuredApplied',
        structured: DEFAULT_STRUCTURED_FILTERS,
        chips: [chip('u1')],
        onlyMyChannels: true,
        sortBy: 'newest',
        rankProfile: 'personalized',
      },
    );

    it('empties the query, the chips and the trigger together', () => {
      const state = searchReducer(busy, { type: 'cleared' });

      assert.equal(state.query, '');
      assert.deepEqual(state.chips, []);
      assert.equal(state.trigger, null);
    });

    it('keeps the tab, mode toggles, and page-level sort/rank', () => {
      const state = searchReducer(busy, { type: 'cleared' });

      assert.equal(state.tab, 'files');
      assert.equal(state.onlyMyChannels, true);
      assert.equal(state.includeBotMessages, true);
      assert.equal(state.exactMatch, true);
      // Sort/Rank are Filters-drawer page controls; the search-bar clear leaves them.
      assert.equal(state.sortBy, 'newest');
      assert.equal(state.rankProfile, 'personalized');
    });
  });
});
