import { BaseSideEffectHandler } from '../base-handler';
import type { SideEffectJobConfig } from '../types';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { emitEventToWorkspaceApps } from '@/apps/core/eventSubscriptionUtils';
import { AppEventType, AdditionalFormFieldUpdatedPayload, BaseAppEvent } from '@/apps/types';

/**
 * Side effect handler for form_entity_values table.
 * 
 * When a form field is created/updated (e.g., user enters merchant_id),
 * this handler emits ADDITIONAL_FORM_FIELD_UPDATED event to all apps
 * installed in the workspace.
 * 
 * Apps (like Genius) can subscribe to this event and handle specific
 * field updates (e.g., trigger RCA investigation when merchant_id is set).
 */
export class FormEntityValuesSideEffectHandler extends BaseSideEffectHandler {
  async onInsert(job: SideEffectJobConfig): Promise<void> {
    await this.emitFormFieldEvent(job, 'insert');
  }

  async onUpdate(job: SideEffectJobConfig): Promise<void> {
    await this.emitFormFieldEvent(job, 'update');
  }

  private async emitFormFieldEvent(job: SideEffectJobConfig, operation: 'insert' | 'update'): Promise<void> {
    const { entityId, previousValue } = job;

    try {
      // Get the form entity value
      const formEntityValue = await db.formEntityValues.findUnique({
        where: { id: entityId },
      });

      if (!formEntityValue) {
        logger.warn('[FormEntityValuesSideEffectHandler] Form entity value not found:', entityId);
        return;
      }

      // Only process TICKET entity types
      if (formEntityValue.entityType !== 'TICKET') {
        return;
      }

      // Get the field name from FormFields
      const formField = await db.formFields.findUnique({
        where: { id: formEntityValue.fieldId },
        select: { fieldName: true },
      });

      const ticketId = formEntityValue.entityId;
      const fieldName = formField?.fieldName;
      const fieldValue = formEntityValue.actualFieldValue || formEntityValue.fieldValue;

      if (!ticketId || !fieldName) {
        logger.warn('[FormEntityValuesSideEffectHandler] Missing ticketId or fieldName');
        return;
      }

      // Get ticket and board info
      const ticket = await db.ticket.findUnique({
        where: { id: ticketId },
        select: { 
          id: true, 
          boardId: true, 
          conversationId: true, 
          workspaceId: true,
        },
      });

      if (!ticket) {
        logger.warn('[FormEntityValuesSideEffectHandler] Ticket not found:', ticketId);
        return;
      }

      // Get board name
      const board = await db.board.findUnique({
        where: { id: ticket.boardId },
        select: { name: true },
      });

      // Get channel ID from conversation
      let channelId = '';
      if (ticket.conversationId) {
        const conversation = await db.conversation.findUnique({
          where: { conversationId: ticket.conversationId },
          select: { channelId: true },
        });
        channelId = conversation?.channelId || '';
      }

      // Build and emit the event
      const payload: AdditionalFormFieldUpdatedPayload = {
        ticketId,
        conversationId: ticket.conversationId || '',
        channelId,
        boardId: ticket.boardId,
        boardName: board?.name || '',
        fieldName,
        fieldValue: String(fieldValue || ''),
        previousValue: operation === 'update' && previousValue 
          ? String((previousValue as any).fieldValue || '')
          : undefined,
        updatedBy: this.ctx.userID,
        workspaceId: ticket.workspaceId,
      };

      const event: BaseAppEvent = {
        eventType: AppEventType.ADDITIONAL_FORM_FIELD_UPDATED,
        payload,
        timestamp: new Date().toISOString(),
      };

      logger.info(`[FormEntityValuesSideEffectHandler] Emitting ADDITIONAL_FORM_FIELD_UPDATED for field "${fieldName}" on ticket ${ticketId}`);
      
      // Fire and forget - don't block the side effect processing
      void emitEventToWorkspaceApps(ticket.workspaceId, event);

    } catch (error) {
      logger.error('[FormEntityValuesSideEffectHandler] Failed to emit form field event:', {
        entityId,
        operation,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
