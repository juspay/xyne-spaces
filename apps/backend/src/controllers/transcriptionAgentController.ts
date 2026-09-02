import { Request, Response } from 'express';
import { CallType, TicketStatusV2 } from '@xyne/shared';
import { z } from 'zod';
import { DatabaseClient } from '@/database/client';
import { repositories } from '@/database/repositories';
import { logger } from '@/utils/logger';
import { resolveChannelDefaultBoard } from '@/utils/channelDefaultBoard';
import { transcriptService } from '@/services/transcriptService';
import { noteTakerTranscriptService } from '@/services/noteTakerTranscriptService';
import { redisService } from '@/services/redisService';
import { livekitService } from '@/services/liveKitService';
import { computeSttHintNames, STT_HINT_NAMES_REDIS_KEY } from '@/queues/warmUserRegistryQueue';
import { TicketController } from './ticketController';
// import { CallController } from './callController';

/**
 * Controller for transcription agent webhooks and tool calls
 * Handles S2S (service-to-service) authenticated requests from Python transcription agent
 */
class TranscriptionAgentController {
  private ticketController: TicketController;
  // private callController: CallController;

  constructor() {
    this.ticketController = new TicketController();
    // this.callController = new CallController();
  }

  /**
   * POST /api/transcriptionAgent/:callId/transcript-ready
   * Webhook called by Python transcription agent when transcript file is uploaded to GCS
   * The agent calls this after successfully closing the GCS stream
   */
  transcriptReady = async (req: Request, res: Response): Promise<void> => {
    const { callId } = req.params;

    if (!callId) {
      res.status(400).json({ success: false, error: 'Call ID is required' });
      return;
    }

    logger.info(`[TranscriptReady] Webhook received for call ${callId}`);

    try {
      // Get call details to find messageId
      const call = await repositories.calls.findByExternalId(callId);
      if (!call) {
        logger.error(`[TranscriptReady] Call not found: ${callId}`);
        res.status(404).json({ success: false, error: 'Call not found' });
        return;
      }

      // Validate request body
      const transcriptReadySchema = z.object({
        hasTranscript: z.boolean().optional(),
      });

      const validationResult = transcriptReadySchema.safeParse(req.body);
      if (!validationResult.success) {
        logger.error(`[TranscriptReady] Invalid request body:`, validationResult.error);
        res.status(400).json({ success: false, error: 'hasTranscript must be a boolean if provided' });
        return;
      }

      const { hasTranscript } = validationResult.data;
      logger.info(`[TranscriptReady] hasTranscript=${hasTranscript} for call ${callId}`);

      // NOTE_TAKER (HEADLESS / "Xyne Oats") calls never have a channel or message —
      // route straight to their own pipeline, skipping the message lookup entirely.
      if (call.callType === CallType.HEADLESS) {
        await noteTakerTranscriptService.processTranscript(call, hasTranscript ?? true);
        res.json({ success: true, message: 'Note taker call processed' });
        return;
      }

      // Find the call system message
      const callMessage = await repositories.messages.findHeadMessageByCallId(callId);

      if (!callMessage) {
        logger.error(`[TranscriptReady] Call message not found for call: ${callId}`);
        res.status(404).json({ success: false, error: 'Call message not found' });
        return;
      }

      // Process transcript and generate AI summary
      await transcriptService.processCallWithSummary(callId, callMessage.messageId, hasTranscript);

      res.json({ success: true, message: 'Transcript processed successfully' });
    } catch (error) {
      logger.error(`[TranscriptReady] Failed to process transcript for call ${callId}:`, error);
      res.status(500).json({ success: false, error: 'Failed to process transcript' });
    }
  };

  /**
   * POST /api/transcriptionAgent/:callId/ticket
   * Create ticket from AI voice assistant during call
   * Uses S2S authentication, posts ticket to call's conversation
   */
  ticketTool = async (req: Request, res: Response): Promise<void> => {
    const { callId } = req.params;
    const { title, description, assignedTo, priority = 'MEDIUM', boardId: requestBoardId } = req.body;

    try {
      // Validate required fields
      if (!callId) {
        res.status(400).json({ success: false, error: 'callId is required' });
        return;
      }

      if (!title || !description) {
        res.status(400).json({ success: false, error: 'title and description are required' });
        return;
      }

      logger.info(`[TicketTool] Creating ticket for call ${callId}: "${title}"`);

      const db = DatabaseClient.getInstance();

      // 1. Get call details
      const call = await repositories.calls.findByExternalId(callId);
      if (!call) {
        logger.error(`[TicketTool] Call not found: ${callId}`);
        res.status(404).json({ success: false, error: 'Call not found' });
        return;
      }

      // 2. Get call message to find conversationId
      const callMessage = await repositories.messages.findHeadMessageByCallId(callId);

      if (!callMessage) {
        logger.error(`[TicketTool] Call message not found for call: ${callId}`);
        res.status(404).json({ success: false, error: 'Call message not found' });
        return;
      }

      const conversationId = callMessage.conversationId;

      // 3. Get conversation and channel
      const conversation = await db.conversation.findUnique({
        where: { conversationId },
      });

      if (!conversation) {
        logger.error(`[TicketTool] Conversation not found: ${conversationId}`);
        res.status(404).json({ success: false, error: 'Conversation not found' });
        return;
      }

      const channel = await repositories.channels.findById(conversation.channelId);
      if (!channel) {
        logger.error(`[TicketTool] Channel not found: ${conversation.channelId}`);
        res.status(404).json({ success: false, error: 'Channel not found' });
        return;
      }

      // 4. Determine boardId - use from request, or get default board for channel
      let boardId = requestBoardId;
      let boardProjectId: string | undefined;
      if (!boardId) {
        // Get default board via ChannelBoardMapping (isDefault, or oldest),
        // falling back to legacy channel.projectId if no mapping exists.
        const resolved = await resolveChannelDefaultBoard(db, channel.id);

        if (!resolved) {
          logger.error(`[TicketTool] No board found for channel: ${channel.id}`);
          res.status(400).json({ success: false, error: 'No board found for channel' });
          return;
        }

        boardId = resolved.boardId;
        boardProjectId = resolved.projectId ?? undefined;
        logger.info(`[TicketTool] Using default board: ${boardId}`);
      } else {
        const board = await db.board.findUnique({
          where: { id: boardId },
          select: { projectId: true },
        });
        boardProjectId = board?.projectId ?? undefined;
      }

      // 5. Create ticket using shared method
      const ticket = await this.ticketController.createTicketWithConversation({
        title,
        description,
        createdBy: call.createdByUserId,
        updatedBy: call.createdByUserId,
        conversationId,
        projectId: boardProjectId!,
        boardId,
        assignedTo: assignedTo || undefined,
        priority: (priority.toUpperCase() as 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'),
        statusV2: TicketStatusV2.TODO, // Default status for transcription agent tickets
      });

      logger.info(`[TicketTool] Ticket created: ${ticket.xyneId} (${ticket.id})`);

      // Return success response
      res.status(201).json({
        success: true,
        ticket: {
          id: ticket.id,
          xyneId: ticket.xyneId,
          title: ticket.title,
          description: ticket.description,
          status: ticket.statusV2,
          priority: ticket.priority,
        },
      });
    } catch (error) {
      logger.error(`[TicketTool] Failed to create ticket for call ${callId}:`, error);
      res.status(500).json({ success: false, error: 'Failed to create ticket' });
    }
  };

  /**
   * GET /api/transcriptionAgent/:callId/my-tickets
   * Get tickets assigned to a specific user (by userId)
   * Query params: userId, status (optional), limit (optional, default 10)
   */
  getMyTickets = async (req: Request, res: Response): Promise<void> => {
    const { callId } = req.params;
    const { userId, status, limit = '10' } = req.query;

    try {
      if (!callId) {
        res.status(400).json({ success: false, error: 'callId is required' });
        return;
      }

      if (!userId || typeof userId !== 'string') {
        res.status(400).json({ success: false, error: 'userId is required' });
        return;
      }

      logger.info(`[GetMyTickets] Fetching tickets for user ${userId} in call ${callId}`);

      const db = DatabaseClient.getInstance();

      // Get call to verify it exists and get project context
      const call = await repositories.calls.findByExternalId(callId);
      if (!call) {
        logger.error(`[GetMyTickets] Call not found: ${callId}`);
        res.status(404).json({ success: false, error: 'Call not found' });
        return;
      }

      // Build query filters
      const whereClause: any = {
        assignedTo: userId,
      };

      // Optionally filter by statusV2
      if (status && typeof status === 'string') {
        whereClause.statusV2 = status.toUpperCase();
      }

      // Fetch tickets assigned to user
      const tickets = await db.ticket.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        take: parseInt(limit as string, 10),
        select: {
          id: true,
          xyneId: true,
          title: true,
          description: true,
          status: true,
          priority: true,
          stageName: true,
          createdAt: true,
          eta: true,
        },
      });

      logger.info(`[GetMyTickets] Found ${tickets.length} tickets for user ${userId}`);

      res.json({
        success: true,
        tickets,
        count: tickets.length,
      });
    } catch (error) {
      logger.error(`[GetMyTickets] Failed to get tickets for call ${callId}:`, error);
      res.status(500).json({ success: false, error: 'Failed to get tickets' });
    }
  };

  /**
   * GET /api/transcriptionAgent/:callId/search-users
   * Search users by name for AI assistant invite feature
   * Query params: q (search query), limit (optional, default 5), excludeUserIds (optional array of user IDs to exclude)
   */
  searchUsers = async (req: Request, res: Response): Promise<void> => {
    const { callId } = req.params;
    const { q, limit = '5', excludeUserIds } = req.query;

    try {
      if (!callId) {
        res.status(400).json({ success: false, error: 'callId is required' });
        return;
      }

      if (!q || typeof q !== 'string') {
        res.status(400).json({ success: false, error: 'Search query (q) is required' });
        return;
      }

      logger.info(`[SearchUsers] Searching users with query "${q}" for call ${callId}`);

      const db = DatabaseClient.getInstance();

      const excludedIds = Array.isArray(excludeUserIds)
        ? excludeUserIds
        : typeof excludeUserIds === 'string'
          ? excludeUserIds.split(',')
          : [];

      const whereClause: any = {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
        ],
        status: 'ACTIVE',
        ...(excludedIds.length > 0 ? { id: { notIn: excludedIds } } : {}),
      };

      // Search users by name (case-insensitive)
      const users = await db.user.findMany({
        where: whereClause,
        take: parseInt(limit as string, 10),
        select: {
          id: true,
          name: true,
          email: true,
        },
      });

      logger.info(`[SearchUsers] Found ${users.length} users matching "${q}"${excludedIds.length > 0 ? ` (excluding ${excludedIds.length} users)` : ''}`);

      res.json({
        success: true,
        users,
        count: users.length,
      });
    } catch (error) {
      logger.error(`[SearchUsers] Failed to search users for call ${callId}:`, error);
      res.status(500).json({ success: false, error: 'Failed to search users' });
    }
  };

  /**
   * GET /api/transcriptionAgent/voiceprints
   * Returns all enrolled voice signatures for real-time speaker identification.
   * Called by the Python agent at runtime instead of reading from room metadata,
   * so there is no 64 KB LiveKit metadata limit and the list stays up-to-date.
   */
  getUserNames = async (_req: Request, res: Response): Promise<void> => {
    try {
      // STT hint priority (highest first): static hot words (added client-side by the
      // agent) > bot users > active human users on our own domain. The ordered,
      // deduplicated list is precomputed daily by warmUserRegistryQueue and cached in
      // Redis; fall back to computing it live if the cache hasn't been populated yet
      // (fresh deploy / Redis flush) so the endpoint never just returns nothing.
      const cached = await redisService.get(STT_HINT_NAMES_REDIS_KEY);
      let names: string[];
      if (cached) {
        names = JSON.parse(cached) as string[];
      } else {
        logger.warn('[UserNames] Cache miss — computing live (warm-user-registry cron may not have run yet)');
        names = await computeSttHintNames();
      }

      logger.info(`[UserNames] Returning ${names.length} user display names to agent`);
      res.json({ success: true, names });
    } catch (error) {
      logger.error('[UserNames] Failed to fetch user names:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch user names' });
    }
  };

  getVoiceprints = async (_req: Request, res: Response): Promise<void> => {
    try {
      const db = DatabaseClient.getInstance();

      const profiles = await db.userProfile.findMany({
        where: { voiceSignature: { not: null } },
        select: { userId: true, voiceSignature: true },
      });

      const userIds = profiles.map((p) => p.userId);
      const users = await db.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true },
      });

      const userMap = new Map(users.map((u) => [u.id, u]));

      const voiceprints = profiles
        .filter((p) => p.voiceSignature)
        .map((p) => {
          const user = userMap.get(p.userId);
          return {
            userId: p.userId,
            name: user?.name || user?.email || 'Unknown',
            embeddingB64: (p.voiceSignature as Buffer).toString('base64'),
          };
        });

      logger.info(`[Voiceprints] Returning ${voiceprints.length} voiceprints to agent`);
      res.json({ success: true, voiceprints });
    } catch (error) {
      logger.error('[Voiceprints] Failed to fetch voiceprints:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch voiceprints' });
    }
  };

  /**
   * POST /api/transcriptionAgent/register-agent
   * A pod calls this once on startup with its own env-var-supplied {agentName, role}.
   * Automates the rollout trigger so a human never has to type an agentName by hand —
   * removes an entire error class (correctly-formatted-but-wrong-build) that live
   * verification alone can't catch. Goes through the exact same verify-then-commit path
   * as the human-facing rollout endpoint (transcriptionAgentRolloutController); this is
   * just a different trigger into it, not a separate write path.
   */
  registerAgent = async (req: Request, res: Response): Promise<void> => {
    const { agentName, role } = (req.body ?? {}) as { agentName?: unknown; role?: unknown };

    if (typeof agentName !== 'string' || !agentName.trim()) {
      res.status(400).json({ success: false, error: 'agentName is required' });
      return;
    }
    if (typeof role !== 'string' || !role.trim()) {
      res.status(400).json({ success: false, error: 'role is required' });
      return;
    }

    try {
      const result = await livekitService.attemptTranscriptionAgentRollout(agentName.trim(), role.trim());
      if (!result.success) {
        // Not a server error — the pod will retry itself on its own backoff. 200 with
        // success:false so the pod's retry logic can distinguish "try again" from a
        // real failure (missing/invalid body), same contract as a validation 400.
        res.status(200).json({ success: false, reason: result.reason });
        return;
      }
      res.status(200).json({ success: true });
    } catch (error) {
      logger.error('[TranscriptionAgent] register_agent_failed', { agentName, role, error });
      res.status(503).json({ success: false, error: 'Service Unavailable' });
    }
  };
}

export const transcriptionAgentController = new TranscriptionAgentController();
