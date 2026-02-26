import { Request, Response } from 'express';
import { livekitService } from '@/services/liveKitService';
import { repositories } from '@/database/repositories';
import { DatabaseClient, db } from '@/database/client';
import { logger } from '@/utils/logger';
import { v4 as uuidv4 } from 'uuid';
import { transcriptService } from '@/services/transcriptService';
import { CallOrigin, CallStatus, CallType, InvitationResponse } from '@prisma/client';
import { unifiedBotUserService } from '@/bots/unified/services/unified-bot-user-service.js';
import { callSideEffectService } from '@/services/callSideEffectService';
import z from 'zod';

export class CallController {
  /**
   * Helper method to get the Xyne Automatic bot user
   * Uses the unified bot service to ensure consistency with transcript service
   */
  async getOrCreateBotUser() {
    try {
      const botUser = await unifiedBotUserService.getBotByBotId('xyne-automatic');

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
        const botUser = await this.getOrCreateBotUser();
        finalChannelId = await repositories.channels.findOrCreateDMChannel(
          userId,
          [botUser.id],
          repositories.channelParticipants
        );
      }
      // If no channelId but invitedUserIds is provided, find or create channel
      else if (!channelId && invitedUserIds && invitedUserIds.length > 0) {
        finalChannelId = await repositories.channels.findOrCreateDMChannel(
          userId,
          invitedUserIds,
          repositories.channelParticipants
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
      // If conversationId is provided, check for calls matching both channelId and conversationId
      // Otherwise, check for calls matching only channelId
      const existingCall = isHeadless
        ? null
        : conversationId
        ? await repositories.calls.findActiveCallByChannelIdAndConversationId(finalChannelId, conversationId)
        : await repositories.calls.findActiveCallByChannelId(finalChannelId);

      if (existingCall) {
        // Verify the LiveKit room still exists
        const roomInfo = await livekitService.getRoomInfo(existingCall.externalId);

        if (roomInfo) {
          // Room exists, generate token to join the existing call
          const token = await livekitService.generateAccessToken({
            userIdentity: userId,
            roomName: existingCall.externalId,
            userName: userName || userEmail || 'Unknown',
          });

          logger.info(`[${existingCall.externalId}] joining_existing_call | user_id=${userId}, channel_id=${finalChannelId}, correlation_id=${correlationId}`);

          // Return credentials for existing call
          res.json({
            success: true,
            token,
            livekitUrl: livekitService.getServerUrl(),
            externalId: existingCall.externalId,
            roomLink: existingCall.roomLink || `${livekitService.getClientUrl()}/call/${existingCall.externalId}?type=${callType}`,
            channelId: finalChannelId,
          });
          return;
        } else {
          // Room doesn't exist but call is marked as active - mark it as ended
          logger.info(`[${existingCall.externalId}] existing_call_room_stale | marked_as=${existingCall.status}, room_exists=false`);
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

      // Fetch channel to get projectId and boardId for room metadata
      const channel = await repositories.channels.findById(finalChannelId);
      if (!channel) {
        res.status(404).json({ success: false, error: 'Channel not found' });
        return;
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

      await livekitService.createRoom({
        name: callExternalId,
        maxParticipants: 100,
        emptyTimeout: 120,
        metadata: roomMetadata,
      });

      logger.info(`[${callExternalId}] livekit_room_created | user_id=${userId}`);

      // Generate access token for initiator
      const token = await livekitService.generateAccessToken({
        userIdentity: userId,
        roomName: callExternalId,
        userName: userName || userEmail || 'Unknown',
      });

      // Return credentials - DB records will be created by webhook
      res.json({
        success: true,
        token,
        livekitUrl: livekitService.getServerUrl(),
        externalId: callExternalId,
        roomLink,
        channelId: finalChannelId,
      });
    } catch (error) {
      logger.error(`[${callExternalId || 'unknown'}] call_initiation_failed | error=${error}`);
      res.status(500).json({ success: false, error: 'Failed to initiate call' });
    }
  };

  // POST /api/calls/join - Join an existing call
  joinCall = async (req: Request, res: Response): Promise<void> => {
    try {
      const { callId } = req.body;
      const user = req.user;

      if (!user?.id) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      if (!callId) {
        res.status(400).json({ success: false, error: 'Call ID is required' });
        return;
      }

      const call = await repositories.calls.findByExternalId(callId);

      if (call && call.status === CallStatus.ENDED) {
        res.status(400).json({ success: false, error: 'Cannot join an ended call' });
        return;
      }

      // Verify room exists in LiveKit
      const roomInfo = await livekitService.getRoomInfo(callId);
      if (!roomInfo) {
        res.status(404).json({ success: false, error: 'Call room not found' });
        return;
      }

      // Generate access token
      // Participant record will be created/updated by webhook when user actually joins
      const token = await livekitService.generateAccessToken({
        userIdentity: user.id,
        roomName: callId,
        userName: user.name || user.email || 'Unknown',
      });

      logger.info(`LiveKit credentials generated for user ${user.id} to join call ${callId}`);

      // Return credentials - participant record will be handled by webhook
      res.json({
        success: true,
        token,
        livekitUrl: livekitService.getServerUrl(),
        externalId: callId,
        roomLink: call?.roomLink,
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
  private async _processCallTranscript(callId: string, messageId?: string): Promise<{ success: boolean; message?: string; attachmentId?: string; error?: string; statusCode?: number }> {
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
      await transcriptService.processCallWithSummary(callId, callMessage.messageId);

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

    if (!callId) {
      res.status(400).json({ success: false, error: 'Call ID is required' });
      return;
    }

    logger.info(`[${callId}] transcript_ready_webhook_received | webhook_source=python_agent`);

    const result = await this._processCallTranscript(callId);

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
   * Get all HEADLESS recordings for the current user, sorted by newest first
   */
  getRecordings = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    try {
      const recordings = await repositories.calls.findByUserAndType(userId, 'HEADLESS' as CallType);

      // Transform to response format, sorted newest first
      const response = recordings
        .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
        .map(call => ({
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
        }));

      res.json({ success: true, recordings: response });
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

      if (call.transcript && call.transcript.startsWith('gs://')) {
        try {
          // Use transcriptService to fetch from GCS
          transcriptContent = await transcriptService.getTranscriptContent(call.externalId);
        } catch (fetchError) {
          logger.warn(`Failed to fetch transcript from GCS: ${fetchError}`);
        }
      } else if (call.transcript) {
        // If transcript is plain text (legacy), use directly
        transcriptContent = call.transcript;
      }

      // Determine AI summary format (markdown if starts with ## or has no HTML tags)
      let aiSummaryFormat: 'markdown' | 'html' | undefined;
      if (call.aiSummary) {
        const hasHtmlTags = /<[^>]+>/i.test(call.aiSummary);
        const startsWithMarkdown = /^##?\s/.test(call.aiSummary.trim());
        aiSummaryFormat = (!hasHtmlTags || startsWithMarkdown) ? 'markdown' : 'html';
      }

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
          transcript: transcriptContent,
          aiSummary: call.aiSummary,
          aiSummaryFormat,
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
          // Find the message associated with this call
          const callMessage = await repositories.messages['db'].message.findFirst({
            where: {
              metadata: {
                path: ['callId'],
                equals: callId
              }
            }
          });

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

      let gcsPath = call.transcript;

      if (!gcsPath || typeof gcsPath !== 'string') {
        logger.warn(`[${callId}] download_transcript_invalid_gcs_path | gcsPath=${gcsPath}`);
        res.status(404).json({ success: false, error: 'Transcript not available for this call' });
        return;
      }
 

      if (gcsPath.startsWith('gs://')) {
          const match = gcsPath.match(/^gs:\/\/([^\/]+)\/(.+)$/);
          if (match) {
            const [, ,filePath] = match;
            gcsPath = filePath; 
          }
        }
      const transcriptBuffer = await transcriptService.downloadFormattedTranscript(callId, gcsPath);
      
      if (!transcriptBuffer) {
        logger.warn(`[${callId}] download_transcript_not_available | gcs_path=${gcsPath}`);
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
      const { callDocumentService } = await import('@/services/callDocumentService');
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
      const { callDocumentService } = await import('@/services/callDocumentService');
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
}


export const callController = new CallController();

