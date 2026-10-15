import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import type { TicketListItemData } from '@/src/features/xyne-desks/tickets/types';
import {
  clearTicketsPaintCache,
  getTicketsPaintCache,
  removeTicketsFromPaintCache,
  setTicketsPaintCache,
} from '@/src/features/xyne-desks/tickets/utils/tickets-list-paint-cache';

const ticket = (id: string): TicketListItemData => ({ id }) as unknown as TicketListItemData;

beforeEach(() => {
  // The cache is module-level; reset it so tests do not leak into each other.
  clearTicketsPaintCache();
});

describe('getTicketsPaintCache', () => {
  it('returns an empty array for an unknown key', () => {
    assert.deepEqual(getTicketsPaintCache('s1', 'c1'), []);
  });

  it('returns an empty array when session or channel is missing', () => {
    assert.deepEqual(getTicketsPaintCache('', 'c1'), []);
    assert.deepEqual(getTicketsPaintCache('s1', ''), []);
  });
});

describe('setTicketsPaintCache', () => {
  it('stores items keyed by session and channel', () => {
    setTicketsPaintCache('s1', 'c1', [ticket('t1'), ticket('t2')]);
    assert.deepEqual(
      getTicketsPaintCache('s1', 'c1').map(t => t.id),
      ['t1', 't2'],
    );
    assert.deepEqual(getTicketsPaintCache('s1', 'c2'), []);
  });

  it('ignores empty item lists and missing keys', () => {
    setTicketsPaintCache('s1', 'c1', []);
    assert.deepEqual(getTicketsPaintCache('s1', 'c1'), []);
    setTicketsPaintCache('', 'c1', [ticket('t1')]);
    assert.deepEqual(getTicketsPaintCache('', 'c1'), []);
  });
});

describe('removeTicketsFromPaintCache', () => {
  it('drops the named tickets while keeping the rest', () => {
    setTicketsPaintCache('s1', 'c1', [ticket('t1'), ticket('t2'), ticket('t3')]);
    removeTicketsFromPaintCache('s1', 'c1', ['t2']);
    assert.deepEqual(
      getTicketsPaintCache('s1', 'c1').map(t => t.id),
      ['t1', 't3'],
    );
  });

  it('clears the key entirely when all tickets are removed', () => {
    setTicketsPaintCache('s1', 'c1', [ticket('t1')]);
    removeTicketsFromPaintCache('s1', 'c1', ['t1']);
    assert.deepEqual(getTicketsPaintCache('s1', 'c1'), []);
  });

  it('is a no-op for empty id lists', () => {
    setTicketsPaintCache('s1', 'c1', [ticket('t1')]);
    removeTicketsFromPaintCache('s1', 'c1', []);
    assert.deepEqual(
      getTicketsPaintCache('s1', 'c1').map(t => t.id),
      ['t1'],
    );
  });
});

describe('clearTicketsPaintCache', () => {
  it('clears a single session+channel entry', () => {
    setTicketsPaintCache('s1', 'c1', [ticket('t1')]);
    setTicketsPaintCache('s1', 'c2', [ticket('t2')]);
    clearTicketsPaintCache('s1', 'c1');
    assert.deepEqual(getTicketsPaintCache('s1', 'c1'), []);
    assert.deepEqual(
      getTicketsPaintCache('s1', 'c2').map(t => t.id),
      ['t2'],
    );
  });

  it('clears all channels for a session when no channel is given', () => {
    setTicketsPaintCache('s1', 'c1', [ticket('t1')]);
    setTicketsPaintCache('s1', 'c2', [ticket('t2')]);
    setTicketsPaintCache('s2', 'c1', [ticket('t3')]);
    clearTicketsPaintCache('s1');
    assert.deepEqual(getTicketsPaintCache('s1', 'c1'), []);
    assert.deepEqual(getTicketsPaintCache('s1', 'c2'), []);
    assert.deepEqual(
      getTicketsPaintCache('s2', 'c1').map(t => t.id),
      ['t3'],
    );
  });

  it('clears everything when called with no arguments', () => {
    setTicketsPaintCache('s1', 'c1', [ticket('t1')]);
    setTicketsPaintCache('s2', 'c2', [ticket('t2')]);
    clearTicketsPaintCache();
    assert.deepEqual(getTicketsPaintCache('s1', 'c1'), []);
    assert.deepEqual(getTicketsPaintCache('s2', 'c2'), []);
  });
});
