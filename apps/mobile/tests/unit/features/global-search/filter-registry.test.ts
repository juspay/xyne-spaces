import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEFAULT_STRUCTURED_FILTERS } from '@/src/features/global-search/utils/filter-model';
import {
  countActiveFilters,
  docTypeForTab,
  modalDocTypeForTab,
  modalFieldEntries,
  toSearchResultsFilters,
} from '@/src/features/global-search/utils/filter-registry';
import {
  DEFAULT_RANK_PROFILE,
  DEFAULT_SORT_BY,
} from '@/src/features/global-search/utils/rank-sort';

describe('global search filter registry', () => {
  it('maps mobile tabs onto dashboard doc types', () => {
    assert.equal(docTypeForTab('messages'), 'messages');
    assert.equal(docTypeForTab('tickets'), 'tickets');
    assert.equal(docTypeForTab('channels'), 'channels');
    assert.equal(docTypeForTab('chats'), 'people');
    assert.equal(docTypeForTab('calls'), 'messages');
  });

  it('always opens the Filters drawer as dashboard Type=All with Sort/Rank first', () => {
    assert.equal(modalDocTypeForTab('chats'), 'all');
    assert.equal(modalDocTypeForTab('channels'), 'all');
    assert.equal(modalDocTypeForTab('messages'), 'all');

    const entries = modalFieldEntries('all');
    const ids = entries.map(entry => entry.id);
    assert.deepEqual(ids, [
      'sort',
      'rank',
      'from',
      'in',
      'onlyMyChannels',
      'with',
      'mentions',
      'date',
      'assignee',
      'priority',
      'board',
      'tags',
      'entity',
    ]);

    assert.equal(entries.find(entry => entry.id === 'sort')?.control?.kind, 'sort');
    assert.equal(entries.find(entry => entry.id === 'rank')?.control?.kind, 'rank');
  });

  it('defaults sort/rank when building the Filters snapshot', () => {
    const filters = toSearchResultsFilters({
      tab: 'messages',
      chips: [],
      structured: DEFAULT_STRUCTURED_FILTERS,
      onlyMyChannels: false,
      includeBotMessages: false,
      exactMatch: false,
    });

    assert.equal(filters.sortBy, DEFAULT_SORT_BY);
    assert.equal(filters.rankProfile, DEFAULT_RANK_PROFILE);
    assert.equal(countActiveFilters(filters), 0);
  });

  it('does not count default Relevance / default rank in the badge', () => {
    const filters = toSearchResultsFilters({
      tab: 'messages',
      chips: [],
      structured: DEFAULT_STRUCTURED_FILTERS,
      onlyMyChannels: false,
      includeBotMessages: false,
      exactMatch: false,
      sortBy: 'relevance',
      rankProfile: '',
    });

    assert.equal(countActiveFilters(filters), 0);
  });

  it('counts Sort alone when Newest/Oldest is selected', () => {
    const filters = toSearchResultsFilters({
      tab: 'messages',
      chips: [],
      structured: DEFAULT_STRUCTURED_FILTERS,
      onlyMyChannels: false,
      includeBotMessages: false,
      exactMatch: false,
      sortBy: 'oldest',
      rankProfile: '',
    });

    assert.equal(countActiveFilters(filters), 1);
    assert.ok(filters.sortBy === 'oldest');
  });

  it('counts Rank alone when a non-default profile is selected', () => {
    const filters = toSearchResultsFilters({
      tab: 'messages',
      chips: [],
      structured: DEFAULT_STRUCTURED_FILTERS,
      onlyMyChannels: false,
      includeBotMessages: false,
      exactMatch: false,
      sortBy: 'relevance',
      rankProfile: 'personalized',
    });

    assert.equal(countActiveFilters(filters), 1);
  });

  it('counts From, In, Only my channels, Sort, and Rank in the Filters badge', () => {
    const filters = toSearchResultsFilters({
      tab: 'messages',
      chips: [
        { id: 'u1', label: 'Ada', prefix: 'from:', entityType: 'user' },
        { id: 'c1', label: 'eng', prefix: 'in:', entityType: 'channel' },
      ],
      structured: DEFAULT_STRUCTURED_FILTERS,
      onlyMyChannels: true,
      includeBotMessages: false,
      exactMatch: false,
      sortBy: 'newest',
      rankProfile: 'personalized',
    });

    assert.equal(countActiveFilters(filters), 5);
  });

  it('counts modal-only filters in the badge', () => {
    const filters = toSearchResultsFilters({
      tab: 'tickets',
      chips: [],
      structured: {
        ...DEFAULT_STRUCTURED_FILTERS,
        priority: 'HIGH',
        tags: ['billing'],
        withUsers: [{ id: 'u1', label: 'Ada' }],
      },
      onlyMyChannels: false,
      includeBotMessages: false,
      exactMatch: false,
    });

    // showArchived does not apply to Type=All; With / Priority / Tags do.
    assert.equal(countActiveFilters(filters), 3);
  });
});
