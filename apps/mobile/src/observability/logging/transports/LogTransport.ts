import type { LogEntry } from '../types';

export interface LogTransport {
  readonly name: string;
  write(entry: LogEntry): void;
}

export interface FlushableLogTransport extends LogTransport {
  flush(): Promise<void>;
}

export interface StartableLogTransport extends FlushableLogTransport {
  start(): void;
  stop(): void;
}
