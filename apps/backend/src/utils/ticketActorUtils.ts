import { db } from '@/database/client';
import { withWorkspaceScope } from '@/database/tenant/context';
import { FormContextType, FormEntityType, FormFieldType, extractFormFieldUserIds } from '@xyne/shared';
import { logger } from '@/utils/logger';

/**
 * Fetch additional actor user IDs from board form fields of type USER.
 * These users are stakeholders defined via board configuration and should
 * receive activities/notifications for ticket changes.
 */
export async function getFormFieldUserActors(ticketId: string): Promise<string[]> {
  try {
    // Get the ticket's board
    const ticket = await db.ticket.findUnique({
      where: { id: ticketId },
      select: { boardId: true },
    });

    if (!ticket?.boardId) {
      return [];
    }

    // Find forms mapped to this board with TICKET entity type
    const formMappings = await db.formContextMapping.findMany({
      where: {
        contextId: ticket.boardId,
        contextType: FormContextType.BOARD,
        entityType: FormEntityType.TICKET,
      },
      select: { formId: true },
    });

    if (formMappings.length === 0) {
      return [];
    }

    const formIds = formMappings.map(m => m.formId);

    // Find USER-type fields in those forms
    const userFields = await db.formFields.findMany({
      where: {
        formId: { in: formIds },
        fieldType: FormFieldType.USER,
      },
      select: { id: true },
    });

    if (userFields.length === 0) {
      return [];
    }

    const fieldIds = userFields.map(f => f.id);

    // Get form entity values for this ticket where field is USER type
    const formValues = await db.formEntityValues.findMany({
      where: {
        entityId: ticketId,
        entityType: 'TICKET',
        fieldId: { in: fieldIds },
      },
      select: { fieldValue: true, actualFieldValue: true },
    });

    const userIds = formValues.flatMap(value => extractFormFieldUserIds(value.actualFieldValue, value.fieldValue));

    return [...new Set(userIds)];
  } catch (error) {
    logger.error(`Failed to fetch form field users for ticket ${ticketId}`, error);
    return [];
  }
}

export async function excludeTicketOptOuts(ticketId: string, userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) {
    return userIds;
  }

  try {
    const ticket = await db.ticket.findUnique({
      where: { id: ticketId },
      select: { conversationId: true },
    });

    if (!ticket?.conversationId) {
      return userIds;
    }

    const optedOut = await withWorkspaceScope(() =>
      db.conversationParticipant.findMany({
        where: {
          conversationId: ticket.conversationId,
          userId: { in: userIds },
          isSubscribed: false,
          unsubscribedAt: { not: null },
        },
        select: { userId: true },
      }),
    );

    const optedOutIds = new Set(optedOut.map(p => p.userId));
    return userIds.filter(id => !optedOutIds.has(id));
  } catch (error) {
    logger.error(`Failed to filter notification opt-outs for ticket ${ticketId}`, error);
    return userIds;
  }
}

export async function clearTicketOptOut(ticketId: string, userId: string): Promise<void> {
  try {
    const ticket = await db.ticket.findUnique({
      where: { id: ticketId },
      select: { conversationId: true },
    });

    if (!ticket?.conversationId) {
      return;
    }

    await withWorkspaceScope(() =>
      db.conversationParticipant.updateMany({
        where: {
          conversationId: ticket.conversationId,
          userId,
          unsubscribedAt: { not: null },
        },
        data: { unsubscribedAt: null },
      }),
    );
  } catch (error) {
    logger.error(`Failed to clear notification opt-out for user ${userId} on ticket ${ticketId}`, error);
  }
}
