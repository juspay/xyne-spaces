import { transaction } from '../base';
import { NoteTakerCallRepository } from '@/database/repositories/noteTakerCallRepository';
import { type Prisma } from '@prisma/client';
import { MessageType, CallType, CallStatus, AttachmentEntityType } from '@xyne/shared';
import { deleteMessageSearchRow } from '@/bypassAcl/searchIndexServices';


export function createThreadAnchorMessageTx(self: NoteTakerCallRepository, messageId: string, conversationId: string, workspaceId: string, initiator: any, now: Date, callExternalId: string, notesCanvasId: string, createdBy: string, existingMetadata: Record<string, unknown>, callId: string, detailedSummaryCanvasId: string, channelId: string) {
  return transaction(['Call', 'Conversation', 'Message'], 'createThreadAnchorMessage: anchor message, conversation flag and call metadata must commit atomically; tx is not ACL-wrapped', self.db, async (tx) => {
    await tx.message.create({
      data: {
        messageId,
        conversationId,
        workspaceId,
        senderId: 'system',
        content: `${initiator?.displayName || initiator?.name || 'Someone'} started recording notes`,
        msgType: MessageType.SYSTEM,
        showInChannel: false,
        createdAt: now,
        metadata: {
          isRecordingMessage: true,
          isHeadlessRecording: true,
          callId: callExternalId,
          callType: CallType.HEADLESS,
          operation: 'recording_active',
          notesCanvasId,
          createdBy,
        },
      },
    });

    // Marks the conversation as having a live recording attached.
    await tx.conversation.update({
      where: { conversationId },
      data: {
        callId: callExternalId,
        metadata: { ...existingMetadata, isHeadlessRecording: true } as Prisma.InputJsonValue,
      },
    });


    const currentCall = await tx.call.findUnique({ where: { id: callId }, select: { metadata: true } });
    const currentCallMetadata: Record<string, unknown> =
      currentCall?.metadata && typeof currentCall.metadata === 'object' && !Array.isArray(currentCall.metadata)
        ? (currentCall.metadata as Record<string, unknown>)
        : {};
    await tx.call.update({
      where: { id: callId },
      data: {
        metadata: {
          ...currentCallMetadata,
          notesCanvasId,
          detailedSummaryCanvasId,
          conversationId,
          messageId,
          channelId,
        } as Prisma.InputJsonValue,
      },
    });
  });
}
export type ThreadAnchorRemoval =
  | { removed: true }
  | { removed: false; reason: 'anchor_missing' | 'not_recording_anchor' };

/**
 * Owner deleted a thread-linked recording. The anchor is removed outright — a
 * soft delete would still render a "message deleted" row in the thread. Server-side
 * deletes never reach MessagesSideEffectHandler.onDelete, so the same cleanup it does
 * for a user delete is repeated here: attachments, reactions and their activities,
 * the search-index row, the thread's reply count and every participant's lastReplyAt.
 * The thread's live-recording state is cleared too — updateThreadMessageOnEnd never
 * gets to do that once the Call row is gone, because room_finished then fails on
 * "Call not found". A MESSAGE_DELETED notification is not sent and no artifact sync
 * runs: the normal path skips both for SYSTEM messages, which the anchor is.
 */
export function markThreadAnchorDeletedTx(self: NoteTakerCallRepository, messageId: string, conversationId: string, callExternalId: string): Promise<ThreadAnchorRemoval> {
  return transaction(['Activity', 'Conversation', 'ConversationParticipant', 'Message', 'MessageAttachment', 'Reaction', 'ReactionCount'], 'markThreadAnchorDeleted: anchor removal with its attachments, reactions, activities, search row, thread reply bookkeeping and live-recording flag must change atomically; tx is not ACL-wrapped', self.db, async (tx) => {
    // The id comes from call.metadata, so never trust it blindly: only remove the bot
    // anchor createThreadAnchorMessageTx wrote for this very recording. Anything else
    // — a user's message, another recording's anchor — is left alone.
    const anchor = await tx.message.findUnique({
      where: { messageId },
      select: { senderId: true, msgType: true, conversationId: true, metadata: true },
    });
    if (!anchor) {
      await self.clearConversationRecordingState(tx, conversationId);
      return { removed: false, reason: 'anchor_missing' };
    }
    const anchorMetadata =
      anchor.metadata && typeof anchor.metadata === 'object' && !Array.isArray(anchor.metadata)
        ? (anchor.metadata as Record<string, unknown>)
        : {};
    const isRecordingAnchor =
      anchor.senderId === 'system' &&
      anchor.msgType === MessageType.SYSTEM &&
      anchor.conversationId === conversationId &&
      anchorMetadata.isRecordingMessage === true &&
      anchorMetadata.isHeadlessRecording === true &&
      anchorMetadata.callId === callExternalId;
    if (!isRecordingAnchor) {
      await self.clearConversationRecordingState(tx, conversationId);
      return { removed: false, reason: 'not_recording_anchor' };
    }

    // Mirrors deleteConversationMessageTx + MessagesSideEffectHandler.onDelete.
    const reactions = await tx.reaction.findMany({ where: { messageId }, select: { reactionId: true } });
    const reactionIds = reactions.map(reaction => reaction.reactionId);
    await tx.messageAttachment.deleteMany({
      where: { entityId: messageId, entityType: AttachmentEntityType.CHAT },
    });
    await tx.reaction.deleteMany({ where: { messageId } });
    await tx.reactionCount.deleteMany({ where: { messageId } });
    await tx.activity.deleteMany({
      where: {
        OR: [
          { actionSource: 'message', actionSourceId: messageId },
          ...(reactionIds.length > 0 ? [{ actionSource: 'reaction', actionSourceId: { in: reactionIds } }] : []),
        ],
      },
    });
    await deleteMessageSearchRow(tx, messageId);
    await tx.message.deleteMany({ where: { messageId } });

    // createThreadAnchorMessage ran incrementReplyCount for the anchor: it bumped the
    // thread's replyCount and moved every participant's lastReplyAt to the anchor.
    // Roll both back to the latest reply that is still there.
    const conversation = await tx.conversation.findUnique({
      where: { conversationId },
      select: { initialMessageId: true, replyCount: true },
    });
    if (conversation) {
      const latestReply = await tx.message.findFirst({
        where: { conversationId, isDeleted: false, messageId: { not: conversation.initialMessageId } },
        select: { createdAt: true },
        orderBy: { createdAt: 'desc' },
      });
      await tx.conversation.update({
        where: { conversationId },
        data: { replyCount: Math.max(0, conversation.replyCount - 1) },
      });
      await tx.conversationParticipant.updateMany({
        where: { conversationId, lastReplyAt: { not: null } },
        data: { lastReplyAt: latestReply?.createdAt ?? null },
      });
    }

    await self.clearConversationRecordingState(tx, conversationId);
    return { removed: true };
  });
}
export function handleParticipantLeaveTx(self: NoteTakerCallRepository, callExternalId: string, userId: string, leftAt: Date) {
  return transaction(['Call', 'Conversation', 'Message'], 'handleParticipantLeave: call end status and thread anchor/conversation cleanup must commit atomically; tx is not ACL-wrapped', self.db, async (tx) => {
    const call = await tx.call.findUnique({ where: { externalId: callExternalId } });
    if (!call) return { shouldEndCall: false, call: null };

    if (call.createdByUserId !== userId || call.status === CallStatus.ENDED) {
      return { shouldEndCall: false, call };
    }

    await tx.call.update({
      where: { id: call.id },
      data: { status: CallStatus.ENDED, endedAt: leftAt },
    });

    await self.updateThreadMessageOnEnd(tx, call, leftAt);

    return { shouldEndCall: true, call };
  });
}
export function handleRoomFinishedTx(self: NoteTakerCallRepository, callExternalId: string, endedAt: Date) {
  return transaction(['Call', 'Conversation', 'Message'], 'handleRoomFinished: call end status and thread anchor/conversation cleanup must commit atomically; tx is not ACL-wrapped', self.db, async (tx) => {
    const call = await tx.call.findUnique({ where: { externalId: callExternalId } });
    if (!call) return { shouldEndCall: false, call: null };

    if (call.status === CallStatus.ENDED) {
      return { shouldEndCall: false, call };
    }

    await tx.call.update({
      where: { id: call.id },
      data: { status: CallStatus.ENDED, endedAt },
    });

    await self.updateThreadMessageOnEnd(tx, call, endedAt);

    return { shouldEndCall: true, call };
  });
}
