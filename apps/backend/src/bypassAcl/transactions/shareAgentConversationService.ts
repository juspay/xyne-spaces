import { transaction } from '../base';
import { db } from '@/database/client';
import { SharedCitationInvocation, ShareAgentConversationError, destinationNoun, channelParticipantRepository } from '@/services/shareAgentConversationService';
import { Prisma } from '@prisma/client';
import { ChannelRole, MessageType } from '@xyne/shared';
import { advisoryXactLockExtended } from '@/bypassAcl/lockServices';


export function shareAgentConversationToChannelTx(workspaceId: string, sourceConversationId: string, targetChannelId: string, userId: string, shareOperationId: string, tipMessageId: string, reShareConfirmed: boolean, channel: any, addAgentConfirmed: boolean, agentAppUser: { userId: string; name: string; } | null, agentSeenCutoffAt: Date | null, agentSlug: string, agentName: string, visibleCount: number, trimmedNote: string, citationMetadata: { clawCitations: SharedCitationInvocation[]; clawCitationIcons?: Record<string, string>; } | null, markdown: string) {
  return transaction(['AgentConversationShare', 'ChannelStats', 'Conversation', 'Message'], 'shareAgentConversationToChannel: advisory-locked, idempotent share — the share row, copied conversation, messages and channel stats must commit together; tx is not ACL-wrapped', db, async (tx) => {
    const lockKey = `${workspaceId}:${sourceConversationId}:${targetChannelId}`;
    await advisoryXactLockExtended(tx, ['AgentConversationShare'],
      'agent conversation share: serialize share creation per (workspace, conversation, channel)',
      lockKey);

    const operation = await tx.agentConversationShare.findUnique({
      where: {
        workspaceId_targetChannelId_sharedBy_shareOperationId: {
          workspaceId,
          targetChannelId,
          sharedBy: userId,
          shareOperationId,
        },
      },
    });
    if (operation)
      return { row: operation, reusedExisting: true, conversation: null, message: null };

    const latest = await tx.agentConversationShare.findFirst({
      where: { workspaceId, sourceConversationId, targetChannelId },
      orderBy: { createdAt: 'desc' },
      select: { sourceTipMessageId: true },
    });
    if (latest?.sourceTipMessageId === tipMessageId) {
      throw new ShareAgentConversationError(
        'NO_NEW_MESSAGES',
        'Nothing new has been added to this conversation since it was last shared'
      );
    }
    if (latest && !reShareConfirmed) {
      throw new ShareAgentConversationError(
        'RESHARE_CONFIRMATION_REQUIRED',
        `Confirm that sharing again creates a new, separate thread in the ${destinationNoun(channel.scopeType)}`
      );
    }

    let agentAdded = false;
    if (addAgentConfirmed && agentAppUser) {
      ({ added: agentAdded } = await channelParticipantRepository.addParticipantInTransaction(
        tx,
        targetChannelId,
        agentAppUser.userId,
        agentSeenCutoffAt,
        ChannelRole.MEMBER
      ));
    }

    const now = new Date();

    const displayMetadata: Prisma.InputJsonObject = {
      sharedAgentTranscript: true,
      contentFormat: 'markdown',
      agentSlug,
      agentName,
      messageCount: visibleCount,
      ...(trimmedNote ? { shareNote: trimmedNote } : {}),
      ...(citationMetadata ?? {}),
    };

    const conversation = await tx.conversation.create({
      data: {
        channelId: targetChannelId,
        createdBy: userId,
        initialMessageId: 'temp',
        workspaceId,
        lastActivityAt: now,
        replyCount: 0,
        pinned: false,
      },
    });
    const message = await tx.message.create({
      data: {
        conversationId: conversation.conversationId,
        senderId: userId,
        workspaceId,
        content: markdown,
        msgType: MessageType.USER,
        hasAttachment: false,
        metadata: displayMetadata,
      },
    });
    await tx.conversation.update({
      where: { conversationId: conversation.conversationId },
      data: { initialMessageId: message.messageId },
    });
    await tx.channelStats.upsert({
      where: { channelId: targetChannelId },
      update: { lastActivityAt: now },
      create: { channelId: targetChannelId, lastActivityAt: now, workspaceId },
    });

    const row = await tx.agentConversationShare.create({
      data: {
        workspaceId,
        sourceConversationId,
        sourceTipMessageId: tipMessageId,
        agentSlug,
        targetChannelId,
        targetConversationId: conversation.conversationId,
        targetMessageId: message.messageId,
        sharedBy: userId,
        shareOperationId,
        sharedMessageCount: visibleCount,
          agentAdded,
      },
    });
    return { row, reusedExisting: false, conversation, message };
  });
}
