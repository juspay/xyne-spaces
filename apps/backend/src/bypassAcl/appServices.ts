import { db } from '@/database/client';
import { rawQuery } from './base';

/**
 * Relocated from apps/core/appUtils.ts's installApp: atomic COALESCE write so concurrent
 * first-installs can't generate competing signing secrets — not expressible via the query
 * builder, which has no COALESCE-on-conflict primitive. Scoped to one row by primary key
 * (appId), not a bulk operation.
 */
export async function coalesceAppSigningSecret(appId: string, fresh: string): Promise<string> {
  return rawQuery(
    ['Apps'],
    'atomic COALESCE write for lazy-generated signing secret — first writer wins, no query-builder equivalent',
    async () => {
      const rows = await db.$queryRaw<{ signingSecret: string | null }[]>`
        UPDATE apps SET "signingSecret" = COALESCE("signingSecret", ${fresh})
        WHERE id = ${appId} RETURNING "signingSecret"`;
      return rows[0]?.signingSecret ?? fresh;
    },
  );
}
