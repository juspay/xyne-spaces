import { Prisma } from '@prisma/client';
import { db } from '@/database/client';
import { rawQuery } from './base';

/**
 * Relocated from workers/stageEtaDeadlineWorker's syncStageOverdueFlags. A set-based UPDATE over
 * one batch of ticket ids; the worker sweeps every workspace, so there is no single tenant to
 * scope to. Statement and batching unchanged — the caller still slices and sleeps between batches.
 */
export function markTicketsStageOverdue(batchIds: string[]): Promise<number> {
  return rawQuery(
    ['Ticket'],
    'stage eta deadline worker: cross-workspace batch flag of overdue tickets',
    () => db.$executeRaw`
        UPDATE "tickets"
        SET "isStageOverdue" = true
        WHERE "id" IN (${Prisma.join(batchIds)})
          AND ("isStageOverdue" = false OR "isStageOverdue" IS NULL)
      `,
  );
}
