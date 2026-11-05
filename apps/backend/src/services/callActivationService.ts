import { type Call } from '@prisma/client';
import { CallType } from '@xyne/shared';
import { SDLC_TRACK_FLAT_RELATION, type EntityLinkOwner } from '@xyne/shared/sdlc';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseClient } from '@/database/client';
import { repositories } from '@/database/repositories';
import { getCallIntent } from '@/database/repositories/callRepository';
import { emitCallStarted } from '@/automations/triggers/call.trigger';
import { validateOwnerInChannel, resolveItemTrackId, resolveInheritedOwner } from '@/sdlc/entityLinkService';
import { activityService } from '@/services/activity/activityService';
import { callSideEffectService } from '@/services/callSideEffectService';
import { buildCallInviteUrl } from '@/utils/urlUtils';
import { logger } from '@/utils/logger';

/** The owners a call may be filed against; mirrors sdlcCallLinkSchema. */
const SDLC_CALL_OWNER_TYPES: readonly string[] = [
  'CANVAS',
  'TRACK',
  'FOLDER',
  'LINK',
  'ATTACHMENT',
];

/**
 * Turns the PENDING row /initiate wrote into a live call: participants, conversation,
 * system message, SDLC links, the call-started automation event and the invite ring.
 * Everything comes from the intent stored on the row, never from LiveKit metadata.
 *
 * Run by the webhook on the first participant_joined, and again by the validation
 * worker when it finds an occupied room whose row is still PENDING (that webhook
 * failed or was lost). The activating update is guarded by `status: PENDING`, so a
 * retry can never activate twice.
 */
class CallActivationService {
  private get db() {
    return DatabaseClient.getInstance();
  }

  /** Returns the activated call, or null when activation did not happen (already logged). */
  async activatePendingCall(pendingCall: Call, joiningUserId: string): Promise<Call | null> {
    const roomName = pendingCall.externalId;
    const intent = getCallIntent(pendingCall);
    if (!intent?.channelId) {
      logger.error('[CallActivation] pending_call_missing_intent', { room: roomName, call_id: pendingCall.id });
      return null;
    }
    logger.info(`[CallActivation] First participant joined - activating pending call ${roomName}`);

    const channelId = intent.channelId;
    const createdBy = intent.createdBy;
    const callType = intent.callType;
    const callOrigin = intent.callOrigin;
    const existingConversationId = intent.conversationId;
    const artifactMessageId = intent.artifactMessageId;
    const invitedUserIds = intent.invitedUserIds; // Selected participants for conversation calls
    const agentName = intent.agentName;

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
        logger.error('[CallActivation] channel_participants_lookup_failed', {
          stage: 'channel_participants_lookup',
          room: roomName,
          channel: channelId,
          error: participantsError,
        });
        return null;
      }
    }

    const now = new Date();

    const conversationId = existingConversationId || uuidv4();
    const messageId = uuidv4();
    const callId = pendingCall.id;
    const roomLink = pendingCall.roomLink ?? buildCallInviteUrl(roomName);

    // Activate the pending row and create participants, conversation and system
    // message atomically. If this transaction fails the LiveKit room is live with a
    // row still PENDING — room_finished or the stale sweep cancels it later.
    const channelRecord = { workspaceId: pendingCall.workspaceId };
    const result = await repositories.calls.createCallWithParticipantsAndMessage({
      callId,
      roomName,
      channelId,
      workspaceId: pendingCall.workspaceId,
      createdBy,
      callType,
      roomLink,
      joiningUserId,
      channelParticipants: participantsToInvite,
      conversationId,
      messageId,
      now,
      callOrigin,
      ...(typeof artifactMessageId === 'string' && { artifactMessageId }),
      agentName,
      dispatchStatus: agentName ? 'dispatched' : undefined,
      pendingCall,
    }).catch((txError) => {
      logger.error('[CallActivation] call_activation_failed', {
        stage: 'call_activation',
        room: roomName,
        channel: channelId,
        call_id: callId,
        error: txError,
      });
      return null;
    });

    if (!result) return null;

    const call = result.call;

    // SDLC linking: the initiator validated this context; now that the call
    // and its conversation exist, record the entity mapping. Owner is a
    // canvas or a track — either way the same two links are written:
    //   OWNER -> CALL (relation CALL) and OWNER -> CONVERSATION (DISCUSSION).
    const sdlcLink = intent.sdlcLink;
    if (sdlcLink?.ownerType && sdlcLink.ownerId) {
      try {
        const linkWorkspaceId = channelRecord?.workspaceId ?? null;
        const ownerValid = SDLC_CALL_OWNER_TYPES.includes(sdlcLink.ownerType)
          ? await validateOwnerInChannel(
              this.db,
              {
                sourceType: sdlcLink.ownerType as EntityLinkOwner['sourceType'],
                sourceId: sdlcLink.ownerId,
              },
              channelId
            )
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
          // A conversation filed against an item is also filed against the
          // item's track, the way a message-started one is through
          // entityLinkContext.trackRollUp. Without this edge the call's
          // conversation exists but never appears in the track's list.
          if (
            sdlcLink.ownerType === 'FOLDER' ||
            sdlcLink.ownerType === 'ATTACHMENT' ||
            sdlcLink.ownerType === 'LINK'
          ) {
            const rollUpTrackId = await resolveItemTrackId(
              this.db,
              sdlcLink.ownerType,
              sdlcLink.ownerId
            );
            if (rollUpTrackId) {
              await this.db.sdlcEntityLink.createMany({
                data: [
                  {
                    workspaceId: linkWorkspaceId,
                    channelId,
                    sourceType: 'TRACK',
                    sourceId: rollUpTrackId,
                    targetType: 'CONVERSATION',
                    targetId: conversationId,
                    relationType: SDLC_TRACK_FLAT_RELATION,
                    createdBy,
                  },
                ],
                skipDuplicates: true,
              });
            }
          }
          if (existingConversationId) {
            await activityService.fillSdlcOwner(conversationId, channelId);
          }
          logger.info(
            `[CallActivation] sdlc_link_created | call=${roomName} owner=${sdlcLink.ownerType}:${sdlcLink.ownerId}`,
          );
        }
      } catch (sdlcLinkError) {
        // Linking must never break call creation.
        logger.warn('[CallActivation] sdlc_link_failed', {
          call: roomName,
          error: sdlcLinkError,
        });
      }
    } else if (existingConversationId) {
      // A call started inside a discussion belongs where the discussion does: its
      // DISCUSSION link names the track, item or artifact, and the call is filed
      // there too. The conversation already carries that link.
      try {
        const linkWorkspaceId = channelRecord?.workspaceId ?? null;
        const owner = await resolveInheritedOwner(this.db, existingConversationId, channelId);
        if (linkWorkspaceId && owner) {
          await this.db.sdlcEntityLink.createMany({
            data: [
              {
                workspaceId: linkWorkspaceId,
                channelId,
                sourceType: owner.sourceType,
                sourceId: owner.sourceId,
                targetType: 'CALL',
                targetId: callId,
                relationType: 'CALL',
                createdBy,
              },
            ],
            skipDuplicates: true,
          });
          logger.info(
            `[CallActivation] sdlc_call_link_inherited | call=${roomName} owner=${owner.sourceType}:${owner.sourceId}`,
          );
        }
      } catch (inheritError) {
        // Linking must never break call creation.
        logger.warn('[CallActivation] sdlc_call_link_inherit_failed', {
          call: roomName,
          error: inheritError,
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
        logger.error(`[CallActivation] Failed to emit call-started automation event:`, autoError);
      });
      logger.info(`[CallActivation] Emitted call-started automation event for ${roomName}`);
    }

    logger.info(`[CallActivation] Successfully activated call ${roomName} for its first participant`);

    // Disabled (LLM)
    // // Generate title from thread call
    // if (callOrigin === CallOrigin.CONVERSATION && existingConversationId && call) {
    //   const callIdForUpdate = call.id;
    //   transcriptService.generateCallTitleFromConversation(existingConversationId)
    //     .then(async (generatedTitle) => {
    //       if (generatedTitle) {
    //         await repositories.calls.update(callIdForUpdate, { title: generatedTitle });
    //         logger.info(`[CallActivation] Generated and saved title "${generatedTitle}" for call ${roomName}`);
    //       }
    //     })
    //     .catch((error) => {
    //       logger.error(`[CallActivation] Failed to generate title for call ${roomName}:`, error);
    //     });
    // }

    // Trigger notifications for invited participants
    if (result.invitedParticipantIds.length > 0) {
      logger.info(`[CallActivation] Triggering notifications for ${result.invitedParticipantIds.length} invited participants`);
      await Promise.allSettled(
        result.invitedParticipantIds.map(async (participantId) => {
          try {
            await callSideEffectService.handleParticipantInvited(participantId);
          } catch (error) {
            logger.error(`[CallActivation] Failed to trigger notification for participant ${participantId}:`, error);
          }
        })
      );
    }
    return call;
  }
}

export const callActivationService = new CallActivationService();
