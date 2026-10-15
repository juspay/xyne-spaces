import { AsyncLocalStorage } from 'node:async_hooks';
import { logger } from '@/utils/logger';
import { runAsSystem, runAsServiceActor } from '@/database/tenant/context';
import type { Prisma } from '@prisma/client';

/** A Prisma model name, e.g. 'Ticket', 'Channel'. Declared per bypass call so the log/audit
 *  trail states which tables a bypass touches, not just that one happened. */
export type TableName = Prisma.ModelName;

export type BypassKind = 'system' | 'service' | 'transaction' | 'raw';

export interface BypassMeta {
  kind: BypassKind;
  tables: TableName[];
  reason: string;
}

function recordBypass(meta: BypassMeta): void {
  logger.warn('[bypassAcl]', meta);
}

export function asSystem<T>(tables: TableName[], reason: string, fn: () => Promise<T>): Promise<T> {
  recordBypass({ kind: 'system', tables, reason });
  return runAsSystem(fn);
}

export function asService<T>(
  tables: TableName[],
  reason: string,
  userId: string,
  workspaceId: string,
  fn: () => Promise<T>,
): Promise<T> {
  recordBypass({ kind: 'service', tables, reason });
  return runAsServiceActor(userId, workspaceId, fn);
}

export type TxOptions = { maxWait?: number; timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel };
export type TxFn<T> = (tx: Prisma.TransactionClient) => Promise<T>;
/** Any client that can open an interactive transaction: the shared `db`, or an injected one. */
export interface TxCapableClient {
  $transaction<R>(fn: TxFn<R>, options?: TxOptions): Promise<R>;
}

/** Callbacks waiting for the enclosing transaction() to commit. */
const pendingAfterCommit = new AsyncLocalStorage<Array<() => void>>();

/**
 * Runs `callback` once the enclosing transaction() commits, and never if it rolls back; outside
 * a transaction, runs it now. For work that must see the committed rows, e.g. queueing an index
 * job a worker may pick at once.
 */
export function afterCommit(callback: () => void): void {
  const pending = pendingAfterCommit.getStore();
  if (pending) pending.push(callback);
  else callback();
}

export function transaction<T>(
  tables: TableName[],
  reason: string,
  client: TxCapableClient,
  fn: TxFn<T>,
  options?: TxOptions,
): Promise<T> {
  recordBypass({ kind: 'transaction', tables, reason });
  const run = () => (options ? client.$transaction(fn, options) : client.$transaction(fn));
  // A transaction inside another one commits with it: the outer one runs the callbacks.
  if (pendingAfterCommit.getStore()) return run();
  const pending: Array<() => void> = [];
  return pendingAfterCommit.run(pending, async () => {
    const result = await run();
    for (const callback of pending) {
      pendingAfterCommit.exit(() => {
        try {
          callback();
        } catch (error) {
          logger.warn('[bypassAcl] after-commit callback failed', { error });
        }
      });
    }
    return result;
  });
}

export function rawQuery<T>(tables: TableName[], reason: string, fn: () => Promise<T>): Promise<T> {
  recordBypass({ kind: 'raw', tables, reason });
  return fn();
}
