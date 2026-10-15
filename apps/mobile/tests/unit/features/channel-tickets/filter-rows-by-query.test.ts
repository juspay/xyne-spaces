import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TicketPriority, TicketStatusV2 } from '@xyne/shared';

import {
  channelTicketRowMatchesQuery,
  filterChannelTicketRowsByQuery,
  mergeChannelTicketSearchRows,
  normalizeTicketSearchQuery,
} from '@/src/features/channel-tickets/utils/filter-rows-by-query';
import type { ChannelTicketRow } from '@/src/features/channel-tickets/types';

const row = (overrides: Partial<ChannelTicketRow> = {}): ChannelTicketRow => ({
  id: 't-1',
  xyneId: 'UPI-1',
  title: 'Fix payment retry',
  conversationId: 'c-1',
  channelId: 'ch-1',
  boardId: 'b-1',
  statusV2: TicketStatusV2.STARTED,
  priority: TicketPriority.HIGH,
  stageName: 'In Progress',
  assignee: null,
  eta: null,
  createdAt: 1,
  createdAtLabel: 'Jan 1, 2026',
  ageLabel: '1d',
  dueDateLabel: '—',
  isDueUrgent: false,
  ...overrides,
});

describe('normalizeTicketSearchQuery', () => {
  it('trims and lower-cases, empty for nothing', () => {
    assert.equal(normalizeTicketSearchQuery('  Retry '), 'retry');
    assert.equal(normalizeTicketSearchQuery('   '), '');
    assert.equal(normalizeTicketSearchQuery(null), '');
  });
});

describe('channelTicketRowMatchesQuery', () => {
  it('matches title, human id, stage, status label and priority (case-insensitive)', () => {
    const r = row();
    assert.equal(channelTicketRowMatchesQuery(r, 'payment'), true);
    assert.equal(channelTicketRowMatchesQuery(r, 'upi-1'), true);
    assert.equal(channelTicketRowMatchesQuery(r, 'progress'), true);
    assert.equal(channelTicketRowMatchesQuery(r, 'started'), true);
    assert.equal(channelTicketRowMatchesQuery(r, 'high'), true);
    assert.equal(channelTicketRowMatchesQuery(r, 'webhook'), false);
  });

  it('an empty query matches everything', () => {
    assert.equal(channelTicketRowMatchesQuery(row(), ''), true);
  });
});

describe('filterChannelTicketRowsByQuery', () => {
  const rows = [
    row({ id: 'a', title: 'Fix payment retry' }),
    row({ id: 'b', title: 'Rotate webhook' }),
  ];

  it('returns a copy when the query is blank', () => {
    const result = filterChannelTicketRowsByQuery(rows, '  ');
    assert.deepEqual(
      result.map(r => r.id),
      ['a', 'b'],
    );
    assert.notEqual(result, rows);
  });

  it('keeps only matching rows', () => {
    assert.deepEqual(
      filterChannelTicketRowsByQuery(rows, 'WEBHOOK').map(r => r.id),
      ['b'],
    );
  });
});

describe('mergeChannelTicketSearchRows', () => {
  const loaded = [row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' })];
  const hydrated = [row({ id: 'z' })];

  it('local matches first, then server hits from the window, then hydrated rows', () => {
    const merged = mergeChannelTicketSearchRows([loaded[0]!], ['z', 'c', 'a'], loaded, hydrated);
    assert.deepEqual(
      merged.map(r => r.id),
      ['a', 'z', 'c'],
    );
  });

  it('skips server ids that are neither loaded nor hydrated yet', () => {
    const merged = mergeChannelTicketSearchRows([], ['missing', 'b'], loaded, []);
    assert.deepEqual(
      merged.map(r => r.id),
      ['b'],
    );
  });

  it('never duplicates a row', () => {
    const merged = mergeChannelTicketSearchRows([loaded[1]!], ['b', 'b'], loaded, []);
    assert.deepEqual(
      merged.map(r => r.id),
      ['b'],
    );
  });
});
