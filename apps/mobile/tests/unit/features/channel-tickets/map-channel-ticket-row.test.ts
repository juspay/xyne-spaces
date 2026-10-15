import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BaseTicketType, TicketPriority, TicketStatusV2 } from '@xyne/shared';

import {
  filterChannelTicketRowsByBoard,
  isHiddenChannelTicket,
  mapChannelTicketRow,
  mapChannelTicketRows,
  type ChannelTicketSourceRow,
} from '@/src/features/channel-tickets/utils/map-channel-ticket-row';

const DAY_MS = 86_400_000;
// Fixed "now": 2026-09-04T12:00:00 local.
const NOW = new Date(2026, 8, 4, 12, 0, 0).getTime();

const source = (overrides: Partial<ChannelTicketSourceRow> = {}): ChannelTicketSourceRow => ({
  id: 't-1',
  xyneId: 'UPI-1',
  title: 'Fix payment retry',
  conversationId: 'c-1',
  channelId: 'ch-1',
  boardId: 'b-1',
  statusV2: TicketStatusV2.STARTED,
  priority: TicketPriority.HIGH,
  stageName: 'In Progress',
  assignedTo: 'user:u-1',
  eta: NOW - 3 * DAY_MS,
  createdAt: NOW - 12 * DAY_MS,
  isArchived: false,
  ticketType: null,
  ...overrides,
});

describe('mapChannelTicketRow', () => {
  it('maps fields and pre-formats display strings', () => {
    const row = mapChannelTicketRow(source(), { now: NOW });
    assert.equal(row.id, 't-1');
    assert.equal(row.xyneId, 'UPI-1');
    assert.equal(row.title, 'Fix payment retry');
    assert.equal(row.boardId, 'b-1');
    assert.equal(row.statusV2, TicketStatusV2.STARTED);
    assert.equal(row.priority, TicketPriority.HIGH);
    assert.equal(row.stageName, 'In Progress');
    assert.deepEqual(row.assignee, { kind: 'user', id: 'u-1' });
    assert.equal(row.ageLabel, '12d');
    assert.equal(row.createdAtLabel, 'Aug 23, 2026');
    assert.equal(row.dueDateLabel, 'Sep 1, 2026');
    assert.equal(row.isDueUrgent, true);
  });

  it('falls back for missing xyneId, title, stage, assignee, eta', () => {
    const row = mapChannelTicketRow(
      source({ xyneId: null, title: '  ', stageName: '', assignedTo: null, eta: null }),
      { now: NOW },
    );
    assert.equal(row.xyneId, 't-1');
    assert.equal(row.title, 'Untitled ticket');
    assert.equal(row.stageName, null);
    assert.equal(row.assignee, null);
    assert.equal(row.eta, null);
    assert.equal(row.dueDateLabel, '—');
    assert.equal(row.isDueUrgent, false);
  });

  it('is not urgent when overdue but completed', () => {
    const row = mapChannelTicketRow(source({ statusV2: TicketStatusV2.COMPLETED }), {
      now: NOW,
    });
    assert.equal(row.isDueUrgent, false);
  });
});

describe('isHiddenChannelTicket', () => {
  it('hides archived rows', () => {
    assert.equal(isHiddenChannelTicket(source({ isArchived: true })), true);
  });

  it('hides desk (Support) tickets', () => {
    assert.equal(isHiddenChannelTicket(source({ ticketType: BaseTicketType.Support })), true);
  });

  it('keeps regular rows, including null ticketType', () => {
    assert.equal(isHiddenChannelTicket(source()), false);
    assert.equal(isHiddenChannelTicket(source({ ticketType: 'Bug' })), false);
  });
});

describe('mapChannelTicketRows', () => {
  it('drops hidden rows, de-duplicates by id, keeps server order', () => {
    const rows = mapChannelTicketRows(
      [
        source({ id: 'a' }),
        source({ id: 'b', isArchived: true }),
        source({ id: 'c', ticketType: BaseTicketType.Support }),
        source({ id: 'a' }),
        source({ id: 'd' }),
      ],
      { now: NOW },
    );
    assert.deepEqual(
      rows.map(r => r.id),
      ['a', 'd'],
    );
  });

  it('returns an empty array for null / undefined input', () => {
    assert.deepEqual(mapChannelTicketRows(null, { now: NOW }), []);
    assert.deepEqual(mapChannelTicketRows(undefined, { now: NOW }), []);
  });
});

describe('filterChannelTicketRowsByBoard', () => {
  const rows = mapChannelTicketRows(
    [source({ id: 'a', boardId: 'b-1' }), source({ id: 'b', boardId: 'b-2' })],
    { now: NOW },
  );

  it('returns a copy when no board is selected', () => {
    const result = filterChannelTicketRowsByBoard(rows, []);
    assert.deepEqual(
      result.map(r => r.id),
      ['a', 'b'],
    );
    assert.notEqual(result, rows);
  });

  it('keeps only rows on the selected boards', () => {
    assert.deepEqual(
      filterChannelTicketRowsByBoard(rows, ['b-2']).map(r => r.id),
      ['b'],
    );
  });
});
