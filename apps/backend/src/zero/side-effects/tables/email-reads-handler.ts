import { BaseSideEffectHandler } from '../base-handler';
import type { EmailReadPreviousValue, SideEffectJobConfig } from '../types';
import { db } from '@/database/client';
import { decrementChannelUnreadForTicket } from '@/utils/channelUnread';
import { websocketService } from '@/services/websocketService';
import { logger } from '@/utils/logger';

/**
 * When a user upserts their email_reads row (insert = first time opening the
 * thread; update = opening it again after a new reply), decrement that user's
 * channel_user_status.unreadCount by 1 so the desk badge stays consistent.
 *
 * The same count predicate drives per-label unread badges, so the channel's
 * label-unread-counts room is invalidated on every real read as well.
 *
 * No-op updates (lastReadEmailId unchanged) are filtered to prevent double
 * decrements when the UI re-fires markAsRead on re-renders.
 */
export class EmailReadsSideEffectHandler extends BaseSideEffectHandler {
  private async decrementChannelUnread(emailReadId: string): Promise<void> {
    const emailRead = await db.emailRead.findUnique({
      where: { id: emailReadId },
      select: { ticketId: true, userId: true },
    });
    if (!emailRead) return;
    await decrementChannelUnreadForTicket(emailRead.userId, emailRead.ticketId);

    const ticket = await db.ticket.findUnique({
      where: { id: emailRead.ticketId },
      select: { channelId: true },
    });
    if (ticket?.channelId) {
      websocketService.broadcastLabelUnreadCountsUpdate(ticket.channelId);
    }
  }

  async onInsert(job: SideEffectJobConfig): Promise<void> {
    // First time the user has opened this thread — decrement.
    await this.decrementChannelUnread(job.entityId);
  }

  async onUpdate(job: SideEffectJobConfig): Promise<void> {
    // Only decrement when the stored lastReadEmailId actually changed.
    // A no-op update (same id) means the UI re-fired markAsRead without
    // anything new to mark — shouldn't double-decrement the badge.
    const prev = job.previousValue as EmailReadPreviousValue | undefined;
    const args = job.args as { lastReadEmailId?: string } | undefined;
    if (prev && args?.lastReadEmailId && prev.lastReadEmailId === args.lastReadEmailId) {
      return;
    }
    await this.decrementChannelUnread(job.entityId);
  }

  async onDelete(job: SideEffectJobConfig): Promise<void> {
    // Mark-as-unread deletes the row; recompute-only — do NOT touch
    // channel_user_status.unreadCount (user deliberately re-flagged unread).
    const prev = job.previousValue as EmailReadPreviousValue | undefined;
    if (!prev?.ticketId) {
      logger.warn('[email-reads-handler] delete without previousValue.ticketId, skipping');
      return;
    }
    const ticket = await db.ticket.findUnique({
      where: { id: prev.ticketId },
      select: { channelId: true },
    });
    if (ticket?.channelId) {
      websocketService.broadcastLabelUnreadCountsUpdate(ticket.channelId);
    }
  }
}
