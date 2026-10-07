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

describe('global search filter registry', () => {
  it('maps mobile tabs onto dashboard doc types', () => {
    assert.equal(docTypeForTab('messages'), 'messages');
    assert.equal(docTypeForTab('tickets'), 'tickets');
    assert.equal(docTypeForTab('channels'), 'channels');
    assert.equal(docTypeForTab('chats'), 'people');
    assert.equal(docTypeForTab('calls'), 'messages');
  });

  it('always opens the Filters drawer as dashboard Type=All', () => {
    assert.equal(modalDocTypeForTab('chats'), 'all');
    assert.equal(modalDocTypeForTab('channels'), 'all');
    assert.equal(modalDocTypeForTab('messages'), 'all');

    const ids = modalFieldEntries('all').map(entry => entry.id);
    assert.deepEqual(ids, [
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
  });

  it('counts From, In, and Only my channels in the Filters badge', () => {
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
    });

    assert.equal(countActiveFilters(filters), 3);
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
