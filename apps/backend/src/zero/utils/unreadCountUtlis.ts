import { db } from "@/database/client";
import { withWorkspaceScope } from "@/database/tenant/context";

/** Recomputes every recipient's unread count, so it reads and writes other users' rows. */
export async function handleUnreadCount(
    channelId: string,
    isDMChannel: boolean,
    channelParticipants: Array<{ userId: string }>,
    senderId?: string
  ): Promise<void> {
    return withWorkspaceScope(() =>
      handleUnreadCountInner(channelId, isDMChannel, channelParticipants, senderId),
    );
  }

async function handleUnreadCountInner(
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
      select: { userId: true, lastViewedAt: true, unreadCount: true }
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
            if (unreadCount !== status.unreadCount) {
              await db.channelUserStatus.update({
                where: { channelId_userId: { channelId, userId: status.userId } },
                data: { unreadCount, updatedAt: new Date() }
              });
            }
          }
        })
      );
    } else {
      await Promise.all(
        statuses.map(async (status) => {
          // Only unread top-level message activities count toward a channel
          // badge; ticket/canvas/call activities and thread replies never do.
          const activities = await db.activity.findMany({
            where: {
              userId: status.userId,
              channelId,
              isRead: false,
              actionSource: 'message',
              actorAction: { notIn: ['added', 'added_v2', 'removed'] },
              classification: { not: 'SKIP' },
              isThreadActivity: { not: true },
            },
            select: {
              messageId: true,
              actionSourceId: true
            }
          });

          // Dedupe by message so several activities on the same top-level
          // message (e.g. a reply plus a mention) still count once.
          const uniqueMessageIds = new Set(activities.map(a => a.messageId ?? a.actionSourceId));
          const unreadActivitiesCount = uniqueMessageIds.size;

          if (unreadActivitiesCount !== status.unreadCount) {
            await db.channelUserStatus.update({
              where: { channelId_userId: { channelId, userId: status.userId } },
              data: { unreadCount: unreadActivitiesCount, updatedAt: new Date() }
            });
          }
        })
      );
    }
  }
