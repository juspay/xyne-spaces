import type { LogEntry } from '../types';
import type { LogTransport } from './LogTransport';

export class MemoryTransport implements LogTransport {
  readonly name = 'memory';

  private readonly entries: LogEntry[] = [];

  write(entry: LogEntry): void {
    this.entries.push(entry);
  }

  getEntries(): readonly LogEntry[] {
    return [...this.entries];
  }
}
