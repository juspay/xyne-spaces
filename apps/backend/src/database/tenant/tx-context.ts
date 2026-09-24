import { AsyncLocalStorage } from 'async_hooks';

/**
 * The active interactive-transaction client for the current async context —
 * set by the audit extension's $transaction hook when code runs inside
 * db.$transaction(async tx => ...).
 *
 * Non-query extensions (audit trail) route their own reads/writes through this
 * client, so their persistence commits or rolls back together with the
 * caller's transaction instead of escaping onto the root client.
 *
 * NOTE: batch-style db.$transaction([...]) registers nothing — those writes
 * stay outside any transaction (documented limitation).
 */
const transactionStorage = new AsyncLocalStorage<unknown>();

export const getTransactionClient = (): unknown | undefined => transactionStorage.getStore();

/** Wrap an interactive-transaction callback so extensions see its client. */
export const watchTransactionFn = (fn: (tx: unknown) => unknown): ((tx: unknown) => unknown) => {
  return (tx: unknown) => transactionStorage.run(tx, () => fn(tx));
};
