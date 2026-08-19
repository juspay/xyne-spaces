import { TicketStatusV2 } from '@xyne/shared';
import { BasePostprocessor } from '@/integrations/core/basePostprocessor';
import type { PostprocessContext } from '@/integrations/core/types';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { syncSocialMediaTicketCustomFields } from '../ticketCustomFields';
import { logger } from '@/utils/logger';

const TAG = '[InstagramPostprocessor]';

export class InstagramPostprocessor extends BasePostprocessor {
  async process(context: PostprocessContext): Promise<void> {
    // Auto-create form field definitions on the board if missing, then write values.
    // Uses the same shared helper as Google Play so field definitions are never
    // missing due to manual admin setup.
    try {
      await syncSocialMediaTicketCustomFields(context);    
    } catch (error) {
      logger.error(`${TAG} Failed to sync ticket custom fields`, {
        sourceId: context.sourceId,
        conversationId: context.conversationId,
        error,
      });
    }

    // Reopen logic only applies to new inbound DMs (ticketCustomFields present),
    // not to content-update edits.
    if (!context.normalizedData.ticketCustomFields?.length) return;

    const ticket = await db.ticket.findFirst({
      where: { conversationId: context.conversationId },
      select: { id: true, boardId: true, statusV2: true, stageName: true },
    });
    if (!ticket) return;

    // Reopen ticket if it was resolved/cancelled when this new DM arrived.
    const isResolved =
      ticket.statusV2 === TicketStatusV2.COMPLETED ||
      ticket.statusV2 === TicketStatusV2.CANCELLED;

    if (isResolved) {
      const firstStage = await db.stage.findFirst({
        where: { boardId: ticket.boardId },
        orderBy: { sequenceNumber: 'asc' },
        select: { name: true },
      });

      if (firstStage && firstStage.name !== ticket.stageName) {
        // Resolve the workspace channel owner to use as updatedBy actor
        const source = await db.externalSource.findUnique({
          where: { id: context.sourceId },
          select: { channelId: true },
        });
        const preference = source?.channelId
          ? await db.emailChannelPreference.findFirst({
              where: { channelId: source.channelId },
              select: { ownerUserId: true },
            })
          : null;
        const updatedBy = preference?.ownerUserId;
        if (!updatedBy) {
          logger.warn(`${TAG} Cannot reopen ticket — ownerUserId missing for channel`, {
            ticketId: ticket.id,
            channelId: source?.channelId,
          });
          return;
        }

        await repositories.tickets
          .updateTicketStage(ticket.id, firstStage.name, updatedBy)
          .catch((err: unknown) => {
            logger.warn(`${TAG} Could not reopen ticket on new DM`, {
              ticketId: ticket.id,
              error: err,
            });
          });

        logger.info(`${TAG} Reopened resolved ticket on new DM`, {
          ticketId: ticket.id,
          previousStage: ticket.stageName,
          newStage: firstStage.name,
        });
      }
    }
  }
}
