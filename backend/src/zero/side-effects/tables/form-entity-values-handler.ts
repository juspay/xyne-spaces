import { BaseSideEffectHandler } from '../base-handler';
import type { FormEntityValuePreviousValue, SideEffectJobConfig } from '../types';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { emitEventToWorkspaceApps } from '@/apps/core/eventSubscriptionUtils';
import { AppEventType, AdditionalFormFieldUpdatedPayload, BaseAppEvent } from '@/apps/types';
import { buildKanbanCountsSnapshot } from '@/services/tickets/kanbanCountsSnapshotService';
import type { KanbanCountsSnapshot } from '@/services/tickets/kanbanCountsSnapshotService';
import { websocketService } from '@/services/websocketService';
import { vespaQueue } from '@/queues/vespaQueue';
import { ticketSchema } from '@/vespa/src/types';
import { normalizeVespaFieldValue } from '@/zero/vespa-injection/core/form-fields';
import { createTicketCustomFieldActivity } from '@/services/ticketCustomFieldActivityService';
import { emitTicketUpdated } from '@/automations/triggers/ticket-updated.trigger';
import { ActivityType } from '@prisma/client';
import { FormFieldType } from '@xyne/shared';
import { stringFromFormValue } from '@xyne/shared/zero';
import { resolveFieldDefinitionById } from '@/utils/fieldDefinition';

const getPreviousFormEntityValue = (
  previousValue: FormEntityValuePreviousValue | undefined,
): unknown => previousValue?.actualFieldValue ?? previousValue?.fieldValue;

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
    await this.createFormFieldActivity(job, 'insert');
    await this.broadcastTicketCountsUpdate(job, 'insert');
  }

  async onUpdate(job: SideEffectJobConfig): Promise<void> {
    await this.emitFormFieldEvent(job, 'update');
    await this.createFormFieldActivity(job, 'update');
    await this.broadcastTicketCountsUpdate(job, 'update');
  }

  async onDelete(job: SideEffectJobConfig): Promise<void> {
    await this.broadcastTicketCountsUpdate(job, 'delete');
  }

  private async broadcastTicketCountsUpdate(
    job: SideEffectJobConfig,
    operation: 'insert' | 'update' | 'delete',
  ): Promise<void> {
    const previousValue = job.previousValue as FormEntityValuePreviousValue | undefined;
    const currentFormEntityValue =
      operation === 'delete'
        ? null
        : await db.formEntityValues.findUnique({ where: { id: job.entityId } });
    const entityType = currentFormEntityValue?.entityType ?? previousValue?.entityType;
    const ticketId = currentFormEntityValue?.entityId ?? previousValue?.entityId;
    const fieldId = currentFormEntityValue?.fieldId ?? previousValue?.fieldId;

    if (entityType !== 'TICKET' || !ticketId || !fieldId) return;

    await this.queueTicketVespaFeed(ticketId);

    const currentSnapshot = await buildKanbanCountsSnapshot(ticketId);
    if (!currentSnapshot) return;

    const previousSnapshot = this.buildPreviousCountsSnapshot(
      currentSnapshot,
      fieldId,
      operation === 'insert' ? undefined : getPreviousFormEntityValue(previousValue),
      operation,
    );

    websocketService.broadcastTicketCountsUpdate({
      operation: 'update',
      ticket: currentSnapshot,
      previousTicket: previousSnapshot,
    });
  }

  private async queueTicketVespaFeed(ticketId: string): Promise<void> {
    try {
      await vespaQueue.addJob({
        schema: ticketSchema,
        jobType: 'feed',
        docId: ticketId,
        userId: this.ctx.userID,
        workspaceId: this.ctx.workspaceId,
      });
    } catch (error) {
      logger.error('[FormEntityValuesSideEffectHandler] Failed to queue ticket Vespa feed:', {
        ticketId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private buildPreviousCountsSnapshot(
    currentSnapshot: KanbanCountsSnapshot,
    fieldId: string,
    previousFieldValue: unknown,
    operation: 'insert' | 'update' | 'delete',
  ): KanbanCountsSnapshot {
    const previousFormFieldValues = { ...currentSnapshot.formFieldValues };

    if (operation === 'insert') {
      delete previousFormFieldValues[fieldId];
    } else {
      previousFormFieldValues[fieldId] = previousFieldValue;
    }

    return {
      ...currentSnapshot,
      formFieldValues: previousFormFieldValues,
    };
  }

  private async emitFormFieldEvent(job: SideEffectJobConfig, operation: 'insert' | 'update'): Promise<void> {
    const { entityId } = job;
    const previousValue = job.previousValue as FormEntityValuePreviousValue | undefined;

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

      const fieldDefinition = await resolveFieldDefinitionById(db, formEntityValue.fieldId);

      const ticketId = formEntityValue.entityId;
      const fieldName = fieldDefinition?.fieldName;
      const fieldValue = formEntityValue.actualFieldValue ?? formEntityValue.fieldValue;

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
          channelId: true,
          projectId: true,
          conversationId: true,
          workspaceId: true,
          createdBy: true,
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
        fieldValue: normalizeVespaFieldValue(fieldValue as any) || '',
        previousValue: operation === 'update' && previousValue
          ? normalizeVespaFieldValue(getPreviousFormEntityValue(previousValue) as any) || ''
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

      // Also emit TICKET_UPDATED so automation engine can match formFieldIds conditions
      const prevFormValue = operation === 'update' && previousValue
        ? getPreviousFormEntityValue(previousValue)
        : null;

      // Skip emit if value didn't actually change (no-op re-save)
      if (operation === 'update' && prevFormValue === fieldValue) return;
      const toTicketChangeValue = (v: unknown): string | number | null => {
        if (typeof v === 'string' || typeof v === 'number') return v;
        if (v === null || v === undefined) return null;
        return String(v);
      };
      void emitTicketUpdated({
        ticket,
        changes: {},
        formFieldChanges: {
          [formEntityValue.fieldId]: {
            previousValue: toTicketChangeValue(prevFormValue),
            newValue: toTicketChangeValue(fieldValue),
          },
        },
        performedById: this.ctx.userID,
      });

    } catch (error) {
      logger.error('[FormEntityValuesSideEffectHandler] Failed to emit form field event:', {
        entityId,
        operation,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async createFormFieldActivity(
    job: SideEffectJobConfig,
    operation: 'insert' | 'update',
  ): Promise<void> {
    const previousValue = job.previousValue as FormEntityValuePreviousValue | undefined;

    try {
      const formEntityValue = await db.formEntityValues.findUnique({
        where: { id: job.entityId },
        select: {
          entityId: true,
          entityType: true,
          fieldId: true,
          contextId: true,
          fieldValue: true,
          actualFieldValue: true,
        },
      });

      if (!formEntityValue || formEntityValue.entityType !== 'TICKET') {
        return;
      }

      const ticket = await db.ticket.findUnique({
        where: { id: formEntityValue.entityId },
        select: { boardId: true },
      });

      if (!ticket || formEntityValue.contextId !== ticket.boardId) {
        return;
      }

      const fieldDefinition = await resolveFieldDefinitionById(db, formEntityValue.fieldId);

      if (!fieldDefinition?.fieldName) {
        return;
      }

      const previousRawValue = operation === 'update'
        ? getPreviousFormEntityValue(previousValue)
        : null;

      if (fieldDefinition.fieldType === FormFieldType.DOC) {
        await this.createFileFieldActivity(
          formEntityValue.entityId,
          formEntityValue.contextId,
          fieldDefinition.fieldName,
          stringFromFormValue(previousRawValue),
          stringFromFormValue(formEntityValue.actualFieldValue),
        );
        return;
      }

      await createTicketCustomFieldActivity({
        ticketId: formEntityValue.entityId,
        fieldName: fieldDefinition.fieldName,
        oldValue: previousRawValue,
        newValue: formEntityValue.actualFieldValue ?? formEntityValue.fieldValue,
        updatedBy: this.ctx.userID,
      });
    } catch (error) {
      logger.error('[FormEntityValuesSideEffectHandler] Failed to create form field activity:', {
        entityId: job.entityId,
        operation,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async createFileFieldActivity(
    ticketId: string,
    contextId: string | null,
    fieldName: string,
    previousAttachmentId: string | null,
    nextAttachmentId: string | null,
  ): Promise<void> {
    if ((previousAttachmentId ?? null) === (nextAttachmentId ?? null)) return;

    const [previousAttachment, nextAttachment, stage] = await Promise.all([
      previousAttachmentId
        ? db.messageAttachment.findUnique({ where: { id: previousAttachmentId } })
        : null,
      nextAttachmentId
        ? db.messageAttachment.findUnique({ where: { id: nextAttachmentId } })
        : null,
      contextId ? db.stage.findUnique({ where: { id: contextId }, select: { name: true } }) : null,
    ]);

    const action = previousAttachmentId && nextAttachmentId
      ? 'updated'
      : nextAttachmentId
        ? 'added'
        : 'removed';

    await db.ticketActivity.create({
      data: {
        ticketId,
        updatedBy: this.ctx.userID,
        activityType: ActivityType.METADATA,
        value: {
          field: 'stageFormFile',
          fieldName,
          action,
          ...(stage?.name ? { stageName: stage.name } : {}),
          ...(previousAttachmentId ? { oldValue: previousAttachmentId } : {}),
          ...(nextAttachmentId ? { newValue: nextAttachmentId } : {}),
          ...(previousAttachment?.originalFilename
            ? { oldFilename: previousAttachment.originalFilename }
            : {}),
          ...(nextAttachment?.originalFilename
            ? { newFilename: nextAttachment.originalFilename }
            : {}),
        },
      },
    });

    if (previousAttachmentId && previousAttachmentId !== nextAttachmentId) {
      await db.messageAttachment.delete({ where: { id: previousAttachmentId } });
    }
  }
}
