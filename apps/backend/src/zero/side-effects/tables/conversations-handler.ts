import { BaseSideEffectHandler } from '../base-handler';
import type { SideEffectJobConfig, ConversationPreviousValue } from '../types';
import { db } from '@/database/client';
import { handleUnreadCount } from '@/zero/utils/unreadCountUtlis';
import { ChannelScopeType } from '@xyne/shared';


export class ConversationsSideEffectHandler extends BaseSideEffectHandler {

  async onInsert(job: SideEffectJobConfig): Promise<void> {
    const {entityId: conversationId} = job;

    const conversation = await db.conversation.findUnique({
      where: { conversationId },
      select: { channelId: true, createdBy: true, createdAt: true }
    });

    if (!conversation) {
      return;
    }

    const [channel, channelParticipantsRaw] = await Promise.all([
      db.channel.findUnique({
        where: { id: conversation.channelId },
        select: { scopeType: true }
      }),
      db.channelParticipant.findMany({
        where: { channelId: conversation.channelId },
        select: { userId: true }
      })
    ]);

    // Non DM channels unread count is handled by messages handler because of activity creation
    const isDMChannel = channel?.scopeType === ChannelScopeType.DM || channel?.scopeType === ChannelScopeType.GROUP_DM;
    if (channelParticipantsRaw.length === 0 || !isDMChannel) {
      return;
    }

    // handleUnreadCount skips recompute when lastActivityAt <= lastViewedAt, but ordinary
    // messages never bump channel_stats.lastActivityAt — only channel creation, membership
    // changes and calls do. Bump it to the conversation's createdAt so recompute runs and
    // unreadCount doesn't freeze at 0 for every channel the user has already viewed.
    // updateMany (not update): never throws on a missing channel_stats row, and the
    // lastActivityAt guard makes the write monotonic — a redelivered older side-effect
    // can never move the timestamp (and the DM shelf ordering) backward.
    await db.channelStats.updateMany({
      where: {
        channelId: conversation.channelId,
        lastActivityAt: { lt: conversation.createdAt }
      },
      data: { lastActivityAt: conversation.createdAt }
    });

    await handleUnreadCount(
      conversation.channelId,
      isDMChannel,
      channelParticipantsRaw,
      conversation.createdBy
    );
  }

  async onDelete(job: SideEffectJobConfig): Promise<void> {
    const previousValue = job.previousValue as ConversationPreviousValue | undefined;

    const [channel, channelParticipantsRaw] = await Promise.all([
      db.channel.findUnique({
        where: { id: previousValue?.channelId },
        select: { scopeType: true }
      }),
      db.channelParticipant.findMany({
        where: { channelId: previousValue?.channelId },
        select: { userId: true }
      })
    ]);

    if (channelParticipantsRaw.length === 0 && !previousValue?.channelId) {
      return;
    }

    const isDMChannel = channel?.scopeType === ChannelScopeType.DM || channel?.scopeType === ChannelScopeType.GROUP_DM;

    await handleUnreadCount(
      previousValue!.channelId,
      isDMChannel,
      channelParticipantsRaw
    );

  }
}

