import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { decideDateUpdate } from '@/src/screens/ticket-details/date-update-decision';
import {
  buildBoardOptions,
  buildLabelOptions,
  buildStageStatusOptions,
  buildTicketTypeOptions,
  buildUserGroupOptions,
} from '@/src/screens/ticket-details/picker-options';
import {
  firstNonEmptyId,
  resolveEffectiveTicketId,
} from '@/src/screens/ticket-details/resolve-ticket-ids';
import {
  buildTicketTagV2DeleteArgs,
  diffLabelConfirmChanges,
  mapAppliedLabels,
} from '@/src/screens/ticket-details/ticket-labels';
import { countThreadUnreadActivities } from '@/src/screens/ticket-details/thread-unread';
import { ActivityClassification } from '@xyne/shared';

describe('picker-options', () => {
  it('builds unique stage status options', () => {
    assert.deepEqual(
      buildStageStatusOptions([
        { name: 'Todo' },
        { name: ' Todo ' },
        { name: 'Doing' },
        { name: '' },
      ]),
      [
        { value: 'Todo', label: 'Todo' },
        { value: 'Doing', label: 'Doing' },
      ],
    );
  });

  it('keeps an unknown selected ticket type visible', () => {
    assert.deepEqual(buildTicketTypeOptions([{ value: 'Bug' }], 'Legacy'), [
      { value: 'Legacy', label: 'Legacy' },
      { value: 'Bug', label: 'Bug' },
    ]);
  });

  it('builds board and label options', () => {
    assert.deepEqual(
      buildBoardOptions([
        { id: 'b1', name: 'Main' },
        { id: '', name: 'x' },
      ]),
      [{ value: 'b1', label: 'Main' }],
    );
    assert.deepEqual(
      buildLabelOptions([{ name: 'alpha' }], ['Alpha', 'beta']).map(o => o.value),
      ['alpha', 'beta'],
    );
  });

  it('builds active user group options and skips blank or inactive rows', () => {
    assert.deepEqual(
      buildUserGroupOptions([
        { id: 'g1', name: 'Platform', isActive: true },
        { id: 'g2', name: 'Inactive', isActive: false },
        { id: '', name: 'No id' },
        { id: 'g3', name: '  ' },
        { id: 'g4', name: ' Support ', isActive: undefined },
      ]),
      [
        { value: 'g1', label: 'Platform' },
        { value: 'g4', label: 'Support' },
      ],
    );
    assert.deepEqual(buildUserGroupOptions(null), []);
  });
});

describe('ticket-labels', () => {
  it('maps applied labels and diffs confirm changes', () => {
    const applied = mapAppliedLabels([
      { id: 'm1', tagName: 'Bug' },
      { id: '', tagName: 'skip' },
      { id: 'm2', tagName: '  Pay  ' },
    ]);
    assert.deepEqual(applied, [
      { mappingId: 'm1', name: 'Bug' },
      { mappingId: 'm2', name: 'Pay' },
    ]);

    const diff = diffLabelConfirmChanges(applied, ['Pay', 'New', 'pay']);
    assert.deepEqual(
      diff.removals.map(r => r.mappingId),
      ['m1'],
    );
    assert.deepEqual(diff.additions, ['New']);
  });

  it('builds ticketTagV2.delete args from mappingId only (legacy tagId resolved in mutator)', () => {
    // mapping.tagId is project_tags.id and must NOT be used as delete.tagId.
    // Shared mutator resolves legacy ticket_tags by mapping ticketId + name.
    assert.deepEqual(buildTicketTagV2DeleteArgs('mapping-abc'), {
      tagId: 'mapping-abc',
      mappingId: 'mapping-abc',
    });
    assert.deepEqual(buildTicketTagV2DeleteArgs('  mapping-abc  '), {
      tagId: 'mapping-abc',
      mappingId: 'mapping-abc',
    });
  });
});

describe('resolve-ticket-ids', () => {
  it('prefers the route ticket id', () => {
    assert.equal(
      resolveEffectiveTicketId({
        ticketId: 'route',
        fallbackTicketId: 'fb',
        fallbackConversationTicketId: 'conv',
        fallbackTicketMdId: 'md',
      }),
      'route',
    );
    assert.equal(
      resolveEffectiveTicketId({
        ticketId: '',
        fallbackTicketId: '',
        fallbackConversationTicketId: 'conv',
      }),
      'conv',
    );
    assert.equal(firstNonEmptyId('', '  ', 'c1', 'c2'), 'c1');
  });
});

describe('decideDateUpdate', () => {
  const now = new Date(2024, 8, 17, 12, 0, 0).getTime();

  it('no-ops same minute and null next values', () => {
    const current = now + 30_000;
    assert.equal(decideDateUpdate({ currentMs: current, nextMs: current + 10_000, now }), 'noop');
    assert.equal(decideDateUpdate({ currentMs: current, nextMs: null, now }), 'noop');
  });

  it('rejects past picks and applies future ones', () => {
    assert.equal(decideDateUpdate({ currentMs: null, nextMs: now - 60_000, now }), 'reject_past');
    assert.equal(decideDateUpdate({ currentMs: null, nextMs: now + 60_000, now }), 'apply');
  });
});

describe('countThreadUnreadActivities', () => {
  it('counts thread unread for the ticket or conversation and skips SKIP', () => {
    assert.equal(countThreadUnreadActivities(null, { ticketId: 't1', conversationId: 'c1' }), 0);
    assert.equal(
      countThreadUnreadActivities(
        [
          {
            isThreadActivity: true,
            classification: ActivityClassification.PENDING,
            ticketId: 't1',
          },
          {
            isThreadActivity: true,
            classification: ActivityClassification.SKIP,
            ticketId: 't1',
          },
          {
            isThreadActivity: true,
            classification: ActivityClassification.PENDING,
            conversationId: 'c1',
          },
          {
            isThreadActivity: false,
            classification: ActivityClassification.PENDING,
            ticketId: 't1',
          },
          {
            isThreadActivity: true,
            classification: ActivityClassification.PENDING,
            ticketId: 'other',
            conversationId: 'other',
          },
        ],
        { ticketId: 't1', conversationId: 'c1' },
      ),
      2,
    );
  });
});
