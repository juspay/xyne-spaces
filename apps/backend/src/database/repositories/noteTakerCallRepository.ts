import { CallStatus, CallType, InvitationResponse, type Call } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
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
 * conversation. This repository only ever writes a Call row + a single
 * CallParticipant row for the creator.
 */
export class NoteTakerCallRepository {
  private get db() {
    return DatabaseClient.getInstance();
  }

  async createCall(params: CreateNoteTakerCallParams): Promise<Call> {
    const { callId, roomName, workspaceId, createdBy, notesCanvasId, roomLink, now } = params;

    return this.db.$transaction(async (tx) => {
      const call = await tx.call.create({
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

      await tx.callParticipant.create({
        data: {
          id: uuidv4(),
          callId: call.id,
          userId: createdBy,
          invitedBy: createdBy,
          invitedAt: now,
          response: InvitationResponse.ACCEPTED,
          joinedAt: now,
        },
      });

      return call;
    });
  }

  /**
   * A participant (re)joined a room whose Call row already exists — e.g. the
   * creator's client reconnected after a network drop. Note-taker calls have
   * no scheduling/invitation concept, so this is just an upsert to ACCEPTED +
   * joinedAt, no side effects.
   */
  async recordParticipantJoin(callId: string, userId: string, now: Date): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const participant = await tx.callParticipant.findFirst({
        where: { callId, userId },
        select: { id: true },
      });

      if (participant) {
        await tx.callParticipant.update({
          where: { id: participant.id },
          data: { response: InvitationResponse.ACCEPTED, joinedAt: now, leftAt: null },
        });
      } else {
        await tx.callParticipant.create({
          data: {
            id: uuidv4(),
            callId,
            userId,
            invitedBy: userId,
            invitedAt: now,
            response: InvitationResponse.ACCEPTED,
            joinedAt: now,
          },
        });
      }

      await tx.call.update({ where: { id: callId }, data: { lastActivityAt: now } });
    });
  }

  /**
   * Mark a participant as left. Ends the call once no participant remains
   * active — note-taker calls are never SCHEDULED, so (unlike callRepository's
   * equivalent) there's no revert-to-SCHEDULED branch, and there's no system
   * message to update.
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

      const participant = await tx.callParticipant.findFirst({
        where: { callId: call.id, userId },
        select: { id: true },
      });
      if (!participant) return { shouldEndCall: false, call };

      await tx.callParticipant.update({
        where: { id: participant.id },
        data: { leftAt, response: InvitationResponse.LEFT },
      });

      const activeCount = await tx.callParticipant.count({
        where: { callId: call.id, leftAt: null },
      });

      let shouldEndCall = false;
      if (activeCount === 0 && call.status !== CallStatus.ENDED) {
        await tx.call.update({
          where: { id: call.id },
          data: { status: CallStatus.ENDED, endedAt: leftAt },
        });
        shouldEndCall = true;
      }

      return { shouldEndCall, call };
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
