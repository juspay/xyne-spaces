import type { Prisma, PrismaClient } from '@prisma/client';
import { rawQuery } from './base';

/**
 * Relocated from zero/server.ts's custom-query endpoint. The ZQL compiler emits arbitrary SQL
 * text plus positional values, so the statement can only be run unparameterised-by-Prisma; the
 * permission predicates are compiled INTO the SQL by the ZQL layer, not applied by the tenant
 * ACL extension. Text and values are passed through unchanged.
 */
export function runCompiledZqlSql(
  client: PrismaClient | Prisma.TransactionClient,
  text: string,
  values: readonly unknown[],
): Promise<unknown> {
  return rawQuery(
    [],
    'zero custom query: ZQL compiles to arbitrary SQL text, with its permission predicates already compiled in',
    () => client.$queryRawUnsafe(text, ...values),
  );
}
