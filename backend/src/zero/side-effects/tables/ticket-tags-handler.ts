import { v4 as uuidv4 } from 'uuid';
import { ActivityType } from '@prisma/client';
import { BaseSideEffectHandler } from '../base-handler';
import type { SideEffectJobConfig, TicketTagPreviousValue } from '../types';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';

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
  }

  async onDelete(job: SideEffectJobConfig): Promise<void> {
    const { previousValue } = job;

    if (!previousValue) {
      logger.warn('[TicketTagsSideEffectHandler] No previousValue for ticket_tags delete');
      return;
    }

    const prev = previousValue as TicketTagPreviousValue;
    await this.handleTagActivity(prev.ticketId, prev.tagName, 'removed');
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
}
