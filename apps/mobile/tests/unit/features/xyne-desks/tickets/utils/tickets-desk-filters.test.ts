import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { emptyTicketsDeskFilters } from '@/src/features/xyne-desks/tickets/utils/tickets-desk-filters';

describe('emptyTicketsDeskFilters', () => {
  it('clears every per-desk filter including folder', () => {
    assert.deepEqual(emptyTicketsDeskFilters(), {
      myTicketsOnly: false,
      assigneeIds: [],
      createdByIds: [],
      priorities: [],
      stageNames: [],
      hasAiDraft: false,
      hasSubTickets: false,
      aiCategories: [],
      generatedTags: [],
      userGroupIds: [],
      conversationLabelId: undefined,
      dynamicFields: {},
      lastUpdatedRange: {},
      dateRange: {},
      activeFolder: 'inbox',
    });
  });
});
