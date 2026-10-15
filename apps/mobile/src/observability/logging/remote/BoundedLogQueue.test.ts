import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { LogEntry } from '../types';
import { BoundedLogQueue } from './BoundedLogQueue';

const FIXED_TIMESTAMP = '2026-08-14T10:30:00.000Z';

function createEntry(event: string): LogEntry {
  return {
    timestamp: FIXED_TIMESTAMP,
    level: 'info',
    event,
    fields: {},
  };
}

describe('BoundedLogQueue', () => {
  it('takes the oldest entries first', () => {
    const queue = new BoundedLogQueue(5);

    queue.enqueue(createEntry('first'));
    queue.enqueue(createEntry('second'));
    queue.enqueue(createEntry('third'));

    const batch = queue.takeBatch(2);

    assert.deepEqual(
      batch.map(entry => entry.event),
      ['first', 'second'],
    );

    assert.equal(queue.size, 1);
  });

  it('drops the oldest entry when capacity is exceeded', () => {
    const queue = new BoundedLogQueue(2);

    queue.enqueue(createEntry('first'));
    queue.enqueue(createEntry('second'));
    queue.enqueue(createEntry('third'));

    const batch = queue.takeBatch(2);

    assert.deepEqual(
      batch.map(entry => entry.event),
      ['second', 'third'],
    );

    assert.equal(queue.droppedEntryCount, 1);
  });

  it('restores a failed batch before newer pending entries', () => {
    const queue = new BoundedLogQueue(5);

    queue.enqueue(createEntry('first'));
    queue.enqueue(createEntry('second'));

    const failedBatch = queue.takeBatch(2);

    queue.enqueue(createEntry('third'));
    queue.restoreBatch(failedBatch);

    const nextBatch = queue.takeBatch(5);

    assert.deepEqual(
      nextBatch.map(entry => entry.event),
      ['first', 'second', 'third'],
    );
  });

  it('rejects invalid capacities and batch sizes', () => {
    assert.throws(() => new BoundedLogQueue(0), RangeError);
    assert.throws(() => new BoundedLogQueue(-1), RangeError);
    assert.throws(() => new BoundedLogQueue(1.5), RangeError);

    const queue = new BoundedLogQueue(5);

    assert.throws(() => queue.takeBatch(0), RangeError);
    assert.throws(() => queue.takeBatch(-1), RangeError);
    assert.throws(() => queue.takeBatch(1.5), RangeError);
  });
});
