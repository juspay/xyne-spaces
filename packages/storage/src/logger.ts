export interface StorageLogger {
  info(message: string, ...meta: unknown[]): void;
  warn(message: string, ...meta: unknown[]): void;
  error(message: string, ...meta: unknown[]): void;
  debug?(message: string, ...meta: unknown[]): void;
}

export let logger: StorageLogger = console;

export function setStorageLogger(custom: StorageLogger): void {
  logger = custom;
}
