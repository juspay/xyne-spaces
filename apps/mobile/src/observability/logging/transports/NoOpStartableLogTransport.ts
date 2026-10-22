import type { LogEntry } from '../types';
import type { StartableLogTransport } from './LogTransport';

/**
 * Stand-in when remote logging is disabled. Keeps the lifecycle controller
 * wiring unchanged without opening network connections or flush timers.
 */
export class NoOpStartableLogTransport implements StartableLogTransport {
  readonly name = 'noop';

  write(_entry: LogEntry): void {
    // Remote logging is disabled; entries are not queued or sent.
  }

  start(): void {}

  stop(): void {}

  flush(): Promise<void> {
    return Promise.resolve();
  }
}
