import { transaction } from '../base';
import { NoteTakerCallRepository } from '@/database/repositories/noteTakerCallRepository';
import { type Prisma } from '@prisma/client';
import { MessageType, CallType, CallStatus } from '@xyne/shared';


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
/**
 * Owner deleted a thread-linked recording. The anchor is removed outright — a
 * soft delete would still render a "message deleted" row in the thread — along
 * with its attachments and reactions, the reply it added to the thread's count
 * is taken back, and the thread's live-recording state is cleared.
 * updateThreadMessageOnEnd never gets to do that last part once the Call row is
 * gone, because room_finished then fails on "Call not found".
 */
export function markThreadAnchorDeletedTx(self: NoteTakerCallRepository, messageId: string, conversationId: string) {
  return transaction(['Conversation', 'Message', 'MessageAttachment', 'Reaction', 'ReactionCount'], 'markThreadAnchorDeleted: anchor removal, its attachments, the thread reply count and live-recording flag must change atomically; tx is not ACL-wrapped', self.db, async (tx) => {
    // Same teardown order as recordingSharingService's share-message removal.
    await Promise.all([
      tx.messageAttachment.deleteMany({ where: { entityId: messageId } }),
      tx.reaction.deleteMany({ where: { messageId } }),
      tx.reactionCount.deleteMany({ where: { messageId } }),
    ]);
    const removed = await tx.message.deleteMany({ where: { messageId } });

    // createThreadAnchorMessage incremented replyCount for the anchor; undo that
    // only if the anchor was actually still there (the owner may have removed it).
    if (removed.count > 0) {
      const conversation = await tx.conversation.findUnique({
        where: { conversationId },
        select: { replyCount: true },
      });
      if (conversation) {
        await tx.conversation.update({
          where: { conversationId },
          data: { replyCount: Math.max(0, conversation.replyCount - 1) },
        });
      }
    }

    await self.clearConversationRecordingState(tx, conversationId);
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
