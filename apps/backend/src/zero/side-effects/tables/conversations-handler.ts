import { BaseSideEffectHandler } from '../base-handler';
import type { SideEffectJobConfig, ConversationPreviousValue } from '../types';
import { db } from '@/database/client';
import { handleUnreadCount } from '@/zero/utils/unreadCountUtlis';
import { ChannelScopeType } from '@xyne/shared';
import { connectDmService } from '@/services/connectDmService';
import { logger } from '@/utils/logger';


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

    // Slack-Connect: a cross-org DM's guest pointers are materialised lazily on its FIRST conversation
    // (the composer's silent auto-creates only make the hidden host channel, so intermediate group
    // selections don't litter guest orgs). Idempotent + no-op unless this is a connect DM/GroupDM whose
    // foreign members aren't linked yet.
    await connectDmService
      .materializeForHostDmChannel(conversation.channelId)
      .catch(err =>
        logger.error(
          `[ConversationsHandler] connect DM materialise failed for ${conversation.channelId}: ${err}`,
        ),
      );

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

