import { ActivityType } from '@prisma/client';
import { BaseSideEffectHandler } from '../base-handler';
import type { SideEffectJobConfig } from '../types';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { recordTicketTimelineEvent } from '@/services/ticketTimelineEventService';
import { vespaQueue } from '@/queues/vespaQueue';
import { ticketSchema } from '@/vespa/src/types';

/**
 * Tag changes are dual-written to both `ticket_tags` (old) and
 * `ticket_tag_mappings` (new, canonical) tables in the same mutation, so both
 * side-effect handlers fire for one change. The ticket activity + SYSTEM message
 * audit trail is emitted exclusively here, on the canonical new-model table.
 * TicketTagsSideEffectHandler intentionally does NOT emit it, to avoid duplicate
 * messages during the dual-write migration window.
 */
export class TicketTagMappingsSideEffectHandler extends BaseSideEffectHandler {
  async onInsert(job: SideEffectJobConfig): Promise<void> {
    const { args } = job;
    const tagName: string = args?.tagName;
    const ticketId: string = args?.ticketId;

    if (!tagName || !ticketId) {
      logger.warn('[TicketTagMappingsSideEffectHandler] Missing tagName or ticketId in insert args');
      return;
    }

    await this.handleTagActivity(ticketId, tagName, 'added');
    await this.queueTicketVespaFeed(ticketId);
  }

  async onUpdate(job: SideEffectJobConfig): Promise<void> {
    const { args, previousValue } = job;
    const prev = previousValue as { ticketId?: string } | undefined;
    const ticketId: string | undefined = args?.ticketId ?? prev?.ticketId;

    if (!ticketId) {
      logger.warn('[TicketTagMappingsSideEffectHandler] Missing ticketId in update args and previousValue');
      return;
    }

    await this.queueTicketVespaFeed(ticketId);
  }

  async onDelete(job: SideEffectJobConfig): Promise<void> {
    const { previousValue } = job;

    if (!previousValue) {
      logger.warn('[TicketTagMappingsSideEffectHandler] No previousValue for delete');
      return;
    }

    const prev = previousValue as { ticketId?: string; tagName?: string };
    if (!prev.ticketId || !prev.tagName) {
      logger.warn('[TicketTagMappingsSideEffectHandler] Missing ticketId or tagName in previousValue');
      return;
    }

    await this.handleTagActivity(prev.ticketId, prev.tagName, 'removed');
    await this.queueTicketVespaFeed(prev.ticketId);
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
      logger.error('[TicketTagMappingsSideEffectHandler] Failed to queue ticket Vespa feed:', {
        ticketId,
        error: error,
      });
    }
  }

  private async handleTagActivity(
    ticketId: string,
    tagName: string,
    action: 'added' | 'removed',
  ): Promise<void> {
    const now = new Date();

    try {
      const [ticket, user] = await Promise.all([
        db.ticket.findUnique({
          where: { id: ticketId },
          select: { conversationId: true },
        }),
        db.user.findUnique({
          where: { id: this.ctx.userID },
          select: { name: true },
        }),
      ]);

      const activityValue =
        action === 'added'
          ? { action: 'added', newValue: tagName }
          : { action: 'removed', oldValue: tagName };

      const hasThread = Boolean(ticket?.conversationId && user?.name);
      const content =
        action === 'added'
          ? `${user?.name} added a label: ${tagName}`
          : `${user?.name} removed a label: ${tagName}`;

      await recordTicketTimelineEvent({
        activity: {
          ticketId,
          updatedBy: this.ctx.userID,
          activityType: ActivityType.TAGS,
          value: activityValue,
          timestamp: now,
        },
        message: hasThread
          ? {
              conversationId: ticket!.conversationId!,
              senderId: this.ctx.userID,
              content,
              activityType: 'TAGS',
              createdAt: now,
            }
          : undefined,
      });
    } catch (error) {
      logger.error('[TicketTagMappingsSideEffectHandler] Failed to handle tag activity:', {
        ticketId,
        tagName,
        action,
        error: error,
      });
    }
  }
}
