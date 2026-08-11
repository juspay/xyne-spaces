import { TicketStatusV2 } from '@xyne/shared';
import { BasePostprocessor } from '@/integrations/core/basePostprocessor';
import type { PostprocessContext } from '@/integrations/core/types';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { logger } from '@/utils/logger';

const TAG = '[InstagramPostprocessor]';

export class InstagramPostprocessor extends BasePostprocessor {
  async process(context: PostprocessContext): Promise<void> {
    const fields = context.normalizedData.ticketCustomFields;
    if (!fields?.length) return;

    const ticket = await db.ticket.findFirst({
      where: { conversationId: context.conversationId },
      select: { id: true, boardId: true, statusV2: true, stageName: true },
    });
    if (!ticket) {
      logger.warn(`${TAG} Ticket not found for custom fields`, {
        conversationId: context.conversationId,
      });
      return;
    }

    await repositories.forms
      .upsertTicketFormFields(
        ticket.id,
        ticket.boardId,
        fields.map(({ fieldName, value }) => ({ fieldName, value })),
      )
      .catch((err: unknown) => {
        logger.warn(`${TAG} Could not upsert ticket custom fields`, {
          ticketId: ticket.id,
          error: err,
        });
      });

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
        const updatedBy = preference?.ownerUserId ?? 'system';

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
