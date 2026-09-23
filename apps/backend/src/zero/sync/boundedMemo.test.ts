/** Byte-bounded LRU for the fan-out snapshot memos (node:test, env-free). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoundedMemo, estimateRowsBytes } from './boundedMemo';

test('entry cap: oldest evicted first, get() refreshes recency', () => {
  const m = new BoundedMemo<string>(2, 1_000_000);
  m.set('a', 'A', 1);
  m.set('b', 'B', 1);
  m.get('a'); // refresh a → b is now oldest
  m.set('c', 'C', 1);
  assert.equal(m.get('b'), undefined, 'LRU entry evicted');
  assert.equal(m.get('a'), 'A');
  assert.equal(m.get('c'), 'C');
  assert.equal(m.size, 2);
});

test('weight cap: evicts until within budget', () => {
  const m = new BoundedMemo<string>(100, 100);
  m.set('a', 'A', 60);
  m.set('b', 'B', 30);
  m.set('c', 'C', 30); // 120 > 100 → evict a (oldest)
  assert.equal(m.get('a'), undefined);
  assert.equal(m.totalWeight, 60);
});

test('oversized single entry is kept (evicting everything else), never thrashed', () => {
  const m = new BoundedMemo<string>(100, 100);
  m.set('a', 'A', 40);
  m.set('giant', 'G', 500); // bigger than the whole budget
  assert.equal(m.get('a'), undefined, 'others evicted');
  assert.equal(m.get('giant'), 'G', 'the giant itself is cached — one reconnect-storm read');
  assert.equal(m.size, 1);
});

test('overwrite replaces weight, delete releases it', () => {
  const m = new BoundedMemo<string>(10, 100);
  m.set('a', 'A1', 80);
  m.set('a', 'A2', 20); // replace, not accumulate
  assert.equal(m.totalWeight, 20);
  m.delete('a');
  assert.equal(m.totalWeight, 0);
  assert.equal(m.size, 0);
  m.delete('a'); // idempotent
  assert.equal(m.totalWeight, 0);
});

test('clear() empties entries and releases all weight', () => {
  const m = new BoundedMemo<string>(10, 100);
  m.set('a', 'A', 30);
  m.set('b', 'B', 40);
  m.clear();
  assert.equal(m.size, 0);
  assert.equal(m.totalWeight, 0);
  assert.equal(m.get('a'), undefined);
  m.set('c', 'C', 10); // usable after clear
  assert.equal(m.totalWeight, 10);
});

test('estimateRowsBytes: sampled estimate scales with row count', () => {
  const row = { tableName: 'conversations', row: { id: 'x'.repeat(100) } };
  const small = estimateRowsBytes([row]);
  const big = estimateRowsBytes(Array.from({ length: 1000 }, () => row));
  assert.ok(small > 100, `single row ≈ its JSON size, got ${small}`);
  assert.ok(Math.abs(big - small * 1000) / (small * 1000) < 0.05, 'linear in count');
  assert.equal(estimateRowsBytes([]), 0);
});
