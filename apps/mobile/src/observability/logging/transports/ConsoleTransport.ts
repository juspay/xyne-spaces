import type { LogEntry } from '../types';
import type { LogTransport } from './LogTransport';

export class ConsoleTransport implements LogTransport {
  readonly name = 'console';

  write(entry: LogEntry): void {
    console.log(entry);
  }
}
