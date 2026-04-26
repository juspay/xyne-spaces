import { db } from '@/database/client';
import { logger } from '@/utils/logger';

/**
 * Decrement channel_user_status.unreadCount for a user in the channel that
 * owns the given ticket. No-op if the ticket / status row is missing or the
 * count is already 0. Shared between the email_reads side-effect handler
 * (when a user marks read via the UI) and emailService (when we auto-advance
 * a sender's read state on outbound — direct Prisma writes there bypass
 * Zero side-effects).
 */
export async function decrementChannelUnreadForTicket(
  userId: string,
  ticketId: string,
): Promise<void> {
  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    select: { channelId: true },
  });
  if (!ticket?.channelId) return;

  const status = await db.channelUserStatus.findUnique({
    where: {
      channelId_userId: { channelId: ticket.channelId, userId },
    },
    select: { unreadCount: true },
  });
  if (!status || status.unreadCount <= 0) return;

  const next = Math.max(0, status.unreadCount - 1);
  await db.channelUserStatus.update({
    where: {
      channelId_userId: { channelId: ticket.channelId, userId },
    },
    data: { unreadCount: next, updatedAt: new Date() },
  });
  logger.info(
    `[ChannelUnread] decremented channel=${ticket.channelId} user=${userId} ${status.unreadCount} → ${next}`,
  );
}
