import { Request, Response } from 'express';
import { ChannelRole } from '@prisma/client';
import { livekitService } from '@/services/liveKitService';
import { repositories } from '@/database/repositories';
import { DatabaseClient, db } from '@/database/client';
import { logger } from '@/utils/logger';
import { v4 as uuidv4 } from 'uuid';
import { transcriptService } from '@/services/transcriptService';
import {
  AttachmentEntityType,
  CallOrigin,
  CallStatus,
  CallType,
  InvitationResponse,
  MeetingStatus,
  NotificationType,
} from '@prisma/client';
import { unifiedBotUserService } from '@/bots/unified/services/unified-bot-user-service.js';
import { callSideEffectService } from '@/services/callSideEffectService';
import { userActivityTrackingService } from '@/services/userActivityTrackingService';
import z from 'zod';
import { TrackSource } from 'livekit-server-sdk';
import { HideCallSchema, UpdateRsvpSchema } from '@/validators/callValidator';
import { notificationService } from '@/services/notificationService';
import { scheduledCallNotificationService } from '@/services/scheduledCallNotificationService';
import { normalizeStoragePath } from '@/services/storage/pathUtils';
import { callRecordingService } from '@/services/callRecordingService';
import { config } from '@/config/env';
import { callDocumentService } from '@/services/callDocumentService';
import { SUMMARY_PROMPT_MAX_LENGTH } from '@xyne/shared';

export class CallController {
  updateMeetingStatus = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.id;
    const { callId } = req.params;

    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    if (!callId) {
      res.status(400).json({ success: false, error: 'Call ID is required' });
      return;
    }

    try {
      const { status, isSeries } = UpdateRsvpSchema.parse(req.body);
      const requestedStatus = status;
      const now = new Date();

      const call = await repositories.calls.findByExternalId(callId);
      if (!call) {
        res.status(404).json({ success: false, error: 'Call not found' });
        return;
      }

      if (call.status === CallStatus.ENDED || call.status === CallStatus.CANCELLED) {
        res.status(400).json({ success: false, error: 'Cannot RSVP to an ended or cancelled call' });
        return;
      }

      if (!call.startsAt || call.startsAt <= now) {
        res.status(400).json({ success: false, error: 'RSVP is only allowed for future scheduled calls' });
        return;
      }

      const participant = await repositories.calls.findParticipant(call.id, userId);
      if (!participant) {
        res.status(403).json({ success: false, error: 'You are not a participant of this call' });
        return;
      }

      const updatedCount = await scheduledCallNotificationService.updateParticipantMeetingStatus({
        participantId: participant.id,
        meetingStatus: requestedStatus,
        respondedAt: now,
        isSeries: !!isSeries,
        recurringSeriesId: call.recurringSeriesId ?? undefined,
        userId,
        organizerId: call.createdByUserId,
        callId: call.id,
        callExternalId: call.externalId,
        channelId: call.channelId ?? undefined,
      });

      if (call.createdByUserId !== userId) {
        const responder = await repositories.users.findById(userId);
        const responderName = responder?.name || responder?.email || 'A participant';
        const callName = call.title || 'Scheduled Call';
        
        let notificationTitle = '';
        let notificationMessage = '';
        
        if (requestedStatus === MeetingStatus.ACCEPTED) {
          if (isSeries && call.recurringSeriesId) {
            notificationTitle = 'Call Invite Accepted';
            notificationMessage = `${responderName} accepted call invite for ${callName}`;
          } else {
            const callDateTime = call.startsAt 
              ? new Date(call.startsAt).toLocaleString('en-US', { 
                  month: 'short', 
                  day: 'numeric', 
                  hour: '2-digit', 
                  minute: '2-digit',
                  hour12: true 
                })
              : '';
            notificationTitle = 'Call Invite Accepted';
            notificationMessage = `${responderName} accepted call invite for ${callName} at ${callDateTime}`;
          }
        } else if (requestedStatus === MeetingStatus.DECLINED) {
          if (isSeries && call.recurringSeriesId) {
            notificationTitle = 'Call Invite Declined';
            notificationMessage = `${responderName} declined call invite for ${callName}`;
          } else {
            const callDateTime = call.startsAt 
              ? new Date(call.startsAt).toLocaleString('en-US', { 
                  month: 'short', 
                  day: 'numeric', 
                  hour: '2-digit', 
                  minute: '2-digit',
                  hour12: true 
                })
              : '';
            notificationTitle = 'Call Invite Declined';
            notificationMessage = `${responderName} declined call invite for ${callName} at ${callDateTime}`;
          }
        } else if (requestedStatus === MeetingStatus.MAYBE) {
          const callDateTime = call.startsAt 
              ? new Date(call.startsAt).toLocaleString('en-US', { 
                  month: 'short', 
                  day: 'numeric', 
                  hour: '2-digit', 
                  minute: '2-digit',
                  hour12: true 
                })
              : '';
          notificationTitle = 'Call Invite Response';
          notificationMessage = `${responderName} might join ${callName} at ${callDateTime}`;
        }

        if (notificationTitle && notificationMessage) {
          await notificationService.createNotification(call.createdByUserId, {
            title: notificationTitle,
            message: notificationMessage,
            type: NotificationType.CALL_UPDATED,
            relatedEntityType: 'call',
            relatedEntityId: call.externalId,
            metadata: {
              action: 'CALL_RSVP_UPDATED',
              callId: call.externalId,
              responderUserId: userId,
              responderName,
              meetingStatus: requestedStatus,
              isSeries: Boolean(isSeries && call.recurringSeriesId),
              instanceCount: updatedCount,
            },
          });
        }
      }

      res.json({
        success: true,
        message: 'RSVP status updated successfully',
        rsvpStatus: requestedStatus,
        seriesUpdated: Boolean(isSeries && call.recurringSeriesId),
        instanceCount: updatedCount,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ success: false, error: error.errors[0]?.message || 'Invalid request body' });
        return;
      }

      logger.error('Failed to update RSVP:', error);
      res.status(500).json({ success: false, error: 'Failed to update RSVP' });
    }
  };

  hideCall = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.id;
    const { callId } = req.params;

    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    try {
      const { isSeries } = HideCallSchema.parse(req.body);
      const now = new Date();

      const call = await repositories.calls.findByExternalId(callId);
      if (!call) {
        res.status(404).json({ success: false, error: 'Call not found' });
        return;
      }

      if (call.status === CallStatus.CANCELLED) {
        res.status(400).json({ success: false, error: 'Cannot hide a cancelled call' });
        return;
      }

      if (call.callOrigin === CallOrigin.GOOGLE_CALENDAR || call.callOrigin === CallOrigin.MICROSOFT_CALENDAR) {
        res.status(400).json({ success: false, error: 'Hiding external calendar events is not supported yet' });
        return;
      }

      if (call.createdByUserId === userId) {
        res.status(403).json({ success: false, error: 'Organizers cannot hide their own call — use cancel instead' });
        return;
      }

      const participant = await repositories.calls.findParticipant(call.id, userId);
      if (!participant) {
        res.status(403).json({ success: false, error: 'You are not a participant of this call' });
        return;
      }

      if (participant.meetingStatus === MeetingStatus.HIDDEN) {
        res.status(400).json({ success: false, error: 'Call is already hidden' });
        return;
      }

      const updatedCount = await db.$transaction(async tx => {
        await repositories.calls.updateParticipantMeetingStatus(
          participant.id,
          MeetingStatus.HIDDEN,
          now,
          tx,
        );

        if (isSeries && call.recurringSeriesId) {
          return repositories.calls.updateRecurringSeriesMeetingStatus({
            recurringSeriesId: call.recurringSeriesId,
            userId,
            meetingStatus: MeetingStatus.HIDDEN,
            respondedAt: now,
            tx,
          });
        }

        return 1;
      });

      res.json({
        success: true,
        message: 'Call hidden successfully',
        seriesUpdated: Boolean(isSeries && call.recurringSeriesId),
        instanceCount: updatedCount,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ success: false, error: error.errors[0]?.message || 'Invalid request body' });
        return;
      }

      logger.error('Failed to hide call:', error);
      res.status(500).json({ success: false, error: 'Failed to hide call' });
    }
  };

  /**
   * Helper method to get the Xyne Automatic bot user
   * Uses the unified bot service to ensure consistency with transcript service
   */
  async getOrCreateBotUser(workspaceId: string) {
    try {
      const botUser = await unifiedBotUserService.getBotByBotId('xyne-automatic', workspaceId);

      if (!botUser) {
        throw new Error('Xyne Automatic bot not found - make sure bot registry is initialized');
      }

      return botUser;
    } catch (error) {
      logger.error('Failed to get bot user:', error);
      throw new Error('Failed to get bot user for headless recording');
    }
  }

  // POST /api/calls/initiate - Start a new call
  initiateCall = async (req: Request, res: Response): Promise<void> => {
    const correlationId = uuidv4();
    let callExternalId: string | undefined;
    // Tracks which stage was active when an error is thrown; used in catch log.
    let stage = 'setup';

    try {
      const { callType = 'AUDIO', channelId, invitedUserIds, isHeadless, sttModel, conversationId } = req.body;
      const userId = req.user?.id;
      const userName = req.user?.name;
      const userEmail = req.user?.email;

      logger.info(`[${correlationId}] call_initiation_requested | user_id=${userId}, channel_id=${channelId}, call_type=${callType}, is_headless=${isHeadless}`);

      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      let finalChannelId = channelId;

      // Handle headless recording - create DM with bot
      if (isHeadless && !channelId && !invitedUserIds) {
        stage = 'bot_user_lookup';
        const botUser = await this.getOrCreateBotUser(req.user!.workspaceId!);
        stage = 'dm_channel_resolution';
        finalChannelId = await repositories.channels.findOrCreateDMChannel(
          userId,
          [botUser.id],
          repositories.channelParticipants,
          req.user!.workspaceId!
        );
      }
      // If no channelId but invitedUserIds is provided, find or create channel
      else if (!channelId && invitedUserIds && invitedUserIds.length > 0) {
        stage = 'dm_channel_resolution';
        finalChannelId = await repositories.channels.findOrCreateDMChannel(
          userId,
          invitedUserIds,
          repositories.channelParticipants,
          req.user!.workspaceId!
        );
      }

      // Validate channelId is provided (either directly or resolved from invitedUserIds)
      if (!finalChannelId) {
        res.status(400).json({ success: false, error: 'Either channelId or invitedUserIds is required' });
        return;
      }

      // Validate call type
      if (!['AUDIO', 'VIDEO'].includes(callType)) {
        res.status(400).json({ success: false, error: 'Invalid call type' });
        return;
      }

      // For headless recordings, always create a new recording session
      // For regular calls, check if there's already an active call in this channel
      logger.info(`[${correlationId}] existing_call_check | channel_id=${finalChannelId}, conversation_id=${conversationId || 'none'}`);
      stage = 'existing_call_lookup';
      // If conversationId is provided, check for calls matching both channelId and conversationId
      // Otherwise, check for calls matching only channelId
      const existingCall = isHeadless
        ? null
        : conversationId
          ? await repositories.calls.findActiveCallByChannelIdAndConversationId(finalChannelId, conversationId)
          : await repositories.calls.findActiveCallByChannelId(finalChannelId);

      // Fetch channel to get scopeType (needed for existing call path)
      stage = 'channel_lookup';
      const channel = await repositories.channels.findById(finalChannelId);
      if (!channel) {
        res.status(404).json({ success: false, error: 'Channel not found' });
        return;
      }

      if (existingCall) {
        // Verify the LiveKit room still exists
        stage = 'existing_room_check';
        const roomInfo = await livekitService.getRoomInfo(existingCall.externalId);

        if (roomInfo) {
          // Room exists, generate token to join the existing call
          stage = 'user_lookup_existing_call';
          const user = await db.user.findUnique({ where: { id: userId }, select: { picture: true } });
          stage = 'token_generation_existing_call';
          const token = await livekitService.generateAccessToken({
            userIdentity: userId,
            roomName: existingCall.externalId,
            userName: userName || userEmail || 'Unknown',
            metadata: JSON.stringify({ picture: user?.picture || null }),
          });

          logger.info(`[${existingCall.externalId}] joining_existing_call | user_id=${userId}, channel_id=${finalChannelId}, correlation_id=${correlationId}`);

          void userActivityTrackingService.trackCallJoined(userId, {
            callId: existingCall.externalId,
            channelId: finalChannelId,
          });

          // Return credentials for existing call
          res.json({
            success: true,
            token,
            livekitUrl: livekitService.getServerUrl(),
            externalId: existingCall.externalId,
            roomLink: existingCall.roomLink || `${livekitService.getClientUrl()}/call/${existingCall.externalId}?type=${callType}`,
            channelId: finalChannelId,
            scopeType: channel.scopeType, // Add scopeType for CallKit filtering
          });
          return;
        } else {
          // Room doesn't exist but call is marked as active - mark it as ended
          logger.info(`[${existingCall.externalId}] existing_call_room_stale | marked_as=${existingCall.status}, room_exists=false`);
          stage = 'stale_room_cleanup';
          await repositories.calls.update(existingCall.id, {
            status: CallStatus.ENDED,
            endedAt: new Date(),
          });
          logger.info(`[${existingCall.externalId}] call_status_updated | from=${existingCall.status}, to=ENDED, reason=room_not_found`);
        }
      }

      // No active call or existing call's room is gone - create a new LiveKit room
      // DB records will be created by webhook when first participant joins
      callExternalId = uuidv4();
      logger.info(`[${callExternalId}] creating_new_livekit_room | user_id=${userId}, channel_id=${finalChannelId}, call_type=${callType}, correlation_id=${correlationId}`);

      // Fetch channel to get projectId and boardId for room metadata (only if not already fetched)
      if (!channel) {
        const channelData = await repositories.channels.findById(finalChannelId);
        if (!channelData) {
          res.status(404).json({ success: false, error: 'Channel not found' });
          return;
        }
        // This path should never execute since we already fetched channel above
      }
      // Generate room link
      const roomLink = `${livekitService.getClientUrl()}/call/${callExternalId}?type=${callType}`;

      // Create LiveKit room with metadata
      // The webhook will create all DB records when first participant joins
      const roomMetadata = JSON.stringify({
        channelId: channel.id,
        projectId: channel.projectId,
        callOrigin: conversationId ? CallOrigin.CONVERSATION : CallOrigin.CHANNEL,
        callType: isHeadless ? 'HEADLESS' : callType,
        sttModel: sttModel || 'azure',
        createdBy: userId,
        ...(conversationId && { conversationId }),
        ...(invitedUserIds && invitedUserIds.length > 0 && { invitedUserIds }),
      });

      stage = 'livekit_room_creation';
      await livekitService.createRoom({
        name: callExternalId,
        maxParticipants: 100,
        emptyTimeout: 120,
        metadata: roomMetadata,
      });

      logger.info(`[${callExternalId}] livekit_room_created | user_id=${userId}`);

      setTimeout(async () => {
        try {
          const room = await livekitService.getRoomInfo(callExternalId!);
          if (!room) {
            logger.info(`[${callExternalId}] reason=room_not_active`);
            return;
          }
          const participants = await livekitService.listParticipants(callExternalId!);
          const hasAgent = participants.some(p => p.identity.startsWith('agent-'));
          if (!hasAgent) {
            logger.error(`[${callExternalId}] agent_failed_to_join | reason=timeout_30s`);
          }
        } catch (error) {
          // Room might already be closed or API error, ignore as it's a best-effort diagnostic log
        }
      }, 30000);

      // Generate access token for initiator
      stage = 'initiator_user_lookup';
      const initiator = await db.user.findUnique({ where: { id: userId }, select: { picture: true } });
      stage = 'token_generation_new_call';
      const token = await livekitService.generateAccessToken({
        userIdentity: userId,
        roomName: callExternalId,
        userName: userName || userEmail || 'Unknown',
        metadata: JSON.stringify({ picture: initiator?.picture || null }),
      });

      void userActivityTrackingService.trackCallInitiated(userId, {
        callId: callExternalId,
        channelId: finalChannelId,
        callType,
      });

      // Return credentials - DB records will be created by webhook
      res.json({
        success: true,
        token,
        livekitUrl: livekitService.getServerUrl(),
        externalId: callExternalId,
        roomLink,
        channelId: finalChannelId,
        scopeType: channel.scopeType, // Add scopeType for CallKit filtering
      });
    } catch (error) {
      const callIdForLog = callExternalId ?? correlationId;
      logger.error(`[${callIdForLog}] call_initiation_failed`, { stage, error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined });
      // If room was already created but token generation failed, the LiveKit room is now
      // orphaned. It will auto-close after emptyTimeout=120s, but this log makes it searchable.
      if (callExternalId && stage === 'token_generation_new_call') {
        logger.error(`[${callExternalId}] livekit_room_orphaned`, { reason: 'token_generation_failed_after_room_created', room_will_timeout_in: '120s' });
      }
      res.status(500).json({ success: false, error: 'Failed to initiate call' });
    }
  };

  // POST /api/calls/join - Join an existing call
  joinCall = async (req: Request, res: Response): Promise<void> => {
    try {
      let callId: string = req.body.callId;
      const user = req.user;

      if (!user?.id) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      if (!callId) {
        res.status(400).json({ success: false, error: 'Call ID is required' });
        return;
      }

      let call = await repositories.calls.findByExternalId(callId);

      // --- Recurring series link resolution ---
      // If the requested call belongs to a recurring series, try to redirect the
      // participant to the currently active instance (someone shared an old link).
      // Fallback: use the next upcoming SCHEDULED instance so we don't land on
      // a past or far-future occurrence.
      if (call?.recurringSeriesId) {
        const activeSeriesCall = await repositories.calls.findActiveCallByRecurringSeriesId(call.recurringSeriesId);
        if (activeSeriesCall) {
          logger.info(`[joinCall] Recurring series redirect: old call ${callId} → active call ${activeSeriesCall.externalId}`);
          call = activeSeriesCall;
          callId = activeSeriesCall.externalId;
        } else {
          const nextSeriesCall = await repositories.calls.findLatestCallByRecurringSeriesId(call.recurringSeriesId);
          if (nextSeriesCall) {
            logger.info(`[joinCall] Recurring series redirect: old call ${callId} → next scheduled call ${nextSeriesCall.externalId}`);
            call = nextSeriesCall;
            callId = nextSeriesCall.externalId;
          }
        }
      }

      if (call && call.status === CallStatus.ENDED) {
        res.status(400).json({ success: false, error: 'Cannot join an ended call' });
        return;
      }

      // Fetch channel to get scopeType for CallKit filtering
      let scopeType = null;
      if (call?.channelId) {
        const channel = await repositories.channels.findById(call.channelId);
        scopeType = channel?.scopeType || null;
      }

      // Verify room exists in LiveKit
      const roomInfo = await livekitService.getRoomInfo(callId);

      if (!roomInfo || (call && call.status === CallStatus.SCHEDULED)) {
        // Room doesn't exist - create it if we have a call record
        if (!call) {
          res.status(404).json({ success: false, error: 'Call not found' });
          return;
        }

        logger.info(`Room not found for call ${callId}, creating from call metadata`);

        // Fetch channel to get metadata
        const channel = await repositories.channels.findById(call.channelId ?? '');
        if (!channel) {
          res.status(404).json({ success: false, error: 'Channel not found' });
          return;
        }

        // If room exists (entered due to SCHEDULED status), delete it before creating a fresh one
        if (roomInfo) {
          logger.info(`Found existing room ${callId}, deleting before creating new one`);
          await livekitService.deleteRoom(callId);
          logger.info(`Deleted existing room ${callId}`);
        }

        // Prepare room metadata
        const roomMetadata = JSON.stringify({
          channelId: channel.id,
          projectId: channel.projectId,
          ...(call.status === CallStatus.SCHEDULED && { scheduledCallId: call.id }),
        });

        // Create LiveKit room
        await livekitService.createRoom({
          name: callId,
          maxParticipants: 100,
          emptyTimeout: 120,
          metadata: roomMetadata,
        });

      }

      // Generate access token
      // Participant record will be created/updated by webhook when user actually joins
      const joiner = await db.user.findUnique({ where: { id: user.id }, select: { picture: true } });
      const token = await livekitService.generateAccessToken({
        userIdentity: user.id,
        roomName: callId,
        userName: user.name || user.email || 'Unknown',
        metadata: JSON.stringify({ picture: joiner?.picture || null }),
      });

      logger.info(`LiveKit credentials generated for user ${user.id} to join call ${callId}`);

      void userActivityTrackingService.trackCallJoined(user.id, {
        callId,
        channelId: call?.channelId || undefined,
      });

      // Return credentials - participant record will be handled by webhook
      res.json({
        success: true,
        token,
        livekitUrl: livekitService.getServerUrl(),
        externalId: callId,
        roomLink: call?.roomLink,
        channelId: call?.channelId,
        scopeType, // Channel scope type for CallKit filtering
      });
    } catch (error) {
      logger.error('Failed to join call:', error);
      res.status(500).json({ success: false, error: 'Failed to join call' });
    }
  };

  /**
   * Private helper method to process transcript for a call
   * Shared logic between webhook and manual endpoints
   */
  private async _processCallTranscript(callId: string, messageId?: string, hasTranscript: boolean = true): Promise<{ success: boolean; message?: string; attachmentId?: string; error?: string; statusCode?: number }> {
    try {
      // 1. Verify the call exists
      const call = await repositories.calls.findByExternalId(callId);
      if (!call) {
        logger.error(`Call not found: ${callId}`);
        return { success: false, error: 'Call not found', statusCode: 404 };
      }

      // 2. Get the call message - either by messageId or by callId metadata lookup
      let callMessage;
      if (messageId) {
        logger.info(`Using messageId from request: ${messageId}`);
        callMessage = await repositories.messages.findById(messageId);
        if (!callMessage) {
          logger.error(`Message not found: ${messageId}`);
          return { success: false, error: 'Message not found', statusCode: 404 };
        }

        // Cross-validate that the message belongs to the specified call
        const messageCallId = (callMessage.metadata as { callId?: string })?.callId;
        if (messageCallId !== callId) {
          logger.error(`Message ${messageId} does not belong to call ${callId}. Message callId: ${messageCallId}`);
          return { success: false, error: 'Message does not belong to the specified call', statusCode: 400 };
        }
      } else {
        logger.info(`messageId not provided, querying by callId`);
        callMessage = await repositories.messages['db'].message.findFirst({
          where: {
            metadata: {
              path: ['callId'],
              equals: callId
            }
          }
        });

        if (!callMessage) {
          logger.error(`Call message not found for call: ${callId}`);
          return { success: false, error: 'Call message not found', statusCode: 404 };
        }
      }

      logger.info(`Found call message ${callMessage.messageId} for call ${callId}`);

      // 3. Check if attachment already exists
      const existingAttachments = await repositories.messageAttachments.findByMessageId(callMessage.messageId);
      const transcriptAttachment = existingAttachments.find(att =>
        att.metadata && typeof att.metadata === 'object' && 'type' in att.metadata && att.metadata.type === 'transcript'
      );

      if (transcriptAttachment) {
        logger.info(`Transcript already exists for call ${callId}`);
        return {
          success: true,
          message: 'Transcript already exists',
          attachmentId: transcriptAttachment.id
        };
      }

      // 4. Process the transcript and generate AI summary
      await transcriptService.processCallWithSummary(callId, callMessage.messageId, hasTranscript);

      logger.info(`Successfully processed transcript and AI summary for call ${callId}`);
      return { success: true, message: 'Transcript and summary processed successfully' };
    } catch (error) {
      logger.error(`Failed to process transcript for call ${callId}:`, error);
      return { success: false, error: 'Transcript not available or processing failed', statusCode: 404 };
    }
  }

  /**
   * POST /api/calls/:callId/transcript-ready
   * Webhook called by Python transcription agent when transcript file is uploaded to GCS
   * The agent calls this after successfully closing the GCS stream
   */
  transcriptReady = async (req: Request, res: Response): Promise<void> => {
    const { callId } = req.params;
    const hasTranscript = req.body.hasTranscript ?? true;

    if (!callId) {
      res.status(400).json({ success: false, error: 'Call ID is required' });
      return;
    }

    logger.info(`[${callId}] transcript_ready_webhook_received | webhook_source=python_agent`);
    
    const result = await this._processCallTranscript(callId, undefined, hasTranscript);

    if (result.statusCode) {
      res.status(result.statusCode).json(result);
    } else {
      res.json(result);
    }
  };

  /**
   * POST /api/calls/:callId/process-transcript
   * Manual endpoint to process transcript - triggered by user clicking "View Transcript" button
   * This allows manual retry if webhook fails or for testing before webhook is deployed
   */
  processTranscript = async (req: Request, res: Response): Promise<void> => {
    const { callId } = req.params;
    const { messageId } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    if (!callId) {
      res.status(400).json({ success: false, error: 'Call ID is required' });
      return;
    }

    logger.info(`Manual transcript processing requested for call ${callId} by user ${userId}`);

    const result = await this._processCallTranscript(callId, messageId);

    if (result.statusCode) {
      res.status(result.statusCode).json(result);
    } else {
      res.json(result);
    }
  };

  /**
   * GET /api/calls/recordings
   * Get HEADLESS recordings for the current user, sorted by newest first.
   * Supports cursor-based pagination via query params: limit, cursor (opaque base64 token)
   */
  getRecordings = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      const cursorStr = req.query.cursor as string | undefined;

      let cursor: { startedAt: Date; id: string } | undefined;
      if (cursorStr) {
        try {
          const decoded = Buffer.from(cursorStr, 'base64').toString('utf-8');
          const pipeIdx = decoded.lastIndexOf('|');
          if (pipeIdx < 0) throw new Error('invalid format');
          const startedAt = new Date(decoded.slice(0, pipeIdx));
          const id = decoded.slice(pipeIdx + 1);
          if (isNaN(startedAt.getTime()) || !id) throw new Error('invalid date or id');
          cursor = { startedAt, id };
        } catch {
          res.status(400).json({ success: false, error: 'Invalid cursor' });
          return;
        }
      }

      const { calls, nextCursor: nextCursorObj } = await repositories.calls.findByUserAndType(
        userId,
        'HEADLESS' as CallType,
        { limit, cursor }
      );

      const nextCursor = nextCursorObj
        ? Buffer.from(`${nextCursorObj.startedAt.toISOString()}|${nextCursorObj.id}`).toString('base64')
        : null;

      // Read messageId and recording status directly from the Call row —
      // no extra queries to messages or message_attachments needed.
      const recordings = calls.map((call) => {
        const metadata = call.metadata as { systemMessageId?: string } | null;

        return {
          id: call.id,
          externalId: call.externalId,
          title: call.title || 'Untitled Recording',
          startedAt: call.startedAt,
          endedAt: call.endedAt,
          durationMs: call.endedAt
            ? new Date(call.endedAt).getTime() - new Date(call.startedAt).getTime()
            : null,
          hasTranscript: !!call.transcript,
          hasSummary: !!call.aiSummary,
          hasRecording: !!call.recordingUrl,
          messageId: metadata?.systemMessageId || null,
        };
      });

      res.json({
        success: true,
        recordings,
        nextCursor,
        hasMore: nextCursor !== null,
      });
    } catch (error) {
      logger.error('Failed to fetch recordings:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch recordings' });
    }
  };

  /**
   * GET /api/calls/recordings/:callId
   * Get recording detail with transcript and summary
   */
  getRecordingDetail = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.id;
    const { callId } = req.params;

    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    try {
      const call = await repositories.calls.findByExternalId(callId);

      if (!call) {
        res.status(404).json({ success: false, error: 'Recording not found' });
        return;
      }

      // Verify ownership
      if (call.createdByUserId !== userId) {
        res.status(403).json({ success: false, error: 'Access denied' });
        return;
      }

      // Fetch transcript content from GCS URL if available
      let transcriptContent: string | null = null;
      let identifiedTranscriptContent: string | null = null;

      if (call.transcript) {
        try {
          // Fetch transcript content from storage (handles both legacy gs:// URIs and plain paths)
          transcriptContent = await transcriptService.getTranscriptContent(call.externalId);
        } catch (fetchError) {
          logger.warn(`Failed to fetch transcript from storage: ${fetchError}`);
        }
      }

      // Fetch real-time identified transcript (written during call by the Python agent)
      try {
        identifiedTranscriptContent = await transcriptService.getIdentifiedTranscriptContent(call.externalId);
      } catch (fetchError) {
        logger.warn(`Failed to fetch identified transcript: ${fetchError}`);
      }

      // Determine AI summary format (markdown if starts with ## or has no HTML tags)
      let aiSummaryFormat: 'markdown' | 'html' | undefined;
      if (call.aiSummary) {
        const hasHtmlTags = /<[^>]+>/i.test(call.aiSummary);
        const startsWithMarkdown = /^##?\s/.test(call.aiSummary.trim());
        aiSummaryFormat = (!hasHtmlTags || startsWithMarkdown) ? 'markdown' : 'html';
      }

      // Find the call message's messageId for sharing functionality
      let messageId: string | null = null;
      let conversationId: string | null = null;
      let channelId: string | null = null;
      try {
        const callMessage = await repositories.messages.findHeadMessageByCallId(callId);
        messageId = callMessage?.messageId || null;
        conversationId = callMessage?.conversationId || null;
        if (conversationId) {
          const conversation = await repositories.conversations.findById(conversationId);
          channelId = conversation?.channelId || null;
        }
      } catch (msgError) {
        logger.warn(`Failed to find message for call ${callId}: ${msgError}`);
      }

      const recordingAttachment = await repositories.messageAttachments.findRecordingByCallId(callId).catch(() => null);

      res.json({
        success: true,
        recording: {
          id: call.id,
          externalId: call.externalId,
          title: call.title || 'Untitled Recording',
          startedAt: call.startedAt,
          endedAt: call.endedAt,
          durationMs: call.endedAt
            ? new Date(call.endedAt).getTime() - new Date(call.startedAt).getTime()
            : null,
          hasTranscript: !!transcriptContent,
          hasSummary: !!call.aiSummary,
          transcript: transcriptContent,
          identifiedTranscript: identifiedTranscriptContent,
          hasIdentifiedTranscript: !!identifiedTranscriptContent,
          aiSummary: call.aiSummary,
          aiSummaryFormat,
          messageId,
          conversationId,
          channelId,
          hasRecording: !!recordingAttachment,
        },
      });
    } catch (error) {
      logger.error('Failed to fetch recording detail:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch recording' });
    }
  };

  /**
   * PATCH /api/calls/recordings/:callId
   * Update recording title
   */
  updateRecordingTitle = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.id;
    const { callId } = req.params;
    const { title } = req.body;

    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    if (!title || typeof title !== 'string') {
      res.status(400).json({ success: false, error: 'Title is required' });
      return;
    }

    try {
      const call = await repositories.calls.findByExternalId(callId);

      if (!call) {
        res.status(404).json({ success: false, error: 'Recording not found' });
        return;
      }

      // Verify ownership
      if (call.createdByUserId !== userId) {
        res.status(403).json({ success: false, error: 'Access denied' });
        return;
      }

      await repositories.calls.update(call.id, { title: title.trim() });

      // For headless recordings, update the system message content
      if (call.callType === CallType.HEADLESS) {
        try {
          // Find the message associated with this call using repository method
          const callMessage = await repositories.messages.findHeadMessageByCallId(callId);

          if (callMessage) {
            await repositories.messages.update(callMessage.messageId, {
              content: `Recording Saved: ${title.trim()}`,
              metadata: {
                ...(callMessage.metadata as Record<string, any> || {}),
                operation: 'call_ended',
                messageSubtype: 'call_ended',
              }
            });
            logger.info(`Updated message content for headless recording: ${callId}`);
          }
        } catch (messageError) {
          // Don't fail the request if message update fails
          logger.error('Failed to update message for headless recording:', messageError);
        }
      }

      res.json({ success: true, message: 'Title updated' });
    } catch (error) {
      logger.error('Failed to update recording title:', error);
      res.status(500).json({ success: false, error: 'Failed to update title' });
    }
  };

  /**
   * GET /api/calls/:callId/download-transcript
   * Download call transcript as text file (formatted .txt only)
   */
  downloadTranscript = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.id;
    const { callId } = req.params;

    logger.info(`[${callId}] download_transcript_request_received | user_id=${userId}`);

    if (!userId) {
      logger.warn(`[${callId}] download_transcript_unauthorized | user_id=undefined`);
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    if (!callId) {
      logger.warn(`[${callId}] download_transcript_bad_request | call_id=missing`);
      res.status(400).json({ success: false, error: 'Call ID is required' });
      return;
    }

    try {
      const call = await repositories.calls.findByExternalId(callId);

      if (!call) {
        logger.warn(`[${callId}] download_transcript_call_not_found | user_id=${userId}`);
        res.status(404).json({ success: false, error: 'Call not found' });
        return;
      }

      logger.info(`[${callId}] download_transcript_call_found | call_status=${call.status}, created_by=${call.createdByUserId}`);

      const transcriptPath = call.transcript;

      if (!transcriptPath || typeof transcriptPath !== 'string') {
        logger.warn(`[${callId}] download_transcript_invalid_path | path=${transcriptPath}`);
        res.status(404).json({ success: false, error: 'Transcript not available for this call' });
        return;
      }

      const normalizedPath = normalizeStoragePath(transcriptPath);
      const transcriptBuffer = await transcriptService.downloadFormattedTranscript(callId, normalizedPath);

      if (!transcriptBuffer) {
        logger.warn(`[${callId}] download_transcript_not_available | path=${normalizedPath}`);
        res.status(404).json({ success: false, error: 'Transcript not available for this call' });
        return;
      }

      logger.info(`[${callId}] download_transcript_buffer_received | buffer_size=${transcriptBuffer.length} bytes`);

      const fileName = `call_transcript_${callId}_${new Date().toISOString().split('T')[0]}.txt`;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.setHeader('Content-Length', transcriptBuffer.length);

      logger.info(`[${callId}] download_transcript_headers_set | filename=${fileName}, content_length=${transcriptBuffer.length}`);

      res.send(transcriptBuffer);

      logger.info(`[${callId}] download_transcript_completed | user_id=${userId}, bytes_sent=${transcriptBuffer.length}`);
    } catch (error) {
      logger.error(`[${callId}] download_transcript_failed | user_id=${userId}, error=${error}`);
      res.status(500).json({ success: false, error: 'Failed to download transcript' });
    }
  };

  /**
   * GET /api/calls/:callId/download-recording
   * Download call recording (redirects to signed GCS URL)
   */
  downloadRecording = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.id;
    const { callId } = req.params;

    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    if (!callId) {
      res.status(400).json({ success: false, error: 'Call ID is required' });
      return;
    }

    try {
      const call = await repositories.calls.findByExternalId(callId);
      if (!call) {
        res.status(404).json({ success: false, error: 'Call not found' });
        return;
      }

      if (!call.recordingUrl) {
        res.status(404).json({ success: false, error: 'No recording available for this call' });
        return;
      }

      // Headless recordings are only ever created by the owner — check ownership.
      // For regular calls the creator is already a participant, so the participant
      // check below still covers them.  Doing ownership first avoids a DB query
      // in the common case.
      const isOwner = call.createdByUserId === userId;
      if (!isOwner) {
        const participant = await repositories.calls.findParticipant(call.id, userId);
        if (!participant) {
          res.status(403).json({ success: false, error: 'Access denied' });
          return;
        }
      }

      const recording = await callRecordingService.streamRecording(callId);
      if (!recording) {
        logger.warn(`[${callId}] download_recording_no_file | user_id=${userId}, recordingUrl=${call.recordingUrl}`);
        res.status(404).json({ success: false, error: 'Recording file not found in storage' });
        return;
      }

      res.setHeader('Content-Type', 'audio/mp4');
      res.setHeader('Content-Disposition', `attachment; filename="${recording.filename}"`);
      recording.stream.pipe(res);
    } catch (error) {
      logger.error(`[${callId}] download_recording_failed | user_id=${userId}, error=${error}`);
      res.status(500).json({ success: false, error: 'Failed to download recording' });
    }
  };

  /**
   * POST /api/calls/:callId/generate-prd
   * Generate PRD from call transcript and post to conversation as Canvas
   */
  generatePRD = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.id;
    const { callId } = req.params;
    const { messageId } = req.body;

    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    if (!callId) {
      res.status(400).json({ success: false, error: 'Call ID is required' });
      return;
    }

    logger.info(`PRD generation requested for call ${callId} by user ${userId}`);

    try {
      // 1. Get call details
      const call = await repositories.calls.findByExternalId(callId);
      if (!call) {
        res.status(404).json({ success: false, error: 'Call not found' });
        return;
      }

      // 2. Get call message to find conversationId
      let callMessage;
      if (messageId) {
        callMessage = await repositories.messages.findById(messageId);
      } else {
        callMessage = await repositories.messages['db'].message.findFirst({
          where: {
            metadata: {
              path: ['callId'],
              equals: callId,
            },
          },
        });
      }

      if (!callMessage) {
        res.status(404).json({ success: false, error: 'Call message not found' });
        return;
      }

      // 3. Get transcript content
      const transcriptContent = await transcriptService.getTranscriptContent(call.externalId);
      if (!transcriptContent) {
        res.status(404).json({ success: false, error: 'Transcript not available for this call' });
        return;
      }

      // 4. Get AI summary if available
      const summary = call.aiSummary || null;

      // 5. Generate PRD and post to conversation
      const { customPrompt } = z.object({
        customPrompt: z.string().optional().refine(
          val => !val || val.length < 5000,
          "Custom prompt must be less than 5000 characters"
        ),
      }).parse(req.body);
      const result = await callDocumentService.generateAndPostPRD(
        callId,
        transcriptContent,
        summary,
        userId,
        callMessage.conversationId,
        customPrompt
      );

      if (!result.success) {
        res.status(500).json({ success: false, error: result.error || 'Failed to generate PRD' });
        return;
      }

      logger.info(`Successfully generated PRD for call ${callId}`);
      res.json({
        success: true,
        message: 'PRD generated successfully',
        canvasUrl: result.canvasUrl,
      });
    } catch (error) {
      logger.error('Failed to generate PRD:', error);
      res.status(500).json({ success: false, error: 'Failed to generate PRD' });
    }
  };

  /**
   * POST /api/calls/:callId/generate-detailed-summary
   * Generate detailed summary from call transcript
   */
  generateDetailedSummary = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.id;
    const { callId } = req.params;
    const { messageId, customPrompt } = req.body;

    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    if (!callId) {
      res.status(400).json({ success: false, error: 'Call ID is required' });
      return;
    }

    logger.info(`Detailed summary generation requested for call ${callId} by user ${userId}`);

    try {
      // 1. Get call details
      const call = await repositories.calls.findByExternalId(callId);
      if (!call) {
        res.status(404).json({ success: false, error: 'Call not found' });
        return;
      }

      // 2. Get call message to find conversationId
      let callMessage;
      if (messageId) {
        callMessage = await repositories.messages.findById(messageId);
      } else {
        callMessage = await repositories.messages['db'].message.findFirst({
          where: {
            metadata: {
              path: ['callId'],
              equals: callId,
            },
          },
        });
      }

      if (!callMessage) {
        res.status(404).json({ success: false, error: 'Call message not found' });
        return;
      }

      // 3. Get transcript content
      const transcriptContent = await transcriptService.getTranscriptContent(call.externalId);
      if (!transcriptContent) {
        res.status(404).json({ success: false, error: 'Transcript not available for this call' });
        return;
      }

      // 4. Generate detailed summary and post to conversation
      const result = await callDocumentService.generateAndPostDetailedSummary(
        callId,
        transcriptContent,
        callMessage.conversationId,
        customPrompt
      );

      if (!result.success) {
        res.status(500).json({ success: false, error: result.error || 'Failed to generate detailed summary' });
        return;
      }

      logger.info(`Successfully generated detailed summary for call ${callId}`);
      res.json({
        success: true,
        message: 'Detailed summary generated successfully',
        canvasUrl: result.canvasUrl,
      });
    } catch (error) {
      logger.error('Failed to generate detailed summary:', error);
      res.status(500).json({ success: false, error: 'Failed to generate detailed summary' });
    }
  };

  editSummaryPrompt = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const parsed = z
      .object({
        channelId: z.string().min(1),
        currentPrompt: z.string().max(SUMMARY_PROMPT_MAX_LENGTH),
        instruction: z.string().min(1).max(5000),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: 'channelId, currentPrompt and instruction are required' });
      return;
    }

    const channel = await repositories.channels.findById(parsed.data.channelId);
    if (!channel) {
      res.status(404).json({ success: false, error: 'Channel not found' });
      return;
    }
    const [participant] = await repositories.channelParticipants.findMany({
      channelId: parsed.data.channelId,
      userId,
    });
    const isCreator = channel.createdBy === userId;
    const isAdmin = participant?.role === ChannelRole.ADMIN;
    if (!isCreator && !isAdmin) {
      res.status(403).json({ success: false, error: 'Only channel admins or the owner can edit call summary settings' });
      return;
    }

    try {
      const prompt = await callDocumentService.editSummaryStructureWithAI(
        parsed.data.currentPrompt,
        parsed.data.instruction,
      );
      if (!prompt) {
        res.status(500).json({ success: false, error: 'Failed to edit summary template' });
        return;
      }
      res.json({ success: true, prompt });
    } catch (error) {
      logger.error('Failed to edit summary prompt with AI:', error);
      res.status(500).json({ success: false, error: 'Failed to edit summary template' });
    }
  };

  /**
   * POST /api/calls/:callId/invite
   * Invite users to an active call - creates call_participants with INVITED status
   * This enables notifications for invited users (mirrors Zero mutator behavior)
   */
  inviteUsers = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.id;
    const { callId } = req.params;
    const { userIds } = req.body;

    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    if (!callId) {
      res.status(400).json({ success: false, error: 'Call ID is required' });
      return;
    }

    if (!Array.isArray(userIds) || userIds.length === 0) {
      res.status(400).json({ success: false, error: 'userIds array is required' });
      return;
    }

    try {
      // Get call by externalId
      const call = await repositories.calls.findByExternalId(callId);
      if (!call) {
        res.status(404).json({ success: false, error: 'Call not found' });
        return;
      }

      if (call.status !== 'ACTIVE') {
        res.status(400).json({ success: false, error: 'Call is not active' });
        return;
      }

      const now = new Date();
      const invitedUserIds: string[] = [];
      const db = DatabaseClient.getInstance();

      // Process each user
      for (const targetUserId of userIds) {
        // Check if participant already exists
        const existingParticipant = await repositories.calls.findParticipant(call.id, targetUserId);

        if (existingParticipant) {
          // Re-invite: update to INVITED if not currently accepted/active
          if (existingParticipant.response !== InvitationResponse.ACCEPTED || existingParticipant.leftAt !== null) {
            await db.callParticipant.update({
              where: { id: existingParticipant.id },
              data: {
                response: InvitationResponse.INVITED,
                invitedBy: userId,
                invitedAt: now,
                respondedAt: null,
                joinedAt: null,
                leftAt: null,
              },
            });
            invitedUserIds.push(targetUserId);
          }
          // Already accepted and in call - skip
        } else {
          // Create new participant invitation
          await repositories.calls.createParticipant({
            id: uuidv4(),
            callId: call.id,
            userId: targetUserId,
            invitedBy: userId,
            invitedAt: now,
            response: InvitationResponse.INVITED,
          });
          invitedUserIds.push(targetUserId);
        }
      }

      logger.info(`User ${userId} invited ${invitedUserIds.length} user(s) to call ${callId}`);

      // Notify all connected clients that participants changed
      if (invitedUserIds.length > 0) {
        void livekitService.sendParticipantsChanged(callId);
      }

      res.json({
        success: true,
        invitedCount: invitedUserIds.length,
        invitedUserIds,
      });
    } catch (error) {
      logger.error('Failed to invite users to call:', error);
      res.status(500).json({ success: false, error: 'Failed to invite users' });
    }
  };

  /**
   * POST /api/calls/:callId/decline
   * Decline an incoming call
   */
  declineCall = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.id;
    const { callId } = req.params;

    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    if (!callId) {
      res.status(400).json({ success: false, error: 'Call ID is required' });
      return;
    }

    logger.info(`[CallController] Declining call ${callId} for user ${userId}`);

    try {
      // Find call by external ID
      const call = await repositories.calls.findByExternalId(callId);
      if (!call) {
        logger.warn(`[CallController] Call not found for decline: ${callId}`);
        res.status(404).json({ success: false, error: 'Call not found' });
        return;
      }

      // Find participant record
      const participant = await repositories.calls.findParticipant(call.id, userId);

      if (!participant) {
        logger.warn(`[CallController] Participant not found for decline: callId=${callId}, userId=${userId}`);
        res.status(404).json({ success: false, error: 'Participant not found' });
        return;
      }

      // Only update if currently invited (don't overwrite ACCEPTED/MISSED)
      if (participant.response === InvitationResponse.INVITED) {
        await db.callParticipant.update({
          where: { id: participant.id },
          data: {
            response: InvitationResponse.DECLINED,
            respondedAt: new Date(),
          }
        });

        // Trigger side effects manually as Zero mutator won't catch this API update in time/context
        // This ensures notifications are cancelled and other participants are updated if needed
        await callSideEffectService.handleParticipantResponse(participant.id, InvitationResponse.DECLINED);

        logger.info(`User ${userId} declined call ${callId}`);
      } else {
        logger.info(`User ${userId} attempted to decline call ${callId} but status was ${participant.response}`);
      }

      res.json({ success: true });
    } catch (error) {
      logger.error('Failed to decline call:', error);
      res.status(500).json({ success: false, error: 'Failed to decline call' });
    }
  };

  /**
   * POST /api/calls/:callId/leave
   * Legacy endpoint for backward compatibility with older app versions
   * Returns success immediately without performing any action
   * The webhook handles all participant leave logic
   */
  leaveCall = async (_req: Request, res: Response): Promise<void> => {
    logger.info(`[CallController] Legacy leave call endpoint called - returning success for backward compatibility`);
    res.json({ success: true });
  };

  /**
   * POST /api/calls/:callId/end-for-all
   * Host ends the call for everyone by removing all participants from LiveKit room
   * The webhook will handle marking participants as left and updating call status
   */
  endCallForAll = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.id;
    const { callId } = req.params;

    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    if (!callId) {
      res.status(400).json({ success: false, error: 'Call ID is required' });
      return;
    }

    try {
      const call = await repositories.calls.findByExternalId(callId);
      if (!call) {
        logger.warn(`[CallController] Call not found for end-for-all: ${callId}`);
        res.status(404).json({ success: false, error: 'Call not found' });
        return;
      }

      if (call.createdByUserId !== userId) {
        logger.warn(`[CallController] User ${userId} attempted to end call ${callId} but is not the host`);
        res.status(403).json({ success: false, error: 'Only the call host can end the call for everyone' });
        return;
      }

      // Remove all participants from LiveKit room
      // The webhook will handle marking participants as left and ending the call
      try {
        const participants = await livekitService.listParticipants(callId);

        // Filter out LiveKit agents (default pattern: agent-<id>)
        const participantsToRemove = participants.filter(participant =>
          !participant.identity.startsWith('agent-')
        );

        const removalPromises = participantsToRemove.map(participant =>
          livekitService.removeParticipant(callId, participant.identity)
            .catch(error => {
              logger.warn(`[CallController] Failed to remove participant ${participant.identity}:`, error);
            })
        );

        await Promise.all(removalPromises);

      } catch (liveKitError) {
        logger.warn(`[CallController] Failed to remove participants from room ${callId}:`, liveKitError);
      }

      logger.info(`[CallController] Host ${userId} successfully removed all participants from call ${callId}`);
      res.json({ success: true });
    } catch (error) {
      logger.error('Failed to end call for all:', error);
      res.status(500).json({ success: false, error: 'Failed to end call for everyone' });
    }
  };

  /**
   * Helper method to mute microphones for specified participants
   * @param roomName - The LiveKit room name (callId)
   * @param identities - Array of participant identities to mute
   * @returns Number of tracks muted
   */
  private async muteParticipantMicrophones(roomName: string, identities: string[]): Promise<number> {
    const participants = await livekitService.listParticipants(roomName);
    const identitySet = new Set(identities);

    let mutedCount = 0;
    for (const participant of participants) {
      if (!identitySet.has(participant.identity)) {
        logger.info(
          `[CallController] muteParticipantMicrophones SKIPPING participant | roomName=${roomName}, identity=${participant.identity}, name=${participant.name} not in identitySet`,
        );
        continue;
      }


      for (const track of participant.tracks || []) {
        if (track.source === TrackSource.MICROPHONE && !track.muted) {
          logger.info(`[CallController] muteParticipantMicrophones MUTING track | roomName=${roomName}, identity=${participant.identity}, trackSid=${track.sid}`);
          await livekitService.muteTrack(roomName, participant.identity, track.sid, true);
          mutedCount++;
        }
      }
    }

    return mutedCount;
  }

  // POST /api/calls/:callId/mute-all
  muteAllParticipants = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.id;
    const userName = req.user?.name;
    const userEmail = req.user?.email;
    const { callId } = req.params;

    logger.info(`[CallController] mute-all request received | callId=${callId}, requestingUserId=${userId}, requestingUserName=${userName}, requestingUserEmail=${userEmail}`);

    if (!userId) {
      logger.warn(`[CallController] mute-all unauthorized | callId=${callId}`);
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    try {
      // 1. Validate call exists
      const call = await repositories.calls.findByExternalId(callId);
      if (!call) {
        logger.warn(`[CallController] mute-all call not found | callId=${callId}`);
        res.status(404).json({ success: false, error: 'Call not found' });
        return;
      }

      logger.info(`[CallController] mute-all call found | callId=${callId}, createdByUserId=${call.createdByUserId}`);

      // 2. Host-only check
      if (call.createdByUserId !== userId) {
        logger.warn(`[CallController] mute-all not host | callId=${callId}, userId=${userId}, hostId=${call.createdByUserId}`);
        res.status(403).json({
          success: false,
          error: 'Only the call host can mute all participants',
        });
        return;
      }

      // 3. Get LiveKit participants and collect identities to mute (exclude host & agents)
      const participants = await livekitService.listParticipants(callId);
      const identitiesToMute = participants
        .filter(p => p.identity !== userId && !p.identity.startsWith('agent-'))
        .map(p => p.identity);

      logger.info(`[CallController] mute-all identities to mute | callId=${callId}, count=${identitiesToMute.length}, identities=${identitiesToMute.join(', ')}`);

      // 4. Mute all collected participants
      const mutedCount = await this.muteParticipantMicrophones(callId, identitiesToMute);

      logger.info(`[CallController] mute-all completed | callId=${callId}, mutedCount=${mutedCount}`);

      res.json({ success: true, mutedCount });
    } catch (error) {
      logger.error(`[CallController] mute-all failed | callId=${callId}, error=`, error);
      res.status(500).json({ success: false, error: 'Failed to mute participants' });
    }
  };

  /**
   * POST /api/calls/:callId/mute-participant
   * Mute a specific participant's microphone (host only)
   */
  muteParticipant = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.id;
    const userName = req.user?.name;
    const userEmail = req.user?.email;
    const { callId } = req.params;
    const { participantUserId } = req.body;

    logger.info(`[CallController] mute-participant request received | callId=${callId}, targetUserId=${participantUserId}, requestingUserId=${userId}, requestingUserName=${userName}, requestingUserEmail=${userEmail}`);

    if (!userId) {
      logger.warn(`[CallController] mute-participant unauthorized | callId=${callId}`);
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    if (!participantUserId) {
      logger.warn(`[CallController] mute-participant missing participantUserId | callId=${callId}`);
      res.status(400).json({ success: false, error: 'participantUserId is required' });
      return;
    }

    try {
      // 1. Validate call exists
      const call = await repositories.calls.findByExternalId(callId);
      if (!call) {
        logger.warn(`[CallController] mute-participant call not found | callId=${callId}`);
        res.status(404).json({ success: false, error: 'Call not found' });
        return;
      }

      logger.info(`[CallController] mute-participant call found | callId=${callId}, createdByUserId=${call.createdByUserId}`);

      // 2. Host-only check
      if (call.createdByUserId !== userId) {
        logger.warn(`[CallController] mute-participant not host | callId=${callId}, userId=${userId}, hostId=${call.createdByUserId}`);
        res.status(403).json({
          success: false,
          error: 'Only the call host can mute participants',
        });
        return;
      }

      // 3. Prevent host from muting themselves
      if (participantUserId === userId) {
        logger.warn(`[CallController] mute-participant cannot mute self | callId=${callId}, userId=${userId}`);
        res.status(400).json({
          success: false,
          error: 'Cannot mute yourself',
        });
        return;
      }

      // 4. Prevent muting agents
      if (participantUserId.startsWith('agent-')) {
        logger.warn(`[CallController] mute-participant cannot mute agent | callId=${callId}, targetUserId=${participantUserId}`);
        res.status(400).json({
          success: false,
          error: 'Cannot mute agents',
        });
        return;
      }

      // 5. Mute the participant's microphone
      const mutedCount = await this.muteParticipantMicrophones(callId, [participantUserId]);

      if (mutedCount === 0) {
        logger.info(`[CallController] mute-participant no audio track to mute | callId=${callId}, targetUserId=${participantUserId}`);
      }

      logger.info(`[CallController] mute-participant completed | callId=${callId}, targetUserId=${participantUserId}, mutedCount=${mutedCount}`);

      res.json({ success: true });
    } catch (error) {
      logger.error(`[CallController] mute-participant failed | callId=${callId}, targetUserId=${participantUserId}, error=`, error);
      res.status(500).json({ success: false, error: 'Failed to mute participant' });
    }
  };

  /**
   * DELETE /api/calls/recordings/:callId
   * Delete HEADLESS recording + update messages with placeholder
   */
  deleteRecording = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.id;
    const { callId } = req.params;

    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    try {
      const call = await repositories.calls.findByExternalId(callId);

      if (!call) {
        res.status(404).json({ success: false, error: 'Recording not found' });
        return;
      }

      if (call.createdByUserId !== userId) {
        res.status(403).json({ success: false, error: 'You can only delete your own recordings' });
        return;
      }

      if (call.callType !== CallType.HEADLESS) {
        res.status(400).json({ success: false, error: 'Only recordings can be deleted' });
        return;
      }

      const db = DatabaseClient.getInstance();

      // Find conversation for this recording
      const conversation = await db.conversation.findFirst({
        where: {
          metadata: {
            path: ['callId'],
            equals: callId,
          },
        },
      });

      if (conversation) {
        // Get all message IDs in this conversation to delete their attachments
        const messages = await db.message.findMany({
          where: { conversationId: conversation.conversationId },
          select: { messageId: true },
        });
        const messageIds = messages.map(m => m.messageId);

        // Delete attachments for these messages (transcript attachments, etc.)
        if (messageIds.length > 0) {
          const deleteResult = await db.messageAttachment.deleteMany({
            where: {
              entityId: { in: messageIds },
              entityType: 'CHAT',
            },
          });
          logger.info(`Deleted ${deleteResult.count} attachments for recording ${callId}`);
        }

        // Update all messages in this conversation with placeholder text
        await db.message.updateMany({
          where: {
            conversationId: conversation.conversationId,
          },
          data: {
            content: '<p>Transcript was deleted for this recording</p>',
            metadata: {
              deleted: true,
              deletedAt: new Date().toISOString(),
            },
          },
        });

        logger.info(`Updated messages in conversation ${conversation.conversationId} for deleted recording ${callId}`);
      }

      // Delete activities
      await db.activity.deleteMany({
        where: {
          callId: call.id,
        },
      });

      await db.callParticipant.deleteMany({
        where: {
          callId: call.id,
        },
      });

      // Delete the call record
      await repositories.calls.delete(call.id);

      logger.info(`User ${userId} deleted HEADLESS recording ${callId}`);

      res.json({ success: true });
    } catch (error) {
      logger.error('Failed to delete recording:', error);
      res.status(500).json({ success: false, error: 'Failed to delete recording' });
    }
  };

  /**
   * POST /api/calls/:callId/save-recording-attachment
   * Idempotent: creates (or returns existing) MessageAttachment for a recording.
   * Called by the frontend play button so the attachment is saved to DB at the
   * moment the user first plays the recording, not eagerly on egress completion.
   */
  saveRecordingAttachment = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.id;
    const workspaceId = req.user?.workspaceId;
    const { callId } = req.params;

    if (!userId || !workspaceId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    try {
      const call = await repositories.calls.findByExternalId(callId);
      if (!call) {
        res.status(404).json({ success: false, error: 'Recording not found' });
        return;
      }

      if (call.createdByUserId !== userId) {
        res.status(403).json({ success: false, error: 'Access denied' });
        return;
      }

      if (!call.recordingUrl) {
        res.status(404).json({ success: false, error: 'No recording file available yet' });
        return;
      }

      // Return existing attachment if already saved
      const existing = await repositories.messageAttachments.findRecordingByCallId(callId);
      if (existing) {
        res.json({ success: true, attachmentId: existing.id, alreadyExists: true });
        return;
      }

      const callMessage = await repositories.messages.findHeadMessageByCallId(callId);
      if (!callMessage) {
        res.status(404).json({ success: false, error: 'Call message not found' });
        return;
      }

      // Get workspaceId from call creator's user record
      const callCreator = await repositories.users.findById(call.createdByUserId);
      if (!callCreator || !callCreator.workspaceId) {
        res.status(404).json({ success: false, error: 'Call creator workspace not found' });
        return;
      }
      const workspaceId = callCreator.workspaceId;

      // Get real file size from GCS
      let fileSize = 0;
      try {
        const meta = await callRecordingService.getRecordingMetadata(callId);
        if (meta) fileSize = parseInt(String(meta.size || '0'), 10);
      } catch (err) {
        logger.warn(`[${callId}] save_recording_attachment: could not get file size: ${err}`);
      }

      const filename = call.recordingUrl.split('/').pop() ?? `recording-${callId}.mp4`;
      const attachment = await repositories.messageAttachments.create({
        entityId: callMessage.messageId,
        entityType: AttachmentEntityType.CHAT,
        workspaceId,
        originalFilename: filename,
        size: fileSize,
        mimetype: 'audio/mp4',
        url: call.recordingUrl,
        uploadedByUserId: call.createdByUserId,
        createdBy: call.createdByUserId,
        storageProvider: config.fileStorage.provider,
        conversationId: callMessage.conversationId,
        metadata: {
          callId,
          type: 'recording',
        },
      });

      await repositories.messages.update(callMessage.messageId, { hasAttachment: true });
      logger.info(`[${callId}] save_recording_attachment_created | attachment_id=${attachment.id}`);

      res.json({ success: true, attachmentId: attachment.id });
    } catch (error) {
      logger.error(`Failed to save recording attachment for call ${callId}:`, error);
      res.status(500).json({ success: false, error: 'Failed to save recording attachment' });
    }
  };

  /**
   * POST /api/calls/:callId/pulse-actionable
   * Browser-initiated "Create Actionable" proxy — forwards the request to the
   * Pulse S2S API from the server side so that Pulse credentials are never
   * exposed to the client.
   */
  createPulseActionable = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.id;
    const { callId } = req.params;

    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    if (!callId) {
      res.status(400).json({ success: false, error: 'Call ID is required' });
      return;
    }

    const { title, description, assignee, merchantName, orgId, merchantId, productId } = req.body as {
      title?: string;
      description?: string;
      assignee?: string;
      merchantName?: string;
      orgId?: string;
      merchantId?: string | null;
      productId?: string | null;
    };

    if (!title) {
      res.status(400).json({ success: false, error: 'title is required' });
      return;
    }

    try {
      const { pulseService } = await import('@/services/pulseService');

      // Fetch call info for meetCode and host
      const call = await repositories.calls.findByExternalId(callId);
      if (!call) {
        res.status(404).json({ success: false, error: 'Call not found' });
        return;
      }

      const creatorUser = await repositories.users.findById(call.createdByUserId);
      const host = (creatorUser as any)?.email ?? call.createdByUserId;

      // Prioritize explicit IDs if provided (from pre-resolved frontmatter)
      let orgContext = orgId
        ? { orgId, merchantId: merchantId ?? null, productId: productId ?? null }
        : null;

      // If no explicit IDs, resolve dynamically from merchant name
      if (!orgContext && merchantName) {
        orgContext = await pulseService.resolveOrgForMerchant(merchantName);
      }

      if (!orgContext) {
        return;
      }

      const result = await pulseService.postActionables(
        {
          meetCode: callId,
          host,
          participants: [],
          summary: description ?? title ?? '',
          chapters: [{ topic: title ?? 'Action Item' }],
          action_items: [{ content: title ?? '', assignee: assignee ?? '' }],
        },
        orgContext
      );

      if (result.success) {
        logger.info(`[Pulse] User ${userId} created actionable for call ${callId}: "${title}"`);
        res.json({ success: true });
      } else {
        logger.error(`[Pulse] Failed to create actionable for call ${callId}: ${result.error}`);
        res.status(502).json({ success: false, error: result.error });
      }
    } catch (error) {
      logger.error('Failed to create Pulse actionable:', error);
      res.status(500).json({ success: false, error: 'Failed to create Pulse actionable' });
    }
  };

  /**
   * GET /api/calls/pulse-orgs
   * Return the list of Pulse organisations so the frontend can let users
   * reassign a merchant without exposing Pulse credentials to the browser.
   */
  getPulseOrgs = async (_req: Request, res: Response): Promise<void> => {
    try {
      const { pulseService } = await import('@/services/pulseService');
      const orgs = await pulseService.fetchOrgList();

      // logger.info(`[Pulse] getPulseOrgs: retrieved ${orgs.length} orgs — ${orgs.map(o => o.name ?? o.orgName ?? o.id).join(', ')}`);

      res.json({
        success: true,
        orgs: orgs.map(o => ({
          id: o.id ?? o.orgId ?? '',
          name: o.name ?? o.orgName ?? '',
          orgId: o.id ?? o.orgId ?? '',
          merchantIds: o.merchantIdList ?? o.merchantIds ?? [],
        })),
      });
    } catch (error) {
      logger.error('Failed to fetch Pulse orgs:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch Pulse orgs' });
    }
  };

  /**
   * GET /api/calls/:callId/participants
   * Get all participants for a call with their response status and user details.
   * Used by the native Participants screen.
   */
  getCallParticipants = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.id;
    const { callId } = req.params;

    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    if (!callId) {
      res.status(400).json({ success: false, error: 'Call ID is required' });
      return;
    }

    try {
      logger.info(`[getCallParticipants] Fetching participants for callId: ${callId}`);
      const participants = await repositories.calls.getParticipantsInfo(callId);
      logger.info(`[getCallParticipants] Found ${participants.length} participants for callId: ${callId}`);
      res.json({ success: true, participants });
    } catch (error) {
      logger.error('Failed to get call participants:', error);
      res.status(500).json({ success: false, error: 'Failed to get call participants' });
    }
  };

  getCallChatHistory = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.id;
    const { callId: externalId } = req.params;

    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    if (!externalId) {
      res.status(400).json({ success: false, error: 'Call ID is required' });
      return;
    }

    try {
      const call = await db.call.findUnique({
        where: { externalId },
        select: { id: true },
      });

      if (!call) {
        res.status(404).json({ success: false, error: 'Call not found' });
        return;
      }

      const participant = await db.callParticipant.findFirst({
        where: { callId: call.id, userId },
      });

      if (!participant) {
        res.status(404).json({ success: false, error: 'You are not a participant of this call' });
        return;
      }

      const messages = await repositories.callMessages.getByCallId(call.id);
      const hasExternalMessages = messages.some(m => m.isExternal);

      res.json({ success: true, messages, hasExternalMessages });
    } catch (error) {
      logger.error('Failed to get call chat history:', error);
      res.status(500).json({ success: false, error: 'Failed to get call chat history' });
    }
  };

}

export const callController = new CallController();
