import { db } from '@/database/client';
import { logger } from '@/utils/logger';

export async function decrementChannelUnreadForTicket(
  userId: string,
  ticketId: string,
): Promise<void> {
  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    select: { channelId: true },
  });
  if (!ticket?.channelId) return;

  const result = await db.channelUserStatus.updateMany({
    where: {
      channelId: ticket.channelId,
      userId,
      unreadCount: { gt: 0 },
    },
    data: {
      unreadCount: { decrement: 1 },
      updatedAt: new Date(),
    },
  });
  if (result.count > 0) {
    logger.info(
      `[ChannelUnread] decremented channel=${ticket.channelId} user=${userId}`,
    );
  }
}
