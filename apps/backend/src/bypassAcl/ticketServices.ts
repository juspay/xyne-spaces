import { Prisma } from '@prisma/client';
import { db } from '@/database/client';
import { asSystem, rawQuery } from './base';

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

/**
 * Dev-ticket lookup for release commit analysis. A release has to list every ticket whose PR is
 * in its commit range, so the lookup can't depend on which private channels the user running the
 * analysis is in: the ACL-scoped read returned nothing for those tickets and they were dropped
 * from the release without a trace. Still pinned to the release's own workspace by the compound
 * key, and only the fields the analysis renders are selected.
 */
export function findDevTicketForReleaseAnalysis(xyneId: string, workspaceId: string) {
  return asSystem(
    ['Ticket'],
    'release commit analysis: dev ticket lookup independent of the runner channel membership',
    () =>
      db.ticket.findUnique({
        where: { workspaceId_xyneId: { workspaceId, xyneId } },
        select: {
          id: true,
          xyneId: true,
          title: true,
          statusV2: true,
          priority: true,
          assignedTo: true,
          ticketType: true,
        },
      }),
  );
}
