import { db } from '@/database/client';
import { tagRepository } from '@/database/repositories/tagRepository';
import { vespaQueue } from '@/queues/vespaQueue';
import { ticketSchema } from '@/vespa/src/types';
import { logger } from '@/utils/logger';
import { config as appConfig } from '@/config/env';
import { DESK_EMAIL_SOURCE_TYPE, deskEmailConfigKey } from './deskEmail';

export const DESK_TICKET_SOURCE_TYPE = 'desk-ticket';

export async function enqueueTicketTagRefeed(ticketId: string): Promise<void> {
  try {
    await vespaQueue.addJob({ schema: ticketSchema, jobType: 'feed', docId: ticketId });
  } catch (err) {
    logger.error('[TAG][TICKET-MIRROR] Failed to enqueue ticket Vespa re-feed', { ticketId, err });
  }
}

/**
 * Gate check: if emailId is the latest email in its conversation, mirrors its
 * active tags onto the ticket row in non_zero.tags (sourceType='desk-ticket').
 *
 * Called after every desk-email tag mutation. Never throws — failures are
 * logged and the write path continues unaffected.
 */
export async function syncTicketTagsFromEmail(emailId: string): Promise<void> {
  if (!appConfig.enableTagGenerationPipeline) return;

  try {
    const email = await db.email.findUnique({
      where: { id: emailId },
      select: { conversationId: true },
    });
    if (!email) return;

    const latest = await db.email.findFirst({
      where: { conversationId: email.conversationId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
    if (latest?.id !== emailId) return;

    await syncTicketTagsForConversation(email.conversationId);
  } catch (err) {
    logger.error('[TAG][TICKET-MIRROR] syncTicketTagsFromEmail failed', { emailId, err });
  }
}

/**
 * Copies the latest email's active tags onto the ticket row.
 * Used directly by demerge (where the "current email" concept doesn't apply —
 * the old conversation's latest email changed without any tag write firing).
 *
 * Advisory lock on conversationId serializes concurrent writers for the same
 * ticket mirror (e.g. LLM completion racing a manual edit on the same email).
 * Never throws — failures are logged.
 */
export async function syncTicketTagsForConversation(conversationId: string): Promise<void> {
  if (!appConfig.enableTagGenerationPipeline) return;

  let ticketId: string | null = null;

  try {
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'tag-mirror:' + conversationId}))`;

      const ticket = await tx.ticket.findFirst({
        where: { conversationId },
        select: { id: true, channelId: true, workspaceId: true },
      });
      if (!ticket) return;

      const latest = await tx.email.findFirst({
        where: { conversationId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true },
      });

      const sourceRows = latest
        ? await tx.tag.findMany({
            where: { sourceId: latest.id, sourceType: DESK_EMAIL_SOURCE_TYPE, isDeleted: false },
            select: { tagCategory: true, tag: true, method: true, reason: true },
          })
        : [];

      const changed = await tagRepository.replaceAllTagsForSource(
        {
          sourceId: ticket.id,
          sourceType: DESK_TICKET_SOURCE_TYPE,
          workspaceId: ticket.workspaceId,
          configKey: deskEmailConfigKey(ticket.channelId),
          rows: sourceRows,
        },
        tx,
      );

      if (changed) ticketId = ticket.id;
    });

    if (ticketId) void enqueueTicketTagRefeed(ticketId);
  } catch (err) {
    logger.error('[TAG][TICKET-MIRROR] syncTicketTagsForConversation failed', { conversationId, err });
  }
}
