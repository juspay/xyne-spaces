import { v4 as uuidv4 } from 'uuid';
import { RecordingType, CallType } from '@xyne/shared';
import type { WebhookEvent } from 'livekit-server-sdk';
import { ParticipantInfo_Kind } from '@livekit/protocol';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { repositories } from '@/database/repositories';
import { noteTakerCallRepository } from '@/database/repositories/noteTakerCallRepository';
import { noteTakerTranscriptService } from '@/services/noteTakerTranscriptService';
import { callRecordingService } from '@/services/callRecordingService';
import { emitCallStarted, emitCallEnded } from '@/automations/triggers/call.trigger';

// Deferred the same way as the conversation-based flow's fallback reconcile —
// see livekitWebhookController's former room_finished comment for the full
// rationale (transcript-ready almost always beats room_finished; this is only
// a safety net for when the agent never sent it).
const RECONCILE_GRACE_MS = 30_000;

/**
 * LiveKit webhook handling for NOTE_TAKER (HEADLESS / "Xyne Oats") rooms.
 *
 * Deliberately separate from livekitWebhookController's channel-based handlers:
 * note-taker rooms never have a channelId, never go through channel-based ACL,
 * and never create a message/conversation/system-message. livekitWebhookController
 * routes every LiveKit webhook event here globally as soon as it determines the
 * room is NOTE_TAKER — none of those events fall through to the channel-based
 * handlers for these rooms.
 */
class NoteTakerWebhookController {
  /** Single entry point — livekitWebhookController dispatches every event type here. */
  async handleEvent(event: WebhookEvent): Promise<void> {
    switch (event.event) {
      case 'room_started':
        // Nothing to do — the Call row is created on first participant_joined.
        return;

      case 'participant_joined':
        return this.handleParticipantJoined(event);

      case 'participant_left':
        return this.handleParticipantLeft(event);

      case 'room_finished':
        return this.handleRoomFinished(event);

      case 'track_published':
        // No host-controls concept for a single-user note-taker recording.
        return;

      case 'egress_started':
      case 'egress_ended':
        // callRecordingService's egress handling is already channel/message-agnostic
        // (keyed purely by egressId), so it's shared as-is — see livekitWebhookController.
        return;

      default:
        logger.info(`[NoteTaker Webhook] Unhandled event type: ${event.event}`);
    }
  }

  private async handleParticipantJoined(event: WebhookEvent): Promise<void> {
    const roomName = event.room?.name;
    const participant = event.participant;
    if (!roomName || !participant?.identity) return;

    if (participant.identity.startsWith('agent-')) return;
    if (participant.kind === ParticipantInfo_Kind.EGRESS) return;

    const existing = await repositories.calls.findByExternalId(roomName);

    if (existing) {
      // A headless room only contains its creator, so a subsequent join is a
      // reconnect. Keep activity fresh without creating participant state.
      await noteTakerCallRepository.touchCallActivity(existing.id, new Date());
      logger.info(`[NoteTaker Webhook] Creator ${participant.identity} rejoined call ${roomName}`);
      return;
    }

    let roomMetadata: Record<string, unknown>;
    try {
      roomMetadata = event.room?.metadata ? JSON.parse(event.room.metadata) : {};
    } catch (parseError) {
      logger.error('[NoteTaker Webhook] metadata_parse_failed', {
        room: roomName,
        raw_metadata: (event.room?.metadata ?? '').substring(0, 200),
        error: parseError,
      });
      return;
    }

    const workspaceId =
      typeof roomMetadata.workspaceId === 'string' ? roomMetadata.workspaceId : undefined;
    const createdBy =
      typeof roomMetadata.createdBy === 'string' ? roomMetadata.createdBy : participant.identity;
    const notesCanvasId =
      typeof roomMetadata.notesCanvasId === 'string' ? roomMetadata.notesCanvasId : undefined;

    if (!workspaceId) {
      logger.error(`[NoteTaker Webhook] Missing workspaceId in room metadata for ${roomName}`);
      return;
    }
    if (!notesCanvasId) {
      logger.error(`[NoteTaker Webhook] Missing notesCanvasId in room metadata for ${roomName}`);
      return;
    }

    const callId = uuidv4();
    const roomLink = `${config.livekit.clientUrl}/call/${roomName}?type=AUDIO`;

    const call = await noteTakerCallRepository.createCall({
      callId,
      roomName,
      workspaceId,
      createdBy,
      notesCanvasId,
      roomLink,
      now: new Date(),
    });

    logger.info(`[NoteTaker Webhook] Created note taker call record for ${roomName}`, {
      callId: call.id,
    });

    // Auto-start an audio recording for the whole call — note-taker calls have
    // no manual "start recording" UI action, so this replaces that trigger.
    // Stopped automatically when the creator leaves. Non-fatal: a failure here shouldn't block call
    // creation or the transcription pipeline.
    try {
      await callRecordingService.startRecording({
        call,
        recordingType: RecordingType.AUDIO_ONLY,
        startedBy: createdBy,
      });
    } catch (recordingError) {
      logger.error(
        `[NoteTaker Webhook] Failed to auto-start recording for call ${roomName}:`,
        recordingError
      );
    }

    emitCallStarted({
      id: call.id,
      externalId: call.externalId,
      channelId: null,
      title: call.title,
      callType: call.callType as CallType,
      startedAt: call.startedAt,
    }).catch((autoError) => {
      logger.error('[NoteTaker Webhook] Failed to emit call-started automation event:', autoError);
    });
  }

  private async handleParticipantLeft(event: WebhookEvent): Promise<void> {
    const roomName = event.room?.name;
    const participant = event.participant;
    if (!roomName || !participant?.identity) return;

    if (participant.identity.startsWith('agent-')) return;
    if (participant.kind === ParticipantInfo_Kind.EGRESS) return;

    const now = new Date();
    const result = await noteTakerCallRepository
      .handleParticipantLeave({
        callExternalId: roomName,
        userId: participant.identity,
        leftAt: now,
      })
      .catch((error) => {
        logger.error('[NoteTaker Webhook] participant_leave_failed', { room: roomName, error });
        return null;
      });

    if (!result?.call) return;

    logger.info(`[NoteTaker Webhook] Creator ${participant.identity} left call ${roomName}`);

    if (result.shouldEndCall) {
      logger.info(`[NoteTaker Webhook] Creator left — call ${roomName} ended`);

      try {
        await callRecordingService.stopActiveRecordingsForCall(roomName);
      } catch (stopErr) {
        logger.error(`[NoteTaker Webhook] Failed to stop recording for call ${roomName}:`, stopErr);
      }

      await this.emitCallEndedAutomation(result.call, now);
    }
  }

  private async handleRoomFinished(event: WebhookEvent): Promise<void> {
    const roomName = event.room?.name;
    if (!roomName) return;

    const now = new Date();
    const result = await noteTakerCallRepository
      .handleRoomFinished({
        callExternalId: roomName,
        endedAt: now,
      })
      .catch((error) => {
        logger.error('[NoteTaker Webhook] room_finished_failed', { room: roomName, error });
        return null;
      });

    if (!result?.call) {
      logger.error(`[NoteTaker Webhook] Call not found for room_finished: ${roomName}`);
      return;
    }

    // Safety net alongside handleParticipantLeft's stop-on-last-leave: covers
    // room teardowns that don't go through a clean participant_left (crash,
    // forced close). stopActiveRecordingsForCall is a no-op if nothing is active.
    try {
      await callRecordingService.stopActiveRecordingsForCall(roomName);
    } catch (stopErr) {
      logger.error(
        `[NoteTaker Webhook] Failed to stop recording for call ${roomName} on room_finished:`,
        stopErr
      );
    }

    if (result.shouldEndCall) {
      logger.info(`[NoteTaker Webhook] Marked call ${roomName} as ENDED (room_finished)`);
      await this.emitCallEndedAutomation(result.call, now);
    }

    // Fallback in case the agent's transcript-ready webhook never arrives — see
    // the module-level RECONCILE_GRACE_MS comment for the full rationale.
    setTimeout(() => {
      noteTakerTranscriptService.reconcileTranscript(roomName).catch((err) => {
        logger.error(`[NoteTaker Webhook] Deferred reconcile failed for ${roomName}:`, err);
      });
    }, RECONCILE_GRACE_MS);
  }

  private async emitCallEndedAutomation(
    call: Awaited<ReturnType<typeof noteTakerCallRepository.handleRoomFinished>>['call'],
    endedAt: Date
  ): Promise<void> {
    if (!call) return;
    try {
      await emitCallEnded({
        id: call.id,
        externalId: call.externalId,
        channelId: null,
        title: call.title,
        callType: call.callType as CallType,
        startedAt: call.startedAt,
        endedAt,
        aiSummary: call.aiSummary,
        transcript: call.transcript,
        conversationId: null,
      });
      logger.info(`[NoteTaker Webhook] Emitted call-ended automation event for ${call.externalId}`);
    } catch (autoError) {
      logger.error('[NoteTaker Webhook] Failed to emit call-ended automation event:', autoError);
    }
  }
}

export const noteTakerWebhookController = new NoteTakerWebhookController();
