import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  filterSupportTicketsByCreatedAt,
  filterSupportTicketsByLastEmailAt,
  mapSupportTicketsToListItems,
} from '@/src/features/xyne-desks/tickets/utils/map-support-tickets-to-list-items';

describe('filterSupportTicketsByCreatedAt', () => {
  const rows = [
    { id: 'a', createdAt: 100 },
    { id: 'b', createdAt: 200 },
    { id: 'c', createdAt: 300 },
  ];

  it('returns a copy of all rows when no bounds are given', () => {
    const out = filterSupportTicketsByCreatedAt(rows);
    assert.deepEqual(
      out.map(r => r.id),
      ['a', 'b', 'c'],
    );
    assert.notEqual(out, rows);
  });

  it('applies an inclusive lower bound', () => {
    const out = filterSupportTicketsByCreatedAt(rows, 200);
    assert.deepEqual(
      out.map(r => r.id),
      ['b', 'c'],
    );
  });

  it('applies an inclusive upper bound', () => {
    const out = filterSupportTicketsByCreatedAt(rows, undefined, 200);
    assert.deepEqual(
      out.map(r => r.id),
      ['a', 'b'],
    );
  });
});

describe('filterSupportTicketsByLastEmailAt', () => {
  const rows = [
    { id: 'a', lastEmailAt: 100 },
    { id: 'b', lastEmailAt: 200 },
    { id: 'c', lastEmailAt: 300 },
  ];

  it('returns a copy of all rows when no bounds are given', () => {
    const out = filterSupportTicketsByLastEmailAt(rows);
    assert.deepEqual(
      out.map(r => r.id),
      ['a', 'b', 'c'],
    );
    assert.notEqual(out, rows);
  });

  it('applies an inclusive lastEmailAt range', () => {
    const out = filterSupportTicketsByLastEmailAt(rows, 150, 250);
    assert.deepEqual(
      out.map(r => r.id),
      ['b'],
    );
  });
});

describe('mapSupportTicketsToListItems', () => {
  it('returns an empty array for null/undefined input', () => {
    assert.deepEqual(mapSupportTicketsToListItems(null), []);
    assert.deepEqual(mapSupportTicketsToListItems(undefined), []);
  });

  it('deduplicates by id, keeping the first occurrence', () => {
    const out = mapSupportTicketsToListItems([
      { id: 'x', title: 'First', lastEmailAt: 10 },
      { id: 'x', title: 'Dup', lastEmailAt: 10 },
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0]?.title, 'First');
  });

  it('hides archived tickets by default and includes them when asked', () => {
    const rows = [
      { id: 'a', title: 'Active' },
      { id: 'b', title: 'Archived', isArchived: true },
    ];
    assert.deepEqual(
      mapSupportTicketsToListItems(rows).map(t => t.id),
      ['a'],
    );
    assert.deepEqual(
      mapSupportTicketsToListItems(rows, { includeArchived: true })
        .map(t => t.id)
        .sort(),
      ['a', 'b'],
    );
  });

  it('marks a ticket unread when lastEmailAt is newer than the last read email', () => {
    const [item] = mapSupportTicketsToListItems([
      { id: 't', lastEmailAt: 500, emailReads: [{ lastReadEmailAt: 200 }] },
    ]);
    assert.equal(item?.isUnread, true);
  });

  it('marks a ticket read when the last read email is caught up', () => {
    const [item] = mapSupportTicketsToListItems([
      { id: 't', lastEmailAt: 500, emailReads: [{ lastReadEmailAt: 500 }] },
    ]);
    assert.equal(item?.isUnread, false);
  });

  it('marks a ticket starred from userMailbox overlay', () => {
    const [starred] = mapSupportTicketsToListItems([{ id: 's', userMailbox: [{ starred: true }] }]);
    const [plain] = mapSupportTicketsToListItems([{ id: 'p', userMailbox: [{ starred: false }] }]);
    assert.equal(starred?.isStarred, true);
    assert.equal(plain?.isStarred, false);
  });

  it('collapses whitespace and truncates the description into the snippet', () => {
    const [item] = mapSupportTicketsToListItems([{ id: 't', description: '  hello   world  ' }]);
    assert.equal(item?.snippet, 'hello world');
  });

  it('sorts by lastEmailAt descending, then by id descending', () => {
    const out = mapSupportTicketsToListItems([
      { id: 'a', lastEmailAt: 100 },
      { id: 'b', lastEmailAt: 300 },
      { id: 'c', lastEmailAt: 300 },
    ]);
    assert.deepEqual(
      out.map(t => t.id),
      ['c', 'b', 'a'],
    );
  });
});
