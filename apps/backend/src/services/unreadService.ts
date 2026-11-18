import { DatabaseClient } from '@/database/client';
import { NotificationType } from '@xyne/shared';
import {logger} from '@/utils/logger';
import { notificationService } from './notificationService';

const prisma = DatabaseClient.getInstance();

/**
 * Upper bound on ids in a single `IN (...)` list. Postgres tolerates far more (its bind
 * parameter ceiling is ~65k), so this is about keeping one statement's plan predictable
 * rather than a hard limit — callers are never refused for sending more.
 */
const ID_QUERY_CHUNK = 2000;

/** Silent notifications sent at once during a bulk read. */
const NOTIFY_CONCURRENCY = 25;

function chunkIds(ids: readonly string[]): string[][] {
  if (ids.length === 0) return [];
  if (ids.length <= ID_QUERY_CHUNK) return [ids as string[]];
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += ID_QUERY_CHUNK) {
    chunks.push(ids.slice(i, i + ID_QUERY_CHUNK) as string[]);
  }
  return chunks;
}

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
   * Cost is flat in the number of channels: the read-state write is two `updateMany`s
   * (non-EMAIL, then EMAIL) rather than a query per channel, so 10 channels and 10,000
   * channels cost the same handful of statements. IN lists are chunked only to keep a
   * single statement's parameter count predictable.
   *
   * Mirrors the `channel.markChannelAsViewed` Zero mutator's semantics, not this service's
   * own `markChannelAsViewed` above, which differs in two ways that matter:
   *   - only ROOT activities are marked read (an activity whose actionSourceId is its
   *     conversation's initialMessageId), so thread replies stay unread;
   *   - EMAIL channels keep their unreadCount (the mail sync owns it, not viewing).
   *
   * `conversationSeenCutoffAt` is set to NULL rather than recomputed. That column is the
   * saved reading position — the boundary of the last page the user actually loaded — and
   * a non-null value routes the channel's first load through the cutoff-anchored query
   * (see useMessages.ts `shouldUseCutoffQuery`). Recomputing it per channel is what forced
   * the old per-channel loop, and it was recomputing it to "25 conversations from the top"
   * anyway, which already discarded wherever the user actually was. NULL instead means the
   * channel opens through the ordinary latest-conversations path, the same one a channel
   * the user has never opened uses — which is what "I have seen everything here" should do.
   * Callers only ever send channels that are currently unread (the sidebar's
   * selectChannelIdsToMarkRead filters to unread/bold), so an already-read channel's saved
   * position is never touched by this.
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

      const statuses: { id: string; channelId: string }[] = [];
      for (const ids of chunkIds(uniqueChannelIds)) {
        statuses.push(
          ...(await prisma.channelUserStatus.findMany({
            where: { channelId: { in: ids }, userId, isDeleted: false },
            select: { id: true, channelId: true },
          })),
        );
      }
      if (statuses.length === 0) {
        return { channelsUpdated: 0, activitiesRead: 0 };
      }

      const presentChannelIds = statuses.map(s => s.channelId);

      const emailChannelIds = new Set<string>();
      for (const ids of chunkIds(presentChannelIds)) {
        const rows = await prisma.channel.findMany({
          where: { id: { in: ids }, type: 'EMAIL' },
          select: { id: true },
        });
        for (const row of rows) emailChannelIds.add(row.id);
      }

      // --- read state -------------------------------------------------------
      // Two shapes of write, each one statement per chunk. See the note on
      // conversationSeenCutoffAt above for why nothing here is per channel.
      const emailIds = presentChannelIds.filter(id => emailChannelIds.has(id));
      const chatIds = presentChannelIds.filter(id => !emailChannelIds.has(id));

      for (const ids of chunkIds(chatIds)) {
        await prisma.channelUserStatus.updateMany({
          where: { channelId: { in: ids }, userId, isDeleted: false },
          data: {
            lastViewedAt: viewedAt,
            conversationSeenCutoffAt: null,
            unreadCount: 0,
            updatedAt: viewedAt,
          },
        });
      }
      for (const ids of chunkIds(emailIds)) {
        await prisma.channelUserStatus.updateMany({
          where: { channelId: { in: ids }, userId, isDeleted: false },
          data: {
            lastViewedAt: viewedAt,
            conversationSeenCutoffAt: null,
            updatedAt: viewedAt,
          },
        });
      }

      // --- activities -------------------------------------------------------
      const unread: { id: string; actionSourceId: string | null }[] = [];
      for (const ids of chunkIds(presentChannelIds)) {
        unread.push(
          ...(await prisma.activity.findMany({
            where: { userId, channelId: { in: ids }, isRead: false },
            select: { id: true, actionSourceId: true },
          })),
        );
      }

      let activitiesRead = 0;
      if (unread.length > 0) {
        const sourceIds = [...new Set(unread.map(a => a.actionSourceId))].filter(
          (id): id is string => !!id,
        );

        // A root activity points at a message that opens its own conversation. Resolved by
        // asking for exactly those conversations, so thread replies are left untouched.
        const rootMessageIds = new Set<string | null>();
        for (const ids of chunkIds(sourceIds)) {
          const rows = await prisma.conversation.findMany({
            where: { initialMessageId: { in: ids } },
            select: { initialMessageId: true },
          });
          for (const row of rows) rootMessageIds.add(row.initialMessageId);
        }

        const rootActivityIds = unread
          .filter(a => a.actionSourceId && rootMessageIds.has(a.actionSourceId))
          .map(a => a.id);

        for (const ids of chunkIds(rootActivityIds)) {
          const result = await prisma.activity.updateMany({
            where: { id: { in: ids } },
            data: { isRead: true },
          });
          activitiesRead += result.count;
        }
      }

      // Mobile dismisses its notification tray per channel off these (see
      // notifications/events/controlSignals.ts), so they cannot be collapsed into one
      // aggregate signal. They are the only remaining per-channel work, so they run
      // detached and in bounded waves: the read state above is already committed, and a
      // tray that clears a moment later is not worth making the caller wait for — nor
      // worth failing the whole operation over, which is what letting one rejection
      // escape used to do.
      void this.notifyChannelsRead(userId, presentChannelIds);

      return { channelsUpdated: statuses.length, activitiesRead };
    } catch (error) {
      logger.error('Error marking channels as viewed:', error);
      throw error;
    }
  }

  /**
   * Fire-and-forget silent CHANNEL_READ notifications, in waves so a large bulk read does
   * not open hundreds of simultaneous pushes. Never throws: failures are logged and
   * dropped, because the read state they accompany is already saved.
   */
  private async notifyChannelsRead(userId: string, channelIds: string[]): Promise<void> {
    let failures = 0;
    for (let i = 0; i < channelIds.length; i += NOTIFY_CONCURRENCY) {
      const wave = channelIds.slice(i, i + NOTIFY_CONCURRENCY);
      const settled = await Promise.allSettled(
        wave.map(channelId =>
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
      failures += settled.filter(r => r.status === 'rejected').length;
    }
    if (failures > 0) {
      logger.warn(
        `markChannelsAsViewed: ${failures}/${channelIds.length} CHANNEL_READ notifications failed; read state was still saved`,
      );
    }
  }
}

export const unreadService = new UnreadService();