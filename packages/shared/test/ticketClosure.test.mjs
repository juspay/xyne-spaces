import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveTicketClosurePatch } from '../dist/tickets/closure.js';
import { TicketStatusV2 } from '../dist/zero/types.js';

const now = 1_700_000_000_000;

test('entering COMPLETED stamps closedAt/closedBy', () => {
  assert.deepEqual(deriveTicketClosurePatch(TicketStatusV2.STARTED, TicketStatusV2.COMPLETED, 'u1', now), { closedAt: now, closedBy: 'u1' });
});

test('COMPLETED -> COMPLETED (second Completed stage) leaves the first close untouched', () => {
  assert.deepEqual(deriveTicketClosurePatch(TicketStatusV2.COMPLETED, TicketStatusV2.COMPLETED, 'u2', now), {});
});

test('reopening out of COMPLETED clears both fields', () => {
  assert.deepEqual(deriveTicketClosurePatch(TicketStatusV2.COMPLETED, TicketStatusV2.STARTED, 'u1', now), { closedAt: null, closedBy: null });
  assert.deepEqual(deriveTicketClosurePatch(TicketStatusV2.COMPLETED, TicketStatusV2.CANCELLED, 'u1', now), { closedAt: null, closedBy: null });
});

test('no status change / non-completed moves / CANCELLED are no-ops', () => {
  assert.deepEqual(deriveTicketClosurePatch(TicketStatusV2.TODO, TicketStatusV2.STARTED, 'u1', now), {});
  assert.deepEqual(deriveTicketClosurePatch(TicketStatusV2.STARTED, TicketStatusV2.CANCELLED, 'u1', now), {});
  assert.deepEqual(deriveTicketClosurePatch(TicketStatusV2.STARTED, undefined, 'u1', now), {});
  assert.deepEqual(deriveTicketClosurePatch(TicketStatusV2.STARTED, null, 'u1', now), {});
});

test('works with Date (Prisma) values', () => {
  const d = new Date(now);
  assert.deepEqual(deriveTicketClosurePatch(null, TicketStatusV2.COMPLETED, 'u1', d), { closedAt: d, closedBy: 'u1' });
});
