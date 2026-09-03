import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import vespaClient from '@/vespa/client';
import { mailSchema, VespaDocType } from '@/vespa/src/types';
import type { VespaJobType } from '@/zero/vespa-injection/core/types';

type MailAssignedToSyncContext = {
  docId: string;
  jobType: VespaJobType;
  mappedData?: Record<string, unknown> | null;
};

/**
 * Keep `mail.assignedTo` in step with the ticket it was denormalised from — mapEmail only
 * runs when the mail changes, so a reassignment would leave indexed mails on the old value.
 *
 * Runs off the ticket's Vespa write, so it covers every path that reindexes a ticket. Partial
 * updates only: re-feeding mail would re-run the hf-embedder over subject/chunks.
 */
export async function runMailAssignedToSync(ctx: MailAssignedToSyncContext): Promise<void> {
  if (ctx.jobType !== 'feed') return;

  const mapped = ctx.mappedData;
  if (!mapped) return;

  const convId = typeof mapped.convId === 'string' ? mapped.convId : '';
  if (!convId) return;

  // mapTicket writes '' when unassigned, mapEmail drops the key — normalise both to undefined.
  const assignedTo =
    typeof mapped.assignedTo === 'string' && mapped.assignedTo ? mapped.assignedTo : undefined;

  try {
    const emails = await db.email.findMany({
      where: { conversationId: convId },
      select: { id: true },
    });
    if (emails.length === 0) return;

    // Most ticket feeds carry no assignee change, so read one mail doc before writing all of them.
    const indexed = await vespaClient.crudService.getDocument(emails[0].id, mailSchema);
    const indexedFields = indexed?.fields as Record<string, unknown> | undefined;
    const indexedAssignedTo =
      typeof indexedFields?.assignedTo === 'string' && indexedFields.assignedTo
        ? indexedFields.assignedTo
        : undefined;
    if (indexedAssignedTo === assignedTo) return;

    const results = await vespaClient.crudService.update(
      emails.map((email) => ({
        docId: email.id,
        fields: {
          docType: VespaDocType.MAIL,
          docId: email.id,
          assignedTo: assignedTo ?? '',
        },
      })),
      mailSchema,
    );

    const failed = results.filter((result) => !result.success).length;
    logger.info(
      `[MAIL_ASSIGNEE_SYNC] ticket ${ctx.docId}: assignedTo "${indexedAssignedTo ?? ''}" -> "${assignedTo ?? ''}" on ${emails.length - failed}/${emails.length} mail docs`,
    );
  } catch (error) {
    // Best-effort: the ticket write already succeeded and must not be failed by this.
    logger.error(`[MAIL_ASSIGNEE_SYNC] Failed for ticket ${ctx.docId} (conversation ${convId}):`, error);
  }
}
