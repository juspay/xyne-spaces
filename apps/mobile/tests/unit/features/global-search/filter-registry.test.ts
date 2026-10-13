import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEFAULT_STRUCTURED_FILTERS } from '@/src/features/global-search/utils/filter-model';
import {
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

describe('global search filter registry', () => {
  it('maps mobile tabs onto dashboard doc types', () => {
    assert.equal(docTypeForTab('messages'), 'messages');
    assert.equal(docTypeForTab('tickets'), 'tickets');
    assert.equal(docTypeForTab('channels'), 'channels');
    assert.equal(docTypeForTab('chats'), 'people');
    assert.equal(docTypeForTab('calls'), 'messages');
  });

  it('opens the Filters drawer with fields for the active tab only', () => {
    assert.equal(modalDocTypeForTab('messages'), 'messages');
    assert.equal(modalDocTypeForTab('tickets'), 'tickets');
    // Local tabs fall back to messages so the drawer is not empty from DMs.
    assert.equal(modalDocTypeForTab('chats'), 'messages');
    assert.equal(modalDocTypeForTab('channels'), 'messages');

    const messageIds = modalFieldEntries('messages').map(entry => entry.id);
    assert.ok(messageIds.includes('from'));
    assert.ok(messageIds.includes('with'));
    assert.ok(messageIds.includes('mentions'));
    assert.ok(!messageIds.includes('assignee'));
    assert.ok(!messageIds.includes('board'));
    assert.ok(!messageIds.includes('priority'));

    const ticketIds = modalFieldEntries('tickets').map(entry => entry.id);
    assert.ok(ticketIds.includes('assignee'));
    assert.ok(ticketIds.includes('board'));
    assert.ok(ticketIds.includes('priority'));
    assert.ok(!ticketIds.includes('with'));
    assert.ok(!ticketIds.includes('mentions'));
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

  it('counts From, In, Only my channels, and Sort in the Filters badge', () => {
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

    assert.equal(countActiveFilters(filters), 4);
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
});
