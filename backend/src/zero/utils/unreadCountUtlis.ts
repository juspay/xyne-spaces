import { db } from "@/database/client";

export async function handleUnreadCount(
    channelId: string,
    isDMChannel: boolean,
    channelParticipants: Array<{ userId: string }>,
    senderId?: string
  ): Promise<void> {
    // For non-DM channels, unread count is derived from activities on the frontend
    if (!isDMChannel) return;

    const recipientIds = senderId ? channelParticipants.map(p => p.userId).filter(id => id !== senderId) : channelParticipants.map(p => p.userId);
    const channelStats = await db.channelStats.findUnique({
      where: { channelId },
      select: { lastActivityAt: true }
    });
    if (recipientIds.length === 0 || !channelStats?.lastActivityAt) return;

    const statuses = await db.channelUserStatus.findMany({
      where: { channelId, userId: { in: recipientIds }, isDeleted: false },
      select: { userId: true, lastViewedAt: true, unreadCount: true }
    });

    await Promise.all(
      statuses.map(async (status) => {
        if (!status.lastViewedAt || channelStats?.lastActivityAt > status.lastViewedAt) {
          const whereClause: { channelId: string; createdAt?: { gt: Date } } = {
            channelId
          };
          if (status.lastViewedAt) {
            whereClause.createdAt = { gt: status.lastViewedAt };
          }
          const unreadCount = await db.conversation.count({
            where: whereClause
          });
          if (unreadCount !== status.unreadCount) {
            await db.channelUserStatus.update({
              where: { channelId_userId: { channelId, userId: status.userId } },
              data: { unreadCount, updatedAt: new Date() }
            });
          }
        }
      })
    );
  }
