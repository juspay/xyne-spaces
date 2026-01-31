import { BaseSideEffectHandler } from '../base-handler';
import type { SideEffectJobConfig } from '../types';
import { db } from '@/database/client';
import { handleUnreadCount } from '@/zero/utils/unreadCountUtlis';


export class ConversationsSideEffectHandler extends BaseSideEffectHandler {

  async onInsert(job: SideEffectJobConfig): Promise<void> {
    const {entityId: conversationId} = job;

    const conversation = await db.conversation.findUnique({
      where: { conversationId },
      select: { channelId: true, createdBy: true }
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
    const isDMChannel = channel?.scopeType === 'DM' || channel?.scopeType === 'GROUP_DM';
    if (channelParticipantsRaw.length === 0 || !isDMChannel) {
      return;
    }

    await handleUnreadCount(
      conversation.channelId,
      isDMChannel,
      channelParticipantsRaw,
      conversation.createdBy
    );
  }

  async onDelete(job: SideEffectJobConfig): Promise<void> {
    const {previousValue} = job;
    
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

    const isDMChannel = channel?.scopeType === 'DM' || channel?.scopeType === 'GROUP_DM';

    await handleUnreadCount(
      previousValue!.channelId,
      isDMChannel,
      channelParticipantsRaw
    );

  }
}

