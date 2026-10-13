import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEFAULT_STRUCTURED_FILTERS } from '@/src/features/global-search/utils/filter-model';
import {
  canOpenFiltersSheet,
  clearInapplicableStructured,
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

function fieldIds(docType: Parameters<typeof modalFieldEntries>[0]): string[] {
  return modalFieldEntries(docType)
    .map(entry => entry.id)
    .filter(id => id !== 'sort' && id !== 'rank');
}

describe('global search filter registry', () => {
  it('maps mobile tabs onto dashboard doc types', () => {
    assert.equal(docTypeForTab('messages'), 'messages');
    assert.equal(docTypeForTab('tickets'), 'tickets');
    assert.equal(docTypeForTab('channels'), 'channels');
    assert.equal(docTypeForTab('chats'), 'people');
    assert.equal(docTypeForTab('calls'), 'messages');
    assert.equal(docTypeForTab('files'), 'files');
  });

  it('hides the Filters sheet on local Zero tabs', () => {
    assert.equal(canOpenFiltersSheet('messages'), true);
    assert.equal(canOpenFiltersSheet('files'), true);
    assert.equal(canOpenFiltersSheet('tickets'), true);
    assert.equal(canOpenFiltersSheet('calls'), true);
    assert.equal(canOpenFiltersSheet('chats'), false);
    assert.equal(canOpenFiltersSheet('channels'), false);
    assert.equal(modalDocTypeForTab('chats'), 'people');
    assert.equal(modalDocTypeForTab('channels'), 'channels');
  });

  it('matches the by-type modal field matrix (excluding Sort/Rank chrome)', () => {
    assert.deepEqual(fieldIds('messages'), [
      'from',
      'in',
      'with',
      'mentions',
      'date',
      'tags',
      'entity',
    ]);
    assert.deepEqual(fieldIds('files'), ['from', 'in', 'date']);
    assert.deepEqual(fieldIds('tickets'), [
      'from',
      'in',
      'date',
      'assignee',
      'priority',
      'board',
      'tags',
      'entity',
      'showArchived',
    ]);
    assert.deepEqual(fieldIds('all'), [
      'from',
      'in',
      'with',
      'mentions',
      'date',
      'assignee',
      'priority',
      'board',
      'tags',
      'entity',
    ]);
    assert.deepEqual(fieldIds('desk'), ['from', 'in', 'date', 'showArchived']);
    assert.deepEqual(fieldIds('channels'), []);
    assert.deepEqual(fieldIds('people'), []);
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
    assert.equal(filters.docType, 'messages');
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

  it('excludes From / In from the badge (hidden: false)', () => {
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
      rankProfile: '',
    });

    // Sort only — From/In and @Ch are not badge-counted.
    assert.equal(countActiveFilters(filters), 1);
  });

  it('counts ticket modal filters without message-only With', () => {
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

    // With does not apply to tickets; Priority / Tags do.
    assert.equal(countActiveFilters(filters), 2);
  });

  it('clearInapplicableStructured drops ticket fields on messages', () => {
    const cleared = clearInapplicableStructured(
      'messages',
      {
        ...DEFAULT_STRUCTURED_FILTERS,
        priority: 'HIGH',
        assignees: [{ id: 'u1', label: 'Ada' }],
        boards: [{ id: 'b1', label: 'Platform' }],
        withUsers: [{ id: 'u2', label: 'Bob' }],
      },
      [{ id: 'u9', label: 'From', prefix: 'from:', entityType: 'user' }],
    );

    assert.equal(cleared.structured.priority, '');
    assert.deepEqual(cleared.structured.assignees, []);
    assert.deepEqual(cleared.structured.boards, []);
    assert.deepEqual(cleared.structured.withUsers, [{ id: 'u2', label: 'Bob' }]);
    assert.equal(cleared.chips.length, 1);
  });

  it('clearInapplicableStructured drops from/in chips on local tabs', () => {
    const cleared = clearInapplicableStructured(
      'channels',
      {
        ...DEFAULT_STRUCTURED_FILTERS,
        withUsers: [{ id: 'u2', label: 'Bob' }],
        dateRange: 'last 7 days',
      },
      [
        { id: 'u9', label: 'From', prefix: 'from:', entityType: 'user' },
        { id: 'c1', label: 'eng', prefix: 'in:', entityType: 'channel' },
      ],
    );

    assert.equal(cleared.chips.length, 0);
    assert.deepEqual(cleared.structured.withUsers, []);
    assert.equal(cleared.structured.dateRange, '');
  });
});
