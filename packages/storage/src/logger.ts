import { shred } from "@xyne/logger";

export interface StorageLogger {
  info(message: string, ...meta: unknown[]): void;
  warn(message: string, ...meta: unknown[]): void;
  error(message: string, ...meta: unknown[]): void;
  debug?(message: string, ...meta: unknown[]): void;
}

// Serialise a call to ONE shredded JSON line. JSON.stringify escapes newlines/
// control chars, so a user value can't forge extra log lines (log injection),
// and shred() removes secret values. Hosts can inject their own logger via
// setStorageLogger; this is the safe default sink.
const toLine = (message: string, meta: unknown[]): string =>
  JSON.stringify(shred(meta.length > 0 ? { message, meta } : { message }));

const shreddingConsole: StorageLogger = {
  info: (message, ...meta) => console.info(toLine(message, meta)),
  warn: (message, ...meta) => console.warn(toLine(message, meta)),
  error: (message, ...meta) => console.error(toLine(message, meta)),
  debug: (message, ...meta) => console.debug(toLine(message, meta)),
};

export let logger: StorageLogger = shreddingConsole;

export function setStorageLogger(custom: StorageLogger): void {
  logger = custom;
}
