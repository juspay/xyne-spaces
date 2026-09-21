import { db } from '@/database/client';
import { rawQuery } from './base';

/**
 * Relocated from sdlc/cleanup/multirepoBackfill.ts. `channelId` is required in Prisma and
 * nullable only for these legacy, not-yet-migrated rows, so the typed filters can't name them
 * — raw SQL is the only way to reach a column state the schema itself says shouldn't exist.
 */
export function stampLegacyLinks(repoId: string, channelId: string): Promise<number> {
  return rawQuery(
    ['SdlcEntityLink'],
    'multirepo backfill: legacy rows have a column state the typed filters cannot express',
    () => db.$executeRaw`
      UPDATE "public"."sdlc_entity_links" SET "channelId" = ${channelId}
      WHERE "repoId" = ${repoId} AND "channelId" IS NULL
    `,
  );
}
