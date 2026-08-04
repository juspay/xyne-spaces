import { CallStatus, CallType, type Call } from '@prisma/client';
import { DatabaseClient } from '@/database/client';

export interface CreateNoteTakerCallParams {
  callId: string;
  roomName: string;
  workspaceId: string;
  createdBy: string;
  notesCanvasId: string;
  roomLink: string;
  now: Date;
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

    return this.db.call.create({
      data: {
        id: callId,
        externalId: roomName,
        workspaceId,
        createdByUserId: createdBy,
        callType: CallType.HEADLESS,
        status: CallStatus.ACTIVE,
        roomLink,
        metadata: { notesCanvasId },
        startedAt: now,
        lastActivityAt: now,
      },
    });
  }

  /** Update activity when the creator reconnects to an existing headless room. */
  async touchCallActivity(callId: string, now: Date): Promise<void> {
    await this.db.call.update({ where: { id: callId }, data: { lastActivityAt: now } });
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

      return { shouldEndCall: true, call };
    });
  }

  /**
   * Authoritative room-closed fallback (mirrors callRepository.handleRoomFinished),
   * simplified for note-taker: no SCHEDULED revert, no system message, no
   * conversation.callId clearing (note-taker calls have no conversation).
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

      return { shouldEndCall: true, call };
    });
  }
}

export const noteTakerCallRepository = new NoteTakerCallRepository();
