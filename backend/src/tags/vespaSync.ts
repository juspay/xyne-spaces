import { vespaQueue } from '@/queues/vespaQueue';
import { mailSchema, ticketSchema } from '@/vespa/src/types';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { DESK_EMAIL_SOURCE_TYPE } from './deskEmail';

/**
 * Re-feed an email + its ticket to Vespa so `generatedTags` reflects the Tag table.
 * Fire-and-forget: callers use `void enqueueTagVespaRefeed(...)`.
 */
export async function enqueueTagVespaRefeed(sourceType: string, sourceId: string): Promise<void> {
  if (sourceType !== DESK_EMAIL_SOURCE_TYPE) return;

  try {
    await vespaQueue.addJob({ schema: mailSchema, jobType: 'feed', docId: sourceId });

    const email = await db.email.findUnique({
      where: { id: sourceId },
      select: { conversationId: true },
    });
    if (!email) return;

    const ticket = await db.ticket.findFirst({
      where: { conversationId: email.conversationId },
      select: { id: true },
    });
    if (ticket) {
      await vespaQueue.addJob({ schema: ticketSchema, jobType: 'feed', docId: ticket.id });
    }
  } catch (error) {
    logger.error('[TAG][VESPA] Failed to enqueue re-feed:', error);
  }
}
