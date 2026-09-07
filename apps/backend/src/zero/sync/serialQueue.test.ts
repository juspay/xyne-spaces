import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SerialQueue } from './serialQueue';

/** A promise plus its resolver — a manual gate for driving interleavings deterministically. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

test('same key: tasks run one at a time, in enqueue order', async () => {
  const q = new SerialQueue();
  const order: string[] = [];
  const g1 = deferred();

  // task A blocks on g1; B and C are enqueued behind it and must not start until A ends.
  q.enqueue('K', async () => {
    order.push('A:start');
    await g1.promise;
    order.push('A:end');
  });
  q.enqueue('K', async () => {
    order.push('B');
  });
  q.enqueue('K', async () => {
    order.push('C');
  });

  // Let microtasks settle: only A should have started.
  await Promise.resolve();
  assert.deepEqual(order, ['A:start']);

  g1.resolve();
  await q.drain();
  assert.deepEqual(order, ['A:start', 'A:end', 'B', 'C']);
});

test('different keys: tasks run concurrently', async () => {
  const q = new SerialQueue();
  const order: string[] = [];
  const gX = deferred();

  // X blocks; Y is a different key and must be able to finish while X is still blocked.
  q.enqueue('X', async () => {
    order.push('X:start');
    await gX.promise;
    order.push('X:end');
  });
  q.enqueue('Y', async () => {
    order.push('Y');
  });

  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(order, ['X:start', 'Y']); // Y ran despite X still blocked

  gX.resolve();
  await q.drain();
  assert.deepEqual(order, ['X:start', 'Y', 'X:end']);
});

test('a rejecting task does not poison the chain; onError is called', async () => {
  const errors: Array<{ key: string }> = [];
  const q = new SerialQueue((_error, key) => errors.push({ key }));
  const order: string[] = [];

  q.enqueue('K', async () => {
    throw new Error('boom');
  });
  q.enqueue('K', async () => {
    order.push('after-boom');
  });

  await q.drain();
  assert.deepEqual(order, ['after-boom']);
  assert.deepEqual(errors, [{ key: 'K' }]);
});

test('drain settles and the tail map empties', async () => {
  const q = new SerialQueue();
  q.enqueue('K', async () => {});
  q.enqueue('L', async () => {});
  await q.drain();
  assert.equal(q.activeKeys, 0);
});
