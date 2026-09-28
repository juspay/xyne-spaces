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
