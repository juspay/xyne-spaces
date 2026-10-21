/**
 * One-shot re-feed for tickets carrying a global-backed DATE custom field.
 *
 * Why: until the fix in vespa-injection/core/mapper.ts, loadTicketFormFields built
 * its fieldType map with `formFields.findMany({ id: { in: fieldIds } })` while those
 * ids are GlobalField ids for every modern field. The lookup missed, fieldType came
 * back undefined, and buildFormFields fell through to its untyped path — which still
 * indexes the value, but skips the DATE branch that writes `fieldValueLong`. Without
 * that attribute, `dynamicFieldDateRanges` filters (which bind fieldValueLong) match
 * nothing on those fields.
 *
 * Already-indexed tickets keep the old shape until something re-feeds them. Editing
 * any custom field on a ticket does that on its own (syncCustomFieldValues queues a
 * feed), so the set self-heals over time — this script just makes it deterministic.
 *
 * Only DATE is affected: for every other type the typed branch and the untyped
 * fallthrough emit identical rows.
 *
 * Idempotent — a feed job rebuilds the document from Postgres, so re-running is safe.
 *
 *   pnpm --filter backend exec dotenv -e .env.local -- tsx src/migration/scripts/refeedGlobalDateFieldTickets.ts [--dry-run]
 */
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { vespaQueue } from '@/queues/vespaQueue';
import { ticketSchema } from '@/vespa/src/types';
import { FormFieldType, FormEntityType } from '@xyne/shared';

const LOG_PREFIX = '[RefeedGlobalDateFieldTickets]';

const run = async (): Promise<void> => {
  const dryRun = process.argv.includes('--dry-run');

  const globalDateFields = await db.globalField.findMany({
    where: { fieldType: FormFieldType.DATE },
    select: { id: true },
  });
  if (globalDateFields.length === 0) {
    logger.info(`${LOG_PREFIX} No global DATE fields in this workspace; nothing to do.`);
    return;
  }

  const rows = await db.formEntityValues.findMany({
    where: {
      entityType: FormEntityType.TICKET,
      fieldId: { in: globalDateFields.map(field => field.id) },
    },
    select: { entityId: true },
    distinct: ['entityId'],
  });
  const ticketIds = rows.map(row => row.entityId);

  logger.info(
    `${LOG_PREFIX} ${globalDateFields.length} global DATE field(s) → ${ticketIds.length} ticket(s) to re-feed${dryRun ? ' (dry run)' : ''}`,
  );
  if (dryRun || ticketIds.length === 0) {
    return;
  }

  // workspaceId is required by the feed job for tenant routing; skip any ticket
  // missing one rather than enqueue a job the worker cannot resolve.
  const tickets = await db.ticket.findMany({
    where: { id: { in: ticketIds } },
    select: { id: true, workspaceId: true, createdBy: true },
  });

  await vespaQueue.initialize();

  let queued = 0;
  let skipped = 0;
  for (const ticket of tickets) {
    if (!ticket.workspaceId) {
      skipped += 1;
      logger.warn(`${LOG_PREFIX} Ticket has no workspaceId, skipping`, { ticketId: ticket.id });
      continue;
    }
    try {
      await vespaQueue.addJob({
        schema: ticketSchema,
        jobType: 'feed',
        docId: ticket.id,
        userId: ticket.createdBy,
        workspaceId: ticket.workspaceId,
      });
      queued += 1;
    } catch (error) {
      skipped += 1;
      logger.error(`${LOG_PREFIX} Failed to queue feed job`, {
        ticketId: ticket.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.info(`${LOG_PREFIX} Done. queued=${queued} skipped=${skipped}`);
};

run()
  .catch(error => {
    logger.error(`${LOG_PREFIX} Run failed`, error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
