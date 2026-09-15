import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import type { PostprocessContext } from '@/integrations/core/types';
import { ensureBoardTicketFormFields } from '@/services/ticketFormFieldService';
import { logger } from '@/utils/logger';

const TAG = '[SocialMediaTicketCustomFields]';

export async function syncSocialMediaTicketCustomFields(
  context: PostprocessContext,
): Promise<void> {
  const fields = context.normalizedData.ticketCustomFields;
  if (!fields?.length) return;

  const ticket = await db.ticket.findFirst({
    where: { conversationId: context.conversationId },
    select: {
      id: true,
      boardId: true,
      projectId: true,
      workspaceId: true,
      createdBy: true,
    },
  });
  if (!ticket) {
    logger.warn(`${TAG} Ticket not found`, {
      conversationId: context.conversationId,
    });
    return;
  }

  await ensureBoardTicketFormFields({
    boardId: ticket.boardId,
    projectId: ticket.projectId,
    workspaceId: ticket.workspaceId,
    createdBy: ticket.createdBy,
    fields: fields.map(({ fieldName, fieldType }) => ({
      fieldName,
      fieldType,
      isOptional: true,
    })),
  });

  await repositories.forms.upsertTicketFormFields(
    ticket.id,
    ticket.boardId,
    fields.map(({ fieldName, value }) => ({ fieldName, value })),
  );
}
