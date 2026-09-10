import { Request, Response } from 'express';
import { WebhookReceiver, WebhookEvent } from 'livekit-server-sdk';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';
import { type Call } from '@prisma/client';
import { CallOrigin, CallStatus, CallType, InvitationResponse } from '@xyne/shared';
import { DatabaseClient } from '@/database/client';
import { repositories } from '@/database/repositories';
import { v4 as uuidv4 } from 'uuid';
import { callSideEffectService } from '@/services/callSideEffectService';
import { livekitWebhookACL } from './livekitWebhookACL';
import { transcriptService } from '@/services/transcriptService';
import {
  livekitService,
  getHostControls,
  hasTurnedOffHostControl,
} from '@/services/liveKitService';
import { callHostControlService } from '@/services/callHostControlService';
import { isTrackTurnedOffByHostControls } from '@/services/callHostControlUtils';
import { callRecordingService } from '@/services/callRecordingService';
import { EgressStatus } from 'livekit-server-sdk';
import { ParticipantInfo_Kind } from '@livekit/protocol';
import { emitCallEnded, emitCallStarted } from '@/automations/triggers/call.trigger';
import { noteTakerWebhookController } from '@/controllers/noteTakerWebhookController';
import { buildCallInviteUrl } from '@/utils/urlUtils';
import { isTrackInChannel } from '@/sdlc/sdlcChannelMembership';

class LiveKitWebhookController {
  private receiver: WebhookReceiver;

  private get db() {
    return DatabaseClient.getInstance();
  }

  private async emitCallEndedAutomation(
    call: Call,
    endedAt: Date,
    source: 'room_finished' | 'participant_left',
  ): Promise<void> {
    try {
      const metadata = call.metadata as { conversationId?: string } | null;
      await emitCallEnded({
        id: call.id,
        externalId: call.externalId,
        channelId: call.channelId,
        title: call.title,
        callType: call.callType as CallType,
        startedAt: call.startedAt,
        endedAt,
        aiSummary: call.aiSummary,
        transcript: call.transcript,
        conversationId: metadata?.conversationId ?? null,
      });
      logger.info(`[LiveKit Webhook] Emitted call-ended automation event (${source}) for ${call.externalId}`);
    } catch (autoError) {
      logger.error(`[LiveKit Webhook] Failed to emit call-ended automation event (${source}):`, autoError);
    }
  }

  constructor() {
    // Initialize webhook receiver with existing API credentials
    // LiveKit uses the same API secret for webhook signature verification
    this.receiver = new WebhookReceiver(
      config.livekit.apiKey,
      config.livekit.apiSecret
    );
    logger.info('[LiveKit Webhook] Controller initialized');
  }

  /**
   * POST /api/livekit/webhook
   * Receives webhooks from LiveKit server
   * 
   * LiveKit sends cryptographically signed webhooks for room events.
   * This is the authoritative source for room lifecycle events.
   */
  handleWebhook = async (req: Request, res: Response): Promise<void> => {
    // Verify the body was parsed as a raw Buffer by express.raw().
    // If the content-type didn't match 'application/webhook+json', express skips the
    // raw parser and req.body may be an empty object — signature verification would
    // then silently fail on garbage input rather than giving a useful error.
    if (!Buffer.isBuffer(req.body)) {
      logger.error('[LiveKit Webhook] webhook_body_not_buffer', {
        content_type: req.get('content-type'),
        body_type: typeof req.body,
        action: 'returning_400',
        likely_cause: 'content_type_mismatch_or_missing_raw_middleware',
      });
      res.status(400).json({ error: 'Invalid webhook body — expected raw buffer' });
      return;
    }

    logger.info('[LiveKit Webhook] webhook_received', { body_bytes: req.body.length });

    // Separate the signature verification from handler errors so auth failures
    // are distinguishable from processing errors in logs.
    let event: WebhookEvent;
    try {
      event = await this.receiver.receive(
        req.body.toString('utf8'),
        req.get('Authorization')
      );
    } catch (authError) {
      logger.error('[LiveKit Webhook] webhook_auth_failed', {
        content_type: req.get('content-type'),
        error: authError,
        likely_cause: 'wrong_api_secret_or_tampered_body',
      });
      res.status(400).json({ error: 'Webhook signature verification failed' });
      return;
    }

    logger.info('[LiveKit Webhook] webhook_parsed', { event: event.event, room: event.room?.name ?? 'none' });

    try {
      // Global routing: NOTE_TAKER (HEADLESS / "Xyne Oats") rooms never have a
      // channel/message/conversation, so every event type for them is handled
      // entirely by noteTakerWebhookController instead of the channel-based
      // handlers below. This check must run before the switch so no event type
      // (room_finished, participant_left, track_published, egress_*, etc.) ever
      // falls through to the channel-based DB operations, which don't apply.
      if (await this.isNoteTakerRoom(event)) {
        await noteTakerWebhookController.handleEvent(event);
        res.status(200).json({ success: true });
        return;
      }

      // Handle different event types
      switch (event.event) {
        case 'room_started':
          await this.handleRoomStarted(event);
          break;

        case 'room_finished':
          await this.handleRoomFinished(event);
          break;

        case 'participant_joined':
          await this.handleParticipantJoined(event);
          break;

        case 'participant_left':
          await this.handleParticipantLeft(event);
          break;

        case 'track_published':
          await this.handleTrackPublished(event);
          break;

        case 'egress_started':
          await this.handleEgressStarted(event);
          break;

        case 'egress_ended':
          await this.handleEgressEnded(event);
          break;

        default:
          logger.info(`[LiveKit Webhook] Unhandled event type: ${event.event}`);
      }

      res.status(200).json({ success: true });
    } catch (error) {
      logger.error('[LiveKit Webhook] Error processing webhook:', error);
      res.status(500).json({ error: 'Failed to process webhook' });
    }
  };

  /**
   * Determine whether a webhook event belongs to a NOTE_TAKER (HEADLESS) room.
   * Prefers the DB row (authoritative once the call exists); falls back to the
   * room metadata for events that arrive before the Call row is created
   * (room_started, and the very first participant_joined).
   */
  private async isNoteTakerRoom(event: WebhookEvent): Promise<boolean> {
    const roomName = event.room?.name;
    if (!roomName) return false;

    const call = await repositories.calls.findByExternalId(roomName);
    if (call) return call.callType === CallType.HEADLESS;

    if (!event.room?.metadata) return false;
    try {
      const metadata = JSON.parse(event.room.metadata) as Record<string, unknown>;
      return metadata.callType === CallType.HEADLESS;
    } catch {
      return false;
    }
  }

  /**
   * Handle room_started event
   * Called when a room is first created and becomes active
   * 
   * Note: We only log this event. All DB operations happen when the first participant joins.
   */
  private async handleRoomStarted(event: WebhookEvent): Promise<void> {
    const roomName = event.room?.name;
    if (!roomName) return;

    logger.info(`[LiveKit Webhook] Room started: ${roomName}`, {
      sid: event.room?.sid,
      creationTime: event.room?.creationTime ? Number(event.room.creationTime) : undefined,
      metadata: event.room?.metadata,
    });
  }

  private async handleTrackPublished(event: WebhookEvent): Promise<void> {
    const roomName = event.room?.name;
    const participant = event.participant;
    const track = event.track;

    if (!roomName || !participant?.identity || !track?.sid) return;
    if (participant.identity.startsWith('agent-')) return;
    if (participant.kind === ParticipantInfo_Kind.EGRESS) return;

    try {
      const call = await repositories.calls.findByExternalId(roomName);
      if (!call || call.createdByUserId === participant.identity) return;

      const hostControls = getHostControls(call);
      if (!hasTurnedOffHostControl(hostControls)) return;

      await callHostControlService.applyHostControlsToParticipant(
        roomName,
        participant.identity,
        'track_published',
      );

      if (!track.muted && isTrackTurnedOffByHostControls(track.source, hostControls)) {
        await livekitService.muteTrack(roomName, participant.identity, track.sid, true);
        logger.info(
          `[LiveKit Webhook] Muted turned-off published track | room=${roomName}, participant=${participant.identity}, source=${track.source}, trackSid=${track.sid}`,
        );
      }
    } catch (error) {
      logger.warn(
        `[LiveKit Webhook] Failed to enforce host controls for published track | room=${roomName}, participant=${participant.identity}, trackSid=${track.sid}, error=${error}`,
      );
    }
  }

  /**
   * Handle room_finished event - MOST IMPORTANT
   * 
   * This is the authoritative signal that the room has closed.
   * Called when all participants have left and the room is being cleaned up.
   * This is guaranteed to fire AFTER the room is actually closed.
   */
  private async handleRoomFinished(event: WebhookEvent): Promise<void> {
    const callId = event.room?.name;
    if (!callId) {
      logger.warn('[LiveKit Webhook] room_finished event missing room name');
      return;
    }

    logger.info(`[LiveKit Webhook] Room finished: ${callId}`, {
      sid: event.room?.sid,
      numParticipants: event.room?.numParticipants,
    });

    try {
      const now = new Date();

      // Use repository method to handle room finished atomically (includes system message update)
      const result = await repositories.calls.handleRoomFinished({
        callExternalId: callId,
        endedAt: now,
      });

      if (!result.call) {
        logger.error(`[LiveKit Webhook] Call not found: ${callId}`);
        return;
      }

      if (result.shouldEndCall) {
        logger.info(`[LiveKit Webhook] Marked call ${callId} as ENDED`);

        await this.emitCallEndedAutomation(result.call, now, 'room_finished');

        // Track call metrics (count + duration) as a side effect
        try {
          await callSideEffectService.logCallAnalytics(
            { ...result.call, callOrigin: result.call.callOrigin as CallOrigin },
            now,
          );
        } catch (analyticsError) {
          logger.error(`[LiveKit Webhook] Failed to log call analytics for ${callId}:`, analyticsError);
        }

        // Post external chat summary if external participants sent messages
        try {
          await callSideEffectService.postExternalChatSummary(result.call.id, callId);
        } catch (sideEffectError) {
          logger.error(`[LiveKit Webhook] Failed to post external chat summary for ${callId}:`, sideEffectError);
        }
      } else {
        logger.info(`[LiveKit Webhook] Call ${callId} did not transition to ENDED`);
      }

      // Transcript reconciliation fallback — scheduled on EVERY room_finished, regardless of
      // whether participant_left already marked the call ENDED (so it must live outside
      // the shouldEndCall branch above). It exists for when the agent's transcript-ready
      // webhook never arrives (agent OOM/SIGKILLed mid-call): reconcile then processes
      // whatever it had already streamed to GCS.
      //
      // Deferred ~30s on a detached timer (NOT awaited) rather than run inline. room_finished
      // almost always beats transcript-ready, so reconciling immediately would make this
      // fallback the primary processor and race the agent path. The grace lets transcript-ready
      // (the intended primary) process first; reconcile then no-ops via its entryCount dedup
      // when the agent path already handled the call, and only does real work when
      // transcript-ready never arrived. Deduped by entryCount + serialized by a per-call lock,
      // so a late reconcile neither repeats the LLM work nor duplicates rows.
      //
      // Trade-off (accepted): the timer lives only in this process, so a backend restart inside
      // the 30s window drops the scheduled reconcile. Harmless in the normal case (transcript-ready
      // already did the work); it only loses the fallback in the rare double-failure of the agent
      // dying AND the backend restarting within the window. A durable queue-backed job / ENDED-calls
      // sweeper is the fast-follow if that edge ever needs closing.
      const RECONCILE_GRACE_MS = 30_000;
      setTimeout(() => {
        // reconcileTranscriptFromGcs catches its own errors today, but this timer runs
        // detached from any request context — a future edit that lets a rejection escape
        // would become an unhandled rejection and crash the process. Catch defensively.
        transcriptService.reconcileTranscriptFromGcs(callId).catch((err) => {
          logger.error(`[LiveKit Webhook] Deferred reconcile failed for ${callId}:`, err);
        });
      }, RECONCILE_GRACE_MS);

      if (result.messageUpdated) {
        logger.info(`[LiveKit Webhook] Updated system message for call ${callId}`);
      }
    } catch (error) {
      logger.error(`[LiveKit Webhook] Error handling room_finished for ${callId}:`, error);
      throw error;
    }
  }

  /**
   * Handle participant_joined event
   * When the first participant joins, create the call record, participants, and system message
   */
  private async handleParticipantJoined(event: WebhookEvent): Promise<void> {
    const roomName = event.room?.name;
    const participant = event.participant;

    if (!participant?.identity || !roomName) return;

    logger.info(`[LiveKit Webhook] Participant joined: ${participant?.identity} in room ${roomName}`, {
      sid: participant?.sid,
      name: participant?.name,
    });

    // Skip agent participants
    if (participant.identity.startsWith('agent-')) {
      logger.info(`[LiveKit Webhook] Skipping agent participant: ${participant.identity}`);
      return;
    }

    // Skip egress participants (the recording bot that joins to capture audio)
    if (participant.kind === ParticipantInfo_Kind.EGRESS) {
      logger.info(`[LiveKit Webhook] Skipping egress participant: ${participant.identity}`);
      return;
    }

    try {
      // Check if call record already exists
      let call = await repositories.calls.findByExternalId(roomName);
      const callNotExist = !call;

      // If call doesn't exist, this is the first participant - create everything using repository
      if (callNotExist) {
        logger.info(`[LiveKit Webhook] First participant joined - creating call record for ${roomName}`);

        // Parse room metadata to get channel info
        // Unguarded JSON.parse would throw into the outer catch with no stage context.
        let roomMetadata: Record<string, any>;
        try {
          roomMetadata = event.room?.metadata ? JSON.parse(event.room.metadata) : {};
        } catch (parseError) {
          logger.error('[LiveKit Webhook] metadata_parse_failed', {
            stage: 'metadata_parse',
            room: roomName,
            raw_metadata: (event.room?.metadata ?? '').substring(0, 200),
            error: parseError,
          });
          return;
        }
        const channelId = roomMetadata.channelId;
        const createdBy = roomMetadata.createdBy || participant.identity;
        const callType = roomMetadata.callType;
        const callOrigin = roomMetadata.callOrigin;
        const existingConversationId = roomMetadata.conversationId;
        const artifactMessageId = roomMetadata.artifactMessageId;
        const invitedUserIds = roomMetadata.invitedUserIds; // Selected participants for conversation calls

        if (!channelId) {
          logger.error(`[LiveKit Webhook] Missing channelId in room metadata for ${roomName}`);
          return;
        }

        // ACL Validation: Verify permissions for call creation
        // A DB timeout inside canCreateCall would fall into the outer catch with no stage label.
        let aclCheck: Awaited<ReturnType<typeof livekitWebhookACL.canCreateCall>>;
        try {
          aclCheck = await livekitWebhookACL.canCreateCall({
            channelId,
            createdBy,
            joiningUserId: participant.identity,
          });
        } catch (aclError) {
          logger.error('[LiveKit Webhook] acl_check_failed', {
            stage: 'acl_validation',
            room: roomName,
            channel: channelId,
            error: aclError,
          });
          return;
        }

        if (!aclCheck.valid) {
          logger.error(`[LiveKit Webhook] ACL validation failed: ${aclCheck.reason}`);
          return;
        }

        logger.info(`[LiveKit Webhook] ACL validation passed for call creation: channel=${channelId}, creator=${createdBy}, joiner=${participant.identity}`);

        // Get channel participants for creating participant records
        let participantsToInvite: Array<{ userId: string }>;
        if (invitedUserIds && Array.isArray(invitedUserIds) && invitedUserIds.length > 0) {
          participantsToInvite = invitedUserIds.map((userId: string) => ({ userId }));
          if (!participantsToInvite.some((p) => p.userId === createdBy)) {
            participantsToInvite = [{ userId: createdBy }, ...participantsToInvite];
          }
        } else {
          // Use all channel participants (default behavior for channel calls)
          // DB failure here is otherwise unguarded and falls into outer catch with no stage.
          try {
            participantsToInvite = await repositories.channelParticipants.getChannelParticipants(channelId);
          } catch (participantsError) {
            logger.error('[LiveKit Webhook] channel_participants_lookup_failed', {
              stage: 'channel_participants_lookup',
              room: roomName,
              channel: channelId,
              error: participantsError,
            });
            return;
          }
        }

        const now = new Date();

        const conversationId = existingConversationId || uuidv4();
        const messageId = uuidv4();
        const callId = uuidv4();

        // Construct room link
        const roomLink = buildCallInviteUrl(roomName);

        // Use repository method to create call with all related records atomically
        // If this transaction fails the LiveKit room is already live with no DB record — a
        // "ghost room". Catch it specifically so the log contains the room name and explicit
        // ghost_room_detected marker rather than the generic 'Error handling participant join'.
        const channelRecord = await this.db.channel.findUnique({
          where: { id: channelId },
          select: { workspaceId: true },
        });
        const result = await repositories.calls.createCallWithParticipantsAndMessage({
          callId,
          roomName,
          channelId,
          workspaceId: channelRecord?.workspaceId,
          createdBy,
          callType,
          roomLink,
          joiningUserId: participant.identity,
          channelParticipants: participantsToInvite,
          conversationId,
          messageId,
          now,
          callOrigin,
          ...(typeof artifactMessageId === 'string' && { artifactMessageId }),
        }).catch((txError) => {
          logger.error('[LiveKit Webhook] call_record_creation_failed', {
            stage: 'call_record_creation',
            room: roomName,
            channel: channelId,
            error: txError,
          });
          logger.error('[LiveKit Webhook] ghost_room_detected', {
            room: roomName,
            livekit_room_is_live: true,
            no_db_record: true,
            action: 'manual_cleanup_may_be_required',
          });
          return null;
        });

        if (!result) return;

        call = result.call;

        // SDLC linking: the initiator validated this context; now that the call
        // and its conversation exist, record the entity mapping. Owner is a
        // canvas or a track — either way the same two links are written:
        //   OWNER -> CALL (relation CALL) and OWNER -> CONVERSATION (DISCUSSION).
        const sdlcLink = (roomMetadata as {
          sdlcLink?: { ownerType?: string; ownerId?: string };
        }).sdlcLink;
        if (sdlcLink?.ownerType && sdlcLink.ownerId) {
          try {
            const linkWorkspaceId = channelRecord?.workspaceId ?? null;
            const ownerValid =
              sdlcLink.ownerType === 'CANVAS'
                ? Boolean(
                    await this.db.canvas.findFirst({
                      where: { id: sdlcLink.ownerId, channelId },
                      select: { id: true },
                    }),
                  )
                : sdlcLink.ownerType === 'TRACK'
                  ? await isTrackInChannel(this.db, sdlcLink.ownerId, channelId)
                  : false;
            if (linkWorkspaceId && ownerValid) {
              await this.db.sdlcEntityLink.createMany({
                data: [
                  {
                    workspaceId: linkWorkspaceId,
                    channelId,
                    sourceType: sdlcLink.ownerType,
                    sourceId: sdlcLink.ownerId,
                    targetType: 'CALL',
                    targetId: callId,
                    relationType: 'CALL',
                    createdBy,
                  },
                  {
                    workspaceId: linkWorkspaceId,
                    channelId,
                    sourceType: sdlcLink.ownerType,
                    sourceId: sdlcLink.ownerId,
                    targetType: 'CONVERSATION',
                    targetId: conversationId,
                    relationType: 'DISCUSSION',
                    createdBy,
                  },
                ],
                skipDuplicates: true,
              });
              logger.info(
                `[LiveKit Webhook] sdlc_link_created | call=${callId} owner=${sdlcLink.ownerType}:${sdlcLink.ownerId}`,
              );
            }
          } catch (sdlcLinkError) {
            // Linking must never break call creation.
            logger.warn('[LiveKit Webhook] sdlc_link_failed', {
              room: roomName,
              call: callId,
              error: sdlcLinkError,
            });
          }
        }

        // Emit call-started automation event when the first participant creates the call
        if (call) {
          emitCallStarted({
            id: call.id,
            externalId: call.externalId,
            channelId: call.channelId,
            title: call.title,
            callType: call.callType as CallType,
            startedAt: call.startedAt,
          }).catch(autoError => {
            logger.error(`[LiveKit Webhook] Failed to emit call-started automation event:`, autoError);
          });
          logger.info(`[LiveKit Webhook] Emitted call-started automation event for ${roomName}`);
        }

        logger.info(`[LiveKit Webhook] Successfully created all records for first participant in call ${roomName}`);

        // Generate title from thread call
        if (callOrigin === CallOrigin.CONVERSATION && existingConversationId && call) {
          const callIdForUpdate = call.id;
          transcriptService.generateCallTitleFromConversation(existingConversationId)
            .then(async (generatedTitle) => {
              if (generatedTitle) {
                await repositories.calls.update(callIdForUpdate, { title: generatedTitle });
                logger.info(`[LiveKit Webhook] Generated and saved title "${generatedTitle}" for call ${roomName}`);
              }
            })
            .catch((error) => {
              logger.error(`[LiveKit Webhook] Failed to generate title for call ${roomName}:`, error);
            });
        }

        // Trigger notifications for invited participants
        if (result.invitedParticipantIds.length > 0) {
          logger.info(`[LiveKit Webhook] Triggering notifications for ${result.invitedParticipantIds.length} invited participants`);
          await Promise.allSettled(
            result.invitedParticipantIds.map(async (participantId) => {
              try {
                await callSideEffectService.handleParticipantInvited(participantId);
              } catch (error) {
                logger.error(`[LiveKit Webhook] Failed to trigger notification for participant ${participantId}:`, error);
              }
            })
          );
        }
      } else if (call) {
        // If it's a scheduled call, activate it FIRST
        if (call.status === CallStatus.SCHEDULED) {
          // ── Scheduled call activation ──────────────────────────────────────────
          // Delegate entirely to the repository, which handles the two sub-cases
          // (first join vs. rejoin) atomically inside a single $transaction.

          const now = new Date();

          // Resolve the initiator's display name for the system message
          const joiningUser = await this.db.user.findUnique({
            where: { id: participant.identity },
            select: { name: true },
          });
          const initiatorName = joiningUser?.name || participant.name;

          const callChannelRecord = await this.db.channel.findUnique({
            where: { id: call.channelId ?? '' },
            select: { workspaceId: true },
          });

          await repositories.calls.activateScheduledCall({
            call,
            initiatorName,
            now,
            workspaceId: callChannelRecord?.workspaceId,
          });

          logger.info(`[LiveKit Webhook] Scheduled call ${roomName} activated (status → ACTIVE)`);
          // ── End scheduled call activation ──────────────────────────────────────
        }

        // Now proceed with normal participant join tracking for ALL existing calls
        const existingParticipant = await repositories.calls.findParticipant(call.id, participant.identity);

        if (!existingParticipant) {
          // Create participant if doesn't exist (handles edge cases like external users)
          await repositories.calls.createParticipant({
            id: uuidv4(),
            callId: call.id,
            userId: participant.identity,
            invitedBy: call.createdByUserId,
            invitedAt: new Date(),
            response: InvitationResponse.ACCEPTED,
            joinedAt: new Date()
          });
          logger.info(`[LiveKit Webhook] Created new participant record for ${participant.identity}`);
        } else {
          // Update participant to ACCEPTED with joinedAt timestamp using repository method
          const now = new Date();
          await this.db.$transaction(async (tx) => {
            await repositories.calls.updateParticipantResponse(
              existingParticipant.id,
              InvitationResponse.ACCEPTED,
              now,
              tx
            );
          });
          logger.info(`[LiveKit Webhook] Updated participant ${participant.identity} to ACCEPTED for call ${roomName}`);

          // Trigger side effects for participant response (dismiss notification, cleanup timeout).
          // Skip for scheduled calls entirely — they never go through handleParticipantInvited,
          // so no INCOMING_CALL notification or timeout job was created for them. Sending
          // CALL_DISMISS here would be a spurious push with no corresponding incoming-call UI.
          const isScheduledCall = call.startsAt !== null;
          if (isScheduledCall) {
            logger.info(`[LiveKit Webhook] Skipping participant response side effects for ${participant.identity} — scheduled call has no pending INCOMING_CALL notification`);
          } else {
            try {
              await callSideEffectService.handleParticipantResponse(
                existingParticipant.id,
                InvitationResponse.ACCEPTED
              );
              logger.info(`[LiveKit Webhook] Triggered participant response side effects for ${participant.identity}`);
            } catch (sideEffectError) {
              logger.error(`[LiveKit Webhook] Failed to trigger participant response side effects:`, sideEffectError);
            }
          }
        }
      }
      // Notify all connected clients that participants changed
      if (roomName) {
        await callHostControlService.applyHostControlsToParticipant(
          roomName,
          participant.identity,
          'participant_joined',
        );
        void livekitService.sendParticipantsChanged(roomName);
      }
    } catch (error) {
      logger.error(`[LiveKit Webhook] Error handling participant join:`, error);
    }
  }

  /**
   * Handle participant_left event
   */
  private async handleParticipantLeft(event: WebhookEvent): Promise<void> {
    const callId = event.room?.name;
    const participant = event.participant;

    if (!participant?.identity || !callId) return;

    logger.info(`[LiveKit Webhook] Participant left: ${participant?.identity} from call ${callId}`, {
      sid: participant?.sid,
      name: participant?.name,
    });

    // Skip agent participants early
    if (participant.identity.startsWith('agent-')) {
      logger.info(`[LiveKit Webhook] Skipping agent participant: ${participant.identity}`);
      return;
    }

    // Skip egress participants (the recording bot that joins to capture audio)
    if (participant.kind === ParticipantInfo_Kind.EGRESS) {
      logger.info(`[LiveKit Webhook] Skipping egress participant: ${participant.identity}`);
      return;
    }

    try {
      const now = new Date();

      // ACL Validation: Verify participant can update call status
      const aclCheck = await livekitWebhookACL.canUpdateCallStatus({
        callExternalId: callId,
        userId: participant.identity,
      });

      if (!aclCheck.valid) {
        logger.error(`[LiveKit Webhook] ACL validation failed: ${aclCheck.reason}`);
        return;
      }

      logger.info(`[LiveKit Webhook] ACL validation passed for participant leave: call=${callId}, user=${participant.identity}`);

      // Use repository method to handle participant leave atomically (includes system message update)
      // If this DB call throws, shouldEndCall is never checked and stopRecording is never
      // called — the egress auto-terminates without a graceful flush and the recording may be
      // truncated. Catch it explicitly and still attempt stopRecording before returning.
      const result = await repositories.calls.handleParticipantLeave({
        callExternalId: callId,
        userId: participant.identity,
        leftAt: now,
      }).catch(async (leaveError) => {
        logger.error('[LiveKit Webhook] participant_leave_db_failed', {
          stage: 'participant_leave_db_update',
          call: callId,
          user: participant.identity,
          error: leaveError,
        });
        // Still attempt to stop the recording so the egress can flush to GCS before the room tears down.
        try {
          await callRecordingService.stopActiveRecordingsForCall(callId);
          logger.info('[LiveKit Webhook] recording_stop_attempted_after_db_error', { call: callId });
        } catch (stopErr) {
          logger.error('[LiveKit Webhook] recording_stop_failed_after_db_error', { call: callId, error: stopErr });
        }
        return null;
      });

      if (!result) return;

      if (!result.call) {
        logger.warn(`[LiveKit Webhook] Call not found or participant not found for leave: ${callId}`);
        return;
      }

      logger.info(`[LiveKit Webhook] Marked participant ${participant.identity} as left for call ${callId}`);

      if (result.shouldEndCall) {
        logger.info(`[LiveKit Webhook] No active participants remaining for call ${callId}. Call ended.`);

        // Gracefully stop any active recording so egress can flush to GCS before the room tears down
        try {
          await callRecordingService.stopActiveRecordingsForCall(callId);
        } catch (stopErr) {
          logger.error(`[LiveKit Webhook] Failed to stop recording for call ${callId}:`, stopErr);
        }

        await this.emitCallEndedAutomation(result.call, now, 'participant_left');

        // Trigger side effects for call end (missed call notifications, cleanup timeouts, activities)
        try {
          await callSideEffectService.handleCallEnded(result.call.id);
          logger.info(`[LiveKit Webhook] Triggered call ended side effects for ${callId}`);
        } catch (sideEffectError) {
          logger.error(`[LiveKit Webhook] Failed to trigger call ended side effects:`, sideEffectError);
        }

        // Emit analytics events (call_ended + per-participant) for the Calls dashboards
        try {
          await callSideEffectService.logCallAnalytics(
            { ...result.call, callOrigin: result.call.callOrigin as CallOrigin },
            now,
          );
        } catch (analyticsError) {
          logger.error(`[LiveKit Webhook] Failed to log call analytics for ${callId}:`, analyticsError);
        }

        // Post external chat summary if external participants sent messages
        try {
          await callSideEffectService.postExternalChatSummary(result.call.id, callId);
        } catch (sideEffectError) {
          logger.error(`[LiveKit Webhook] Failed to post external chat summary for ${callId}:`, sideEffectError);
        }
      }

      if (result.messageUpdated) {
        logger.info(`[LiveKit Webhook] Updated system message for call ${callId}`);
      }
      // Notify remaining connected clients that participants changed
      if (callId) {
        void livekitService.sendParticipantsChanged(callId);
      }
    } catch (error) {
      logger.error(`[LiveKit Webhook] Error handling participant leave:`, error);
    }
  }

  /**
   * Handle egress_started event.
   * The recording-started notification is published synchronously from the start
   * API (toast + room metadata for late joiners), so this is a confirmation log
   * only — kept to make egress lifecycle greppable.
   */
  private async handleEgressStarted(event: WebhookEvent): Promise<void> {
    const egressInfo = event.egressInfo;
    if (!egressInfo?.egressId) return;
    logger.info(`[LiveKit Webhook] Egress started: ${egressInfo.egressId}`, {
      roomName: egressInfo.roomName,
    });
  }

  /**
   * Handle egress_ended event.
   * Correlated by egressId (C2) so the right recording row is updated even with
   * multiple recordings per call. Terminal-but-failed statuses are passed through
   * so the row moves to UPLOAD_FAILED and the single-active lock is freed (H1).
   */
  private async handleEgressEnded(event: WebhookEvent): Promise<void> {
    const egressInfo = event.egressInfo;
    if (!egressInfo?.egressId) {
      logger.warn('[LiveKit Webhook] egress_ended event missing egressInfo');
      return;
    }

    const statusName = EgressStatus[egressInfo.status] ?? `UNKNOWN(${egressInfo.status})`;
    const completedSuccessfully = egressInfo.status === EgressStatus.EGRESS_COMPLETE;
    logger.info(`[LiveKit Webhook] Egress ended: ${egressInfo.egressId}`, {
      roomName: egressInfo.roomName,
      status: egressInfo.status,
      statusName,
      completedSuccessfully,
      error: egressInfo.error || undefined,
    });

    try {
      await callRecordingService.handleEgressEnded(egressInfo.egressId, completedSuccessfully);
    } catch (error) {
      logger.error(`[LiveKit Webhook] Error handling egress_ended for egress ${egressInfo.egressId}:`, error);
    }
  }
}

export const livekitWebhookController = new LiveKitWebhookController();
