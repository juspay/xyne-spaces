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
  // fn MUST be awaited inside storage.run: Prisma promises don't execute the ACL hook until
  // awaited, and storage.run restores the context the moment fn returns an unexecuted promise.
  return runAsSystem(async () => await fn());
}

export function asService<T>(
  tables: TableName[],
  reason: string,
  userId: string,
  workspaceId: string,
  fn: () => Promise<T>,
): Promise<T> {
  recordBypass({ kind: 'service', tables, reason });
  // See asSystem: keep the scope open until the query has actually run.
  return runAsServiceActor(userId, workspaceId, async () => await fn());
}

export type TxOptions = { maxWait?: number; timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel };
export type TxFn<T> = (tx: Prisma.TransactionClient) => Promise<T>;
/** Any client that can open an interactive transaction: the shared `db`, or an injected one. */
export interface TxCapableClient {
  $transaction<R>(fn: TxFn<R>, options?: TxOptions): Promise<R>;
}

export function transaction<T>(
  tables: TableName[],
  reason: string,
  client: TxCapableClient,
  fn: TxFn<T>,
  options?: TxOptions,
): Promise<T> {
  recordBypass({ kind: 'transaction', tables, reason });
  return options ? client.$transaction(fn, options) : client.$transaction(fn);
}

export function rawQuery<T>(tables: TableName[], reason: string, fn: () => Promise<T>): Promise<T> {
  recordBypass({ kind: 'raw', tables, reason });
  return fn();
}
