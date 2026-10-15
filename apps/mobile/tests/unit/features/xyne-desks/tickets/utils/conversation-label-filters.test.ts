import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  filterTicketsByConversationLabel,
  hasConversationLabelsQuery,
  mapConversationLabelRowsToFilterOptions,
  resolveConversationLabelId,
  ticketMatchesConversationLabel,
  toggleSingleSelectDraft,
} from '@/src/features/xyne-desks/tickets/utils/conversation-label-filters';

describe('hasConversationLabelsQuery', () => {
  it('is false when the shared query is missing (pinned SHA)', () => {
    assert.equal(hasConversationLabelsQuery({}), false);
    assert.equal(hasConversationLabelsQuery({ conversationLabelsByChannelId: undefined }), false);
  });

  it('is true only when conversationLabelsByChannelId is a function', () => {
    assert.equal(
      hasConversationLabelsQuery({
        conversationLabelsByChannelId: () => undefined,
      }),
      true,
    );
  });
});

describe('mapConversationLabelRowsToFilterOptions', () => {
  it('maps label catalog rows and skips rows without an id', () => {
    assert.deepEqual(
      mapConversationLabelRowsToFilterOptions([
        { id: 'lbl-urgent', name: 'Urgent' },
        { id: '  ', name: 'Blank' },
        { id: 'lbl-none', name: '  ' },
      ]),
      [
        { id: 'lbl-urgent', label: 'Urgent' },
        { id: 'lbl-none', label: 'Untitled label' },
      ],
    );
  });
});

describe('filterTicketsByConversationLabel', () => {
  const labeled = {
    id: 't-labeled',
    conversationLabelMappings: [{ labelId: 'lbl-urgent' }],
  };
  const unlabeled = { id: 't-unlabeled', conversationLabelMappings: [] };
  const otherLabel = {
    id: 't-other',
    conversationLabelMappings: [{ labelId: 'lbl-other' }],
  };

  it('keeps a labeled ticket and drops unlabeled / other-label tickets', () => {
    const out = filterTicketsByConversationLabel([labeled, unlabeled, otherLabel], 'lbl-urgent');
    assert.deepEqual(
      out.map(row => row.id),
      ['t-labeled'],
    );
  });

  it('treats a ticket with no mappings as unlabeled', () => {
    assert.equal(ticketMatchesConversationLabel({ id: 't-bare' }, 'lbl-urgent'), false);
    assert.equal(ticketMatchesConversationLabel(unlabeled, 'lbl-urgent'), false);
    assert.equal(ticketMatchesConversationLabel(labeled, 'lbl-urgent'), true);
  });

  it('keeps every row when no label is selected', () => {
    const rows = [labeled, unlabeled];
    assert.deepEqual(
      filterTicketsByConversationLabel(rows, undefined).map(row => row.id),
      ['t-labeled', 't-unlabeled'],
    );
  });
});

describe('label single-select apply', () => {
  it('replaces the first label when a second is selected', () => {
    const afterFirst = toggleSingleSelectDraft([], 'lbl-a');
    const afterSecond = toggleSingleSelectDraft(afterFirst, 'lbl-b');
    assert.deepEqual(afterFirst, ['lbl-a']);
    assert.deepEqual(afterSecond, ['lbl-b']);
    assert.equal(resolveConversationLabelId(afterSecond), 'lbl-b');
  });

  it('persists only the last id when apply receives two selected labels', () => {
    assert.equal(resolveConversationLabelId(['lbl-a', 'lbl-b']), 'lbl-b');
    assert.equal(resolveConversationLabelId(['lbl-a', '  ', 'lbl-b']), 'lbl-b');
    assert.equal(resolveConversationLabelId([]), undefined);
  });
});
