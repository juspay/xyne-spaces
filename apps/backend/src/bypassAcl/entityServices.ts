import type { Prisma, PrismaClient } from '@prisma/client';
import { rawQuery } from './base';

/**
 * Relocated from services/entityExtraction/entityResolver's fuzzyMatch. Uses pg_trgm's
 * `similarity()` and the `%` operator, which Prisma's query builder cannot express. The
 * workspace predicate is written explicitly in the SQL. Statement unchanged.
 */
export async function fuzzyMatchEntityAlias(
  client: PrismaClient | Prisma.TransactionClient,
  workspaceId: string,
  type: string,
  normalizedForm: string,
): Promise<Array<{ entityId: string; sim: number }>> {
  return rawQuery(
    ['EntityAlias'],
    'entity resolution: pg_trgm similarity match, workspace predicate written explicitly in the SQL',
    () => client.$queryRaw<Array<{ entityId: string; sim: number }>>`
      SELECT "entityId", similarity("normalizedForm", ${normalizedForm})::float AS sim
      FROM "non_zero"."entity_aliases"
      WHERE "workspaceId" = ${workspaceId}
        AND "type" = ${type}
        AND "normalizedForm" % ${normalizedForm}
      ORDER BY sim DESC
      LIMIT 1`,
  );
}
