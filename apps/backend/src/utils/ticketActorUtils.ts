import { db } from '@/database/client';
import { FormContextType, FormEntityType, FormFieldType } from '@xyne/shared';
import { logger } from '@/utils/logger';
import { findFormEntityValues } from '@/database/repositories/formEntityValueRepository';

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
    const formValues = await findFormEntityValues(db, {
      where: {
        entityId: ticketId,
        entityType: 'TICKET',
        fieldId: { in: fieldIds },
      },
    });

    const userIds: string[] = [];

    for (const { value } of formValues) {
      if (Array.isArray(value)) userIds.push(...value);
    }

    return [...new Set(userIds)];
  } catch (error) {
    logger.error(`Failed to fetch form field users for ticket ${ticketId}`, error);
    return [];
  }
}
