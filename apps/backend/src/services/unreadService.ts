import { DatabaseClient } from '@/database/client';
import { NotificationType } from '@xyne/shared';
import {logger} from '@/utils/logger';
import { notificationService } from './notificationService';

const prisma = DatabaseClient.getInstance();

export class UnreadService {
  async markThreadAsViewed(
    conversationId: string,
    userId: string
  ): Promise<void> {
    try {
      const viewedAt = new Date();

      const conversation = await prisma.conversation.findUnique({
        where: { conversationId },
        select: { channelId: true, initialMessageId: true }
      });

      if (!conversation) {
        logger.warn(`Cannot mark thread as viewed: conversation ${conversationId} not found`);
        return;
      }

      await prisma.conversationParticipant.update({
        where: {
          conversationId_userId: { conversationId, userId }
        },
        data: {
          lastReadAt: viewedAt,
        }
      });
      await prisma.activity.updateMany({
        where: {
          userId,
          conversationId,
          isRead: false,
        }, data: {
          isRead: true,
        }
      });

      await notificationService.createNotification(userId, {
        title: 'Silent notification',
        message: 'silent notification',
        type: NotificationType.THREAD_READ,
        metadata: { conversationId }
      }, { sendDesktop: true, sendMobile: true, isSilent: true });
    } catch (error) {
      logger.error('Error marking thread as viewed:', error);
      throw error;
    }
  }

  async getUnreadCountForChannel(channelId: string, userId: string): Promise<number> {

    try {
      const participant = await prisma.channelUserStatus.findUnique({
        where: { 
          channelId_userId: { channelId, userId } 
        },
        select: { 
          lastViewedAt: true, 
          lastViewedConversationId: true 
        }
      });

      if (!participant) {
        return 0;
      }

      const unreadCount = await prisma.conversation.count({
        where: {
          channelId: channelId,
          createdAt: { gt: participant.lastViewedAt }
        }
      });

      return unreadCount;
    } catch (error) {
      logger.error('Error calculating unread count:', error);
      return 0;
    }
  }

  async markChannelAsViewed(
    channelId: string,
    userId: string,
    conversationId?: string 
  ): Promise<void> {
    try {
      const viewedAt = new Date();
      const seenConversations = await prisma.conversation.findMany({
        where: {
          channelId,
          createdAt: { lte: viewedAt },
        },
        orderBy: { createdAt: 'desc' },
        take: 25,
        select: { createdAt: true },
      });
      await prisma.activity.updateMany({
        where: {
          userId,
          channelId,
          isRead: false,
        }, data: {
          isRead: true,
        }
      });
      const conversationSeenCutoffAt =
        seenConversations[seenConversations.length - 1]?.createdAt ?? viewedAt;

      const updateData: {
        lastViewedAt: Date;
        conversationSeenCutoffAt: Date;
        lastViewedConversationId?: string;
        updatedAt: Date;
        unreadCount: number;
      } = {
        lastViewedAt: viewedAt,
        conversationSeenCutoffAt,
        updatedAt: viewedAt,
        unreadCount: 0,
      };

      if (conversationId) {
        updateData.lastViewedConversationId = conversationId;
      }

      await prisma.channelUserStatus.update({
        where: {
          channelId_userId: { channelId, userId }
        },
        data: updateData
      });
      await notificationService.createNotification(userId, {
        title: 'Silent notification', 
        message: 'silent notification',
        type: NotificationType.CHANNEL_READ,
        metadata: {
          channelId: channelId,
        }
      }, { sendDesktop: true, sendMobile: true, isSilent: true });
    } catch (error) {
      logger.error('Error marking channel as viewed:', error);
      throw error;
    }
  }

  /**
   * Marks many channels viewed for one user, entirely on the server.
   *
   * Bulk "mark as read" is deliberately not a Zero mutator. Zero replays a mutator
   * optimistically on the browser's main thread before sending it, so a per-channel loop
   * runs in the user's tab: measured at ~640ms of blocking for a 60-channel section, which
   * froze the window on click. Doing the work here costs the client nothing — Zero
   * replication streams the updated rows back and the sidebar clears from those.
   *
   * Mirrors the `channel.markChannelAsViewed` Zero mutator's semantics, not this service's
   * own `markChannelAsViewed` above, which differs in two ways that matter:
   *   - only ROOT activities are marked read (an activity whose actionSourceId is its
   *     conversation's initialMessageId), so thread replies stay unread;
   *   - EMAIL channels keep their unreadCount.
   *
   * Reads are batched across the whole set; only the per-channel conversation cutoff stays
   * per channel, since it needs a per-channel ordered limit.
   */
  async markChannelsAsViewed(
    channelIds: string[],
    userId: string,
  ): Promise<{ channelsUpdated: number; activitiesRead: number }> {
    const uniqueChannelIds = [...new Set(channelIds)].filter(Boolean);
    if (uniqueChannelIds.length === 0) {
      return { channelsUpdated: 0, activitiesRead: 0 };
    }

    try {
      const viewedAt = new Date();

      const statuses = await prisma.channelUserStatus.findMany({
        where: { channelId: { in: uniqueChannelIds }, userId, isDeleted: false },
        select: { id: true, channelId: true },
      });
      if (statuses.length === 0) {
        return { channelsUpdated: 0, activitiesRead: 0 };
      }

      const presentChannelIds = statuses.map(s => s.channelId);

      const emailChannels = await prisma.channel.findMany({
        where: { id: { in: presentChannelIds }, type: 'EMAIL' },
        select: { id: true },
      });
      const emailChannelIds = new Set(emailChannels.map(c => c.id));

      // --- read state -------------------------------------------------------
      // The cutoff is the 25th-most-recent conversation per channel, so it cannot be
      // collapsed into a single query; the rest of the work below is batched.
      for (const status of statuses) {
        const seenConversations = await prisma.conversation.findMany({
          where: { channelId: status.channelId, createdAt: { lte: viewedAt } },
          orderBy: { createdAt: 'desc' },
          take: 25,
          select: { createdAt: true },
        });

        await prisma.channelUserStatus.update({
          where: { id: status.id },
          data: {
            lastViewedAt: viewedAt,
            conversationSeenCutoffAt:
              seenConversations[seenConversations.length - 1]?.createdAt ?? viewedAt,
            updatedAt: viewedAt,
            // An EMAIL channel's unreadCount is owned by the mail sync, not by viewing.
            ...(emailChannelIds.has(status.channelId) ? {} : { unreadCount: 0 }),
          },
        });
      }

      // --- activities -------------------------------------------------------
      const unread = await prisma.activity.findMany({
        where: { userId, channelId: { in: presentChannelIds }, isRead: false },
        select: { id: true, actionSourceId: true },
      });

      let activitiesRead = 0;
      if (unread.length > 0) {
        const sourceIds = [...new Set(unread.map(a => a.actionSourceId))].filter(
          (id): id is string => !!id,
        );

        // A root activity points at a message that opens its own conversation. Resolved by
        // asking for exactly those conversations, so thread replies are left untouched.
        const rootConversations = await prisma.conversation.findMany({
          where: { initialMessageId: { in: sourceIds } },
          select: { initialMessageId: true },
        });
        const rootMessageIds = new Set(rootConversations.map(c => c.initialMessageId));

        const rootActivityIds = unread
          .filter(a => a.actionSourceId && rootMessageIds.has(a.actionSourceId))
          .map(a => a.id);

        if (rootActivityIds.length > 0) {
          const result = await prisma.activity.updateMany({
            where: { id: { in: rootActivityIds } },
            data: { isRead: true },
          });
          activitiesRead = result.count;
        }
      }

      // One silent notification per channel, as the single-channel path sends. Best-effort
      // on purpose: the read state above is already committed, and these only nudge other
      // devices. Letting one rejection escape would fail the whole batch after the fact and
      // tell the user nothing was marked read when all of it was.
      const notified = await Promise.allSettled(
        presentChannelIds.map(channelId =>
          notificationService.createNotification(
            userId,
            {
              title: 'Silent notification',
              message: 'silent notification',
              type: NotificationType.CHANNEL_READ,
              metadata: { channelId },
            },
            { sendDesktop: true, sendMobile: true, isSilent: true },
          ),
        ),
      );
      const notifyFailures = notified.filter(r => r.status === 'rejected').length;
      if (notifyFailures > 0) {
        logger.warn(
          `markChannelsAsViewed: ${notifyFailures}/${presentChannelIds.length} CHANNEL_READ notifications failed; read state was still saved`,
        );
      }

      return { channelsUpdated: statuses.length, activitiesRead };
    } catch (error) {
      logger.error('Error marking channels as viewed:', error);
      throw error;
    }
  }
}

export const unreadService = new UnreadService();