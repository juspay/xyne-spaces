import type { LogEntry } from '../types';

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

export class BoundedLogQueue {
  private readonly capacity: number;
  private readonly entries: LogEntry[] = [];

  private droppedCount = 0;

  constructor(capacity: number) {
    if (!isPositiveInteger(capacity)) {
      throw new RangeError('BoundedLogQueue capacity must be a positive integer.');
    }

    this.capacity = capacity;
  }

  get size(): number {
    return this.entries.length;
  }

  get droppedEntryCount(): number {
    return this.droppedCount;
  }

  enqueue(entry: LogEntry): void {
    this.entries.push(entry);
    this.trimToCapacity();
  }

  takeBatch(maximumBatchSize: number): readonly LogEntry[] {
    if (!isPositiveInteger(maximumBatchSize)) {
      throw new RangeError('Maximum batch size must be a positive integer.');
    }

    return this.entries.splice(0, maximumBatchSize);
  }

  restoreBatch(batch: readonly LogEntry[]): void {
    if (batch.length === 0) {
      return;
    }

    this.entries.unshift(...batch);
    this.trimToCapacity();
  }

  private trimToCapacity(): void {
    const overflowCount = this.entries.length - this.capacity;

    if (overflowCount <= 0) {
      return;
    }

    this.entries.splice(0, overflowCount);
    this.droppedCount += overflowCount;
  }
}
