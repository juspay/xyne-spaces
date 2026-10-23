import type { Prisma } from '@prisma/client';
import { rawQuery, type TableName } from './base';

/**
 * Postgres transaction-scoped advisory lock, taken via raw SQL because Prisma's query builder
 * cannot express `pg_advisory_xact_lock`. Relocated here from the various call sites that used
 * to inline `tx.$executeRaw` — the SQL and the lock key are unchanged; only the location moved.
 *
 * `tables` names the tables the surrounding transaction serializes, so the bypass audit line
 * says what the lock is protecting rather than just that a lock was taken.
 */
export function advisoryXactLock(
  tx: Prisma.TransactionClient,
  tables: TableName[],
  reason: string,
  key: string,
): Promise<number> {
  return rawQuery(tables, reason, () =>
    tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`,
  );
}

/**
 * Same as {@link advisoryXactLock} but hashes the key with `hashtextextended(key, 0)`.
 * Kept as a separate helper because the hash function is part of the lock's identity: two call
 * sites using different hash functions on the same string do NOT exclude each other.
 */
export function advisoryXactLockExtended(
  tx: Prisma.TransactionClient,
  tables: TableName[],
  reason: string,
  key: string,
): Promise<number> {
  return rawQuery(tables, reason, () =>
    tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
  );
}

/**
 * Non-blocking variant: returns whether the lock was taken. Relocated from subTicketLinkService,
 * which uses `try_` so a contended request fails fast instead of holding a pooled connection
 * until the transaction times out. SQL unchanged.
 */
export async function tryAdvisoryXactLock(
  tx: Prisma.TransactionClient,
  tables: TableName[],
  reason: string,
  key: string,
): Promise<boolean> {
  const rows = await rawQuery(tables, reason, () => tx.$queryRaw<Array<{ locked: boolean }>>`
        SELECT pg_try_advisory_xact_lock(hashtext(${key})) AS locked
      `);
  return rows[0]?.locked === true;
}
