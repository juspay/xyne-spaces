import { type Call, type Prisma } from '@prisma/client';
import { CallStatus, CallType, MessageType } from '@xyne/shared';
import { DatabaseClient } from '@/database/client';
import { repositories } from './index';

export interface CreateNoteTakerCallParams {
  callId: string;
  roomName: string;
  workspaceId: string;
  createdBy: string;
  notesCanvasId: string;
  roomLink: string;
  now: Date;
}

interface NoteTakerCallMetadata {
  notesCanvasId?: string;
  conversationId?: string;
  messageId?: string;
  channelId?: string;
}

/**
 * Persistence for NOTE_TAKER (HEADLESS / "Xyne Oats") calls.
 *
 * Deliberately separate from callRepository.createCallWithParticipantsAndMessage:
 * note-taker calls never live inside a channel and never create a message/
 * conversation. A headless room only contains its creator, so no
 * CallParticipant rows are needed.
 */
export class NoteTakerCallRepository {
  private get db() {
    return DatabaseClient.getInstance();
  }

  async createCall(params: CreateNoteTakerCallParams): Promise<Call> {
    const { callId, roomName, workspaceId, createdBy, notesCanvasId, roomLink, now } = params;

    // Thread-linkage (conversationId/messageId/channelId) is deliberately NOT
    // stamped here — it's only added to metadata by createThreadAnchorMessage,
    // and only once that method's workspace/channel/membership checks pass.
    // Writing it here unconditionally would let a later-failed validation
    // still leave metadata.channelId behind for shareThreadRecordingIfLinked /
    // updateThreadMessageOnEnd to act on.
    const metadata: NoteTakerCallMetadata = { notesCanvasId };

    return this.db.call.create({
      data: {
        id: callId,
        externalId: roomName,
        workspaceId,
        createdByUserId: createdBy,
        callType: CallType.HEADLESS,
        status: CallStatus.ACTIVE,
        roomLink,
        metadata: metadata as Prisma.InputJsonValue,
        startedAt: now,
        lastActivityAt: now,
      },
    });
  }

  /**
   * Update the thread's single anchor message once a thread-linked recording
   * ends. No-op (returns false) for recordings that weren't started from a
   * thread (no conversationId/messageId on call.metadata).
   */
  private async updateThreadMessageOnEnd(
    tx: Prisma.TransactionClient,
    call: Call,
    endedAt: Date,
  ): Promise<boolean> {
    const metadata = (call.metadata as NoteTakerCallMetadata | null) ?? {};
    if (!metadata.conversationId || !metadata.messageId) return false;

    const durationMs = call.startedAt ? endedAt.getTime() - call.startedAt.getTime() : null;

    await tx.message.update({
      where: { messageId: metadata.messageId },
      data: {
        content: 'Recording ended',
        metadata: {
          isRecordingMessage: true,
          isHeadlessRecording: true,
          callId: call.externalId,
          operation: 'recording_ended',
          ...(durationMs !== null ? { durationMs } : {}),
        },
      },
    });

    // Clear conversation.callId so the channel row's live-recording indicator
    // turns off immediately, and drop the isHeadlessRecording metadata flag
    // stamped in createThreadAnchorMessage (merge-safe: only removes that key).
    const conversation = await tx.conversation.findUnique({
      where: { conversationId: metadata.conversationId },
      select: { metadata: true },
    });
    const conversationMetadata: Record<string, unknown> =
      conversation?.metadata && typeof conversation.metadata === 'object' && !Array.isArray(conversation.metadata)
        ? { ...(conversation.metadata as Record<string, unknown>) }
        : {};
    delete conversationMetadata.isHeadlessRecording;

    await tx.conversation.update({
      where: { conversationId: metadata.conversationId },
      data: { callId: null, metadata: conversationMetadata as Prisma.InputJsonValue },
    });

    return true;
  }

  /** Update activity when the creator reconnects to an existing headless room. */
  async touchCallActivity(callId: string, now: Date): Promise<void> {
    await this.db.call.update({ where: { id: callId }, data: { lastActivityAt: now } });
  }

  /**
   * Patches the thread's anchor message content with the AI-generated title
   * once it's ready (called from noteTakerTranscriptService, well after the
   * recording itself has ended and updateThreadMessageOnEnd already ran).
   * Mirrors how a regular call's ended message shows its AI text directly as
   * message.content — RecordingBubble reads this straight off the message,
   * no separate live query on the Call row needed for the ended-state title.
   * No-op for recordings that weren't started from a thread.
   */
  async updateThreadMessageTitle(callId: string, title: string): Promise<void> {
    const call = await this.db.call.findUnique({ where: { id: callId }, select: { metadata: true } });
    const metadata = (call?.metadata as NoteTakerCallMetadata | null) ?? {};
    if (!metadata.messageId) return;

    await this.db.message.update({
      where: { messageId: metadata.messageId },
      data: { content: title },
    });
  }

  /**
   * Create the thread's single anchor message for a thread-linked recording,
   * once the recording is actually live (called right after `createCall`
   * succeeds). Validates the conversation still belongs to the given channel,
   * inserts the SYSTEM message, and bumps the conversation's reply count the
   * same way a normal reply into the thread would.
   *
   * Returns false (no throw) if the conversation/channel no longer match, if
   * they don't belong to the call's own workspace, or if the call's creator
   * is no longer a member of that channel — the caller treats that as a soft
   * failure, since the recording itself still works even if it can't be
   * anchored to a thread message. These checks are the authoritative gate
   * (callController's own pre-check is only a fail-fast UX optimization —
   * conversationId/channelId are client-supplied, so re-validating workspace
   * + membership here matters even if that earlier check already passed).
   */
  async createThreadAnchorMessage(params: {
    callId: string;
    conversationId: string;
    channelId: string;
    messageId: string;
    callExternalId: string;
    createdBy: string;
    workspaceId: string;
    notesCanvasId: string;
  }): Promise<boolean> {
    const { callId, conversationId, channelId, messageId, callExternalId, createdBy, workspaceId, notesCanvasId } =
      params;

    const conversation = await repositories.conversations.findByIdAndWorkspace(conversationId, workspaceId);
    if (!conversation || conversation.channelId !== channelId) {
      return false;
    }
    const isMember = await repositories.channelParticipants.isParticipant(channelId, createdBy);
    if (!isMember) {
      return false;
    }

    const initiator = await this.db.user.findUnique({
      where: { id: createdBy },
      select: { name: true, displayName: true },
    });

    const now = new Date();
    await this.db.message.create({
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
        },
      },
    });

    // Bumps conversation.replyCount (so the "N replies" pill in the channel
    // view updates), touches lastActivityAt, and refreshes participants'
    // lastReplyAt — the same bookkeeping any normal reply into this thread gets.
    await repositories.conversations.incrementReplyCount(conversationId, now);

    // Mirrors what a regular in-thread call does (callRepository sets
    // conversation.callId while ACTIVE, clears it on end): lets the channel
    // row's reply-count line detect "this thread has something live" via the
    // same field the call flow already uses (hasActiveCallForConversation).
    // isHeadlessRecording on conversation.metadata (merge-safe) is the extra
    // bit that disambiguates "it's a recording, not a real call" — read
    // directly off this already-subscribed conversation row, no separate
    // per-thread-row query needed.
    const existingMetadata: Record<string, unknown> =
      conversation.metadata && typeof conversation.metadata === 'object' && !Array.isArray(conversation.metadata)
        ? (conversation.metadata as Record<string, unknown>)
        : {};
    await this.db.conversation.update({
      where: { conversationId },
      data: {
        callId: callExternalId,
        metadata: { ...existingMetadata, isHeadlessRecording: true } as Prisma.InputJsonValue,
      },
    });

    // Only now — after every validation above passed — persist the thread
    // linkage onto the Call row itself. shareThreadRecordingIfLinked and
    // updateThreadMessageOnEnd both key off call.metadata.channelId /
    // .conversationId, so this is the single point where a call becomes
    // "thread-linked" from their point of view.
    await this.db.call.update({
      where: { id: callId },
      data: { metadata: { notesCanvasId, conversationId, messageId, channelId } as Prisma.InputJsonValue },
    });

    return true;
  }

  /**
   * End the headless call when its creator leaves. Headless rooms are
   * single-user, so there is no participant presence table to update or count.
   */
  async handleParticipantLeave(params: {
    callExternalId: string;
    userId: string;
    leftAt: Date;
  }): Promise<{ shouldEndCall: boolean; call: Call | null }> {
    const { callExternalId, userId, leftAt } = params;

    return this.db.$transaction(async (tx) => {
      const call = await tx.call.findUnique({ where: { externalId: callExternalId } });
      if (!call) return { shouldEndCall: false, call: null };

      if (call.createdByUserId !== userId || call.status === CallStatus.ENDED) {
        return { shouldEndCall: false, call };
      }

      await tx.call.update({
        where: { id: call.id },
        data: { status: CallStatus.ENDED, endedAt: leftAt },
      });

      await this.updateThreadMessageOnEnd(tx, call, leftAt);

      return { shouldEndCall: true, call };
    });
  }

  /**
   * Authoritative room-closed fallback (mirrors callRepository.handleRoomFinished),
   * simplified for note-taker: no SCHEDULED revert, no system message.
   * conversation.callId clearing for thread-linked recordings happens inside
   * updateThreadMessageOnEnd (no-op for recordings with no conversation).
   */
  async handleRoomFinished(params: {
    callExternalId: string;
    endedAt: Date;
  }): Promise<{ shouldEndCall: boolean; call: Call | null }> {
    const { callExternalId, endedAt } = params;

    return this.db.$transaction(async (tx) => {
      const call = await tx.call.findUnique({ where: { externalId: callExternalId } });
      if (!call) return { shouldEndCall: false, call: null };

      if (call.status === CallStatus.ENDED) {
        return { shouldEndCall: false, call };
      }

      await tx.call.update({
        where: { id: call.id },
        data: { status: CallStatus.ENDED, endedAt },
      });

      await this.updateThreadMessageOnEnd(tx, call, endedAt);

      return { shouldEndCall: true, call };
    });
  }
}

export const noteTakerCallRepository = new NoteTakerCallRepository();
