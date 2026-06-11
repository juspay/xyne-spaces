import { v4 as uuidv4 } from 'uuid';
import { ActivityType } from '@prisma/client';
import { BaseSideEffectHandler } from '../base-handler';
import type { SideEffectJobConfig, TicketTagPreviousValue } from '../types';
import { db } from '@/database/client';
import { buildKanbanCountsSnapshot } from '@/services/tickets/kanbanCountsSnapshotService';
import { websocketService } from '@/services/websocketService';
import { logger } from '@/utils/logger';
import { vespaQueue } from '@/queues/vespaQueue';
import { ticketSchema } from '@/vespa/src/types';

export class TicketTagsSideEffectHandler extends BaseSideEffectHandler {
  async onInsert(job: SideEffectJobConfig): Promise<void> {
    const { args } = job;
    const tagName: string = args?.name;
    const ticketId: string = args?.ticketId;

    if (!tagName || !ticketId) {
      logger.warn('[TicketTagsSideEffectHandler] Missing name or ticketId in insert args');
      return;
    }

    await this.handleTagActivity(ticketId, tagName, 'added');
    await this.queueTicketVespaFeed(ticketId);
    await this.broadcastTicketCountsUpdate(ticketId, tagName, 'added');
  }

  async onUpdate(job: SideEffectJobConfig): Promise<void> {
    const { args, previousValue } = job;
    const prev = previousValue as TicketTagPreviousValue | undefined;
    const ticketId: string | undefined = args?.ticketId ?? prev?.ticketId;

    if (!ticketId) {
      logger.warn('[TicketTagsSideEffectHandler] Missing ticketId in update args and previousValue');
      return;
    }

    await this.queueTicketVespaFeed(ticketId);
  }

  async onDelete(job: SideEffectJobConfig): Promise<void> {
    const { previousValue } = job;

    if (!previousValue) {
      logger.warn('[TicketTagsSideEffectHandler] No previousValue for ticket_tags delete');
      return;
    }

    const prev = previousValue as TicketTagPreviousValue;
    await this.handleTagActivity(prev.ticketId, prev.tagName, 'removed');
    await this.queueTicketVespaFeed(prev.ticketId);
    await this.broadcastTicketCountsUpdate(prev.ticketId, prev.tagName, 'removed');
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
      logger.error('[TicketTagsSideEffectHandler] Failed to queue ticket Vespa feed:', {
        ticketId,
        error: error instanceof Error ? error.message : String(error),
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

      await db.ticketActivity.create({
        data: {
          id: uuidv4(),
          ticketId,
          updatedBy: this.ctx.userID,
          timestamp: now,
          activityType: ActivityType.TAGS,
          value: activityValue,
        },
      });

      if (!ticket?.conversationId || !user?.name) {
        return;
      }

      const content =
        action === 'added'
          ? `${user.name} added a label: ${tagName}`
          : `${user.name} removed a label: ${tagName}`;

      await db.message.create({
        data: {
          messageId: uuidv4(),
          conversationId: ticket.conversationId,
          senderId: this.ctx.userID,
          content,
          msgType: 'SYSTEM',
          hasAttachment: false,
          edited: false,
          isDeleted: false,
          isSent: true,
          showInChannel: false,
          createdAt: now,
          metadata: {
            activityType: 'TAGS',
            isTicketActivity: true,
          },
        },
      });
    } catch (error) {
      logger.error('[TicketTagsSideEffectHandler] Failed to handle tag activity:', {
        ticketId,
        tagName,
        action,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async broadcastTicketCountsUpdate(
    ticketId: string,
    tagName: string,
    action: 'added' | 'removed',
  ): Promise<void> {
    const snapshot = await buildKanbanCountsSnapshot(ticketId);
    if (!snapshot) return;

    const tags = snapshot.tags.filter(tag => tag !== tagName);
    const previousTags = action === 'added' ? tags : [...tags, tagName];

    websocketService.broadcastTicketCountsUpdate({
      operation: 'update',
      ticket: snapshot,
      previousTicket: {
        ...snapshot,
        tags: previousTags,
      },
    });
  }
}
