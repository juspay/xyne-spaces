import { db } from "@/database/client";

export async function handleUnreadCount(
    channelId: string,
    isDMChannel: boolean,
    channelParticipants: Array<{ userId: string }>,
    senderId?: string
  ): Promise<void> {
    const recipientIds = senderId ? channelParticipants.map(p => p.userId).filter(id => id !== senderId) : channelParticipants.map(p => p.userId);
    const channelStats = await db.channelStats.findUnique({
      where: { channelId },
      select: { lastActivityAt: true }
    });
    if (recipientIds.length === 0 || !channelStats?.lastActivityAt) return;

    const statuses = await db.channelUserStatus.findMany({
      where: { channelId, userId: { in: recipientIds }, isDeleted: false },
      select: { userId: true, lastViewedAt: true }
    });

    if (isDMChannel) {
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
            await db.channelUserStatus.update({
              where: { channelId_userId: { channelId, userId: status.userId } },
              data: { unreadCount, updatedAt: new Date() }
            });
          }
        })
      );
    } else {
      await Promise.all(
        statuses.map(async (status) => {
          const activities = await db.activity.findMany({
            where: {
              userId: status.userId,
              channelId,
              isRead: false,
              actionSource: 'message',
            },
            select: {
              id: true,
              actionSourceId: true
            }
          });

          const messageIds = activities.map(a => a.actionSourceId);

          let unreadActivitiesCount = 0;
          if (messageIds.length > 0) {
            for (const messageId of messageIds) {
              const conversation = await db.conversation.findFirst({
                where: { initialMessageId: messageId },
                select: { conversationId: true }
              });
              if (conversation) {
                unreadActivitiesCount++;
              }
            }
          }

          await db.channelUserStatus.update({
            where: { channelId_userId: { channelId, userId: status.userId } },
            data: { unreadCount: unreadActivitiesCount, updatedAt: new Date() }
          });
        })
      );
    }
  }