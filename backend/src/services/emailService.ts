/**
 * Email Service
 * Handles email-related operations including creating conversations with emails
 * Similar to ConversationService but specifically for email handling
 */

import {
  ConversationRepository,
  CreateConversationInput,
} from '@/database/repositories/conversationRepository';
import { MessageRepository, CreateMessageInput } from '@/database/repositories/messageRepository';
import { EmailRepository } from '@/database/repositories/emailRepository';
import { syncTicketEmailCount } from '@/database/syncTicketEmailCount';
import {
  MessageAttachmentRepository,
  CreateMessageAttachmentInput,
} from '@/database/repositories/messageAttachmentRepository';
import { ChannelRepository } from '@/database/repositories/channelRepository';
import { UserRepository } from '@/database/repositories/users';
import { BoardRepository } from '@/database/repositories/boardRepository';
import { EmailChannelPreferenceRepository } from '@/database/repositories/emailChannelPreferenceRepository';
import { DatabaseClient } from '@/database/client';
import {
  MessageType,
  EmailType,
  ChannelType,
  Prisma,
  AttachmentEntityType,
  VespaOperationType,
  VespaInsertionStatus,
  MessageDirection,
  ExternalEntityType,
  TicketPriority,
} from '@prisma/client';
import { ExternalSourceRepository } from '@/database/repositories/externalSourceRepository';
import { adapterRegistry } from '@/integrations/core/adapterRegistry';
import { websocketService } from './websocketService';
import { redisService } from './redisService';
import { isRegisteredBot, getBotInfo } from '@/bots/core/bot-utils';
import { PrismaClient, EmailMergeMode } from '@prisma/client';
import { evaluateAssignmentRule } from '@/utils/assignmentEngine';
import { syncUserWorkload } from '@/utils/workloadUtils';
import { ticketAssignmentService } from '@/services/ticketAssignmentService';
import { BaseTicketType, type BoardMetadata } from '@xyne/shared';
import { UploadedFileResult } from './fileUploadService';
import { config } from '@/config/env';
import { workflowManager, WorkflowType } from '@/workflows';
import { superpositionClient } from './superpositionClient';
import { createBlockingContext } from '@/utils/superpositionUtils';
import { vespaQueue } from '@/queues/vespaQueue';
import { ticketSchema, mailSchema } from '@/vespa/src/types';
import { logger } from '@/utils/logger';
import { messageMetadataService } from '@/services/messageMetadataService';
import { db } from '@/database/client';
import { NAMESPACE } from '@/vespa/vespaConfig';
import { processMeetLinksFromEmail } from './meetLinkService';
import { repositories } from '@/database/repositories';
import { TicketIdService } from './ticketIdService';
import { syncConversationTicketMdFromPrismaTicket } from '@/utils/ticketMd';
import { generateDescription } from './agents/description-generator';
import { dispatchEmailEventForEmailId } from '@/apps/core/emailUtils';
import { v4 as uuidv4 } from 'uuid';
import { marked } from 'marked';
import { findDuplicateEmailConversation } from '@/utils/vespaDuplicateDetector';
import { emailClassificationQueue } from '@/queues/emailClassificationQueue';
import { xyneAIStream } from '@/agents/xyne-ai';
import { AUTODRAFT_SESSION_TAG } from '@/controllers/xyneAIController';
import { AgentsConfig } from '@/agents/config';
import { buildDraftEmailSystemPrompt } from '@/agents/xyne-ai/prompts/draft';
import type { UserInfo as AgentUserInfo } from '@/agents/xyne-ai/tools/types';
import { computeSlaDueDates } from '@/utils/slaCalculator';


interface UserInfo {
  id: string;
  name: string;
  email: string;
  picture?: string;
}

export interface CreateConversationWithEmailParams {
  channelId: string;
  boardId?: string; // @deprecated - Target board for ticket creation. Now fetched from EmailChannelPreference table. Kept for backward compatibility.
  userId: string;
  emailSubject: string;
  emailBody: string;
  emailTo: string[];
  emailFrom: string;
  emailCc?: string[];
  emailBcc?: string[];
  emailReplyTo?: string[];
  externalThreadId: string;
  externalMessageId: string;
  ticketMetadata?: Record<string, unknown>;
  uploadedFiles?: UploadedFileResult[];
  sourceName?: string; // External source name for Superposition context
  receivedAt?: Date;
}

export interface AddEmailToConversationParams {
  conversationId: string;
  emailSubject: string;
  emailBody: string;
  emailTo: string[];
  emailFrom: string;
  emailCc?: string[];
  emailBcc?: string[];
  emailReplyTo?: string[];
  externalThreadId: string;
  externalMessageId: string;
  emailType?: EmailType;
  uploadedFiles?: UploadedFileResult[];
  receivedAt?: Date;
}

export interface CreateConversationFromEmailParams {
  channelId: string;
  userId: string;
  emailSubject: string;
  emailBody: string;
  emailTo: string[];
  emailFrom: string;
  emailCc?: string[];
  emailBcc?: string[];
  externalThreadId: string;
  externalMessageId: string;
  projectId: string;
  boardId: string;
  stageName: string;
  userGroupId?: string;
  ticketMetadata?: Record<string, unknown>;
}

export interface IngestEmailThreadParams {
  channelId: string;
  externalThreadId: string;
  externalSourceId: string;
  userId: string;
  emails: Array<{
    externalMessageId: string;
    subject: string;
    body: string;
    from: string;
    to: string[];
    cc?: string[];
    bcc?: string[];
    replyTo?: string[];
    receivedAt: Date;
    type?: EmailType;
    uploadedFiles?: UploadedFileResult[];
  }>;
  ticketMetadata?: Record<string, unknown>;
  sourceName?: string;
}

export interface IngestEmailThreadResult {
  conversationId: string;
  ticketId?: string;
  ticketXyneId?: string;
  inserted: number;
  duplicates: number;
  isNew: boolean;
  blocked?: boolean;
  wasVespaMerge?: boolean;
}

interface ThreadTxResult {
  conversationId: string;
  ticketId?: string;
  ticketXyneId?: string;
  inserted: number;
  duplicates: number;
  isNew: boolean;
  wasVespaMerge?: boolean;
}

const SUBJECT_PREFIX_REGEX = /^(\s*(re|fwd|fw)\s*:\s*)+/i;

function derivePriorityFromSubject(subject: string): TicketPriority {
  const normalizedSubject = (subject || '').replace(SUBJECT_PREFIX_REGEX, '').toLowerCase();

  if (/\b(critical|sev0|p0)\b/.test(normalizedSubject)) {
    return TicketPriority.CRITICAL;
  }

  if (/\b(urgent|high|sev1|p1)\b/.test(normalizedSubject)) {
    return TicketPriority.HIGH;
  }

  if (/\b(medium|normal|sev2|p2)\b/.test(normalizedSubject)) {
    return TicketPriority.MEDIUM;
  }

  return TicketPriority.LOW;
}

export class EmailService {
  private conversationRepository: ConversationRepository;
  private messageRepository: MessageRepository;
  private emailRepository: EmailRepository;
  private messageAttachmentRepository: MessageAttachmentRepository;
  private channelRepository: ChannelRepository;
  private userRepository: UserRepository;
  private boardRepository: BoardRepository;
  private emailChannelPreferenceRepository: EmailChannelPreferenceRepository;
  private prisma: PrismaClient;

  constructor() {
    this.conversationRepository = new ConversationRepository();
    this.messageRepository = new MessageRepository();
    this.emailRepository = new EmailRepository();
    this.messageAttachmentRepository = new MessageAttachmentRepository();
    this.channelRepository = new ChannelRepository();
    this.userRepository = new UserRepository();
    this.boardRepository = new BoardRepository();
    this.emailChannelPreferenceRepository = new EmailChannelPreferenceRepository();
    this.prisma = DatabaseClient.getInstance();
  }

  /**
   * Looks up the active SLA policy for (boardId, priority) and returns the
   * computed resolution deadline to store in `eta`, but only when the board
   * has `slaPolicyType === 'priority'` in its metadata.
   *
   * The response deadline is intentionally NOT stored — it is derived at
   * runtime from the policy config.  Returns null when:
   *   - boardId is null/undefined
   *   - the board's slaPolicyType is not 'priority'
   *   - no active policy exists for this board+priority combination
   *   - any lookup/computation error occurs
   */
  private async getSlaResolutionDue(
    boardId: string | null | undefined,
    priority: TicketPriority,
    receivedAt: Date,
  ): Promise<Date | null> {
    if (!boardId) return null;
    try {
      // Only apply priority-based SLA when the board has explicitly opted in.
      const board = await this.prisma.board.findUnique({
        where: { id: boardId },
        select: { metadata: true },
      });
      const metadata = board?.metadata as { slaPolicyType?: string } | null;
      if (metadata?.slaPolicyType !== 'priority') return null;

      const policy = await this.prisma.boardSlaPolicy.findUnique({
        where: { boardId_priority: { boardId, priority } },
        select: {
          responseHours: true,
          resolutionHours: true,
          businessHoursOnly: true,
          timezone: true,
          workdayStart: true,
          workdayEnd: true,
          isActive: true,
        },
      });
      if (!policy || !policy.isActive) return null;
      const { slaResolutionDue } = computeSlaDueDates(receivedAt, policy);
      return slaResolutionDue;
    } catch (err) {
      logger.warn('[EmailService] Failed to compute SLA resolution due date:', err);
      return null;
    }
  }

  /**
   * Get user info - checks bot registry first, then user table
   * Similar to ConversationService.getUserInfo
   */
  async getUserInfo(userId: string): Promise<UserInfo> {
    // Check if this is a registered bot
    if (isRegisteredBot(userId)) {
      const botInfo = getBotInfo(userId);
      if (botInfo) {
        return botInfo;
      }
    }

    try {
      const user = await this.userRepository.findById(userId);
      if (user) {
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          picture: user.picture || undefined,
        };
      }
    } catch (error) {
      logger.warn(`Failed to lookup user ${userId}:`, error);
    }

    return {
      id: userId,
      name: 'User',
      email: 'user@example.com',
      picture: undefined,
    };
  }
  private async pushVespaJobForMail(
    emailId: string,
    userId: string,
    workspaceId?: string
  ): Promise<void> {
    vespaQueue.addJob({
      schema: mailSchema,
      jobType: 'feed',
      docId: emailId,
      ...(workspaceId ? { workspaceId } : {}),
    }).catch(async (error) => {
      logger.error('[EmailService] Error queuing Vespa job for mail:', error);
      try {
        const vespaLogs = db.vespaInsertionLogs;
        if (vespaLogs) {
          await vespaLogs.create({
            data: {
              status: VespaInsertionStatus.FAILED,
              type: VespaOperationType.INSERT,
              entityId: emailId,
              entityType: mailSchema,
              namespace: NAMESPACE,
              errorMessage: `Failed to enqueue Vespa mail job: ${error instanceof Error ? error.message : String(error)}`,
              errorDetails: JSON.stringify(error),
              userId: userId,
              createdAt: new Date(),
            },
          });
        }
      } catch (dbError) {
        logger.error('[EmailService] Failed to log Vespa mail insertion error to database:', dbError);
      }
    });
  }

  private async pushVespaJobForTicket(
    ticketId: string,
    userId: string,
    workspaceId?: string
  ): Promise<void> {
    vespaQueue.addJob({
      schema: ticketSchema,
      jobType: "feed",
      docId: ticketId,
      ...(workspaceId ? { workspaceId } : {}),
    }).catch(async (error) => {
      logger.error('[EmailService] Error queuing Vespa job for ticket:', error);
      try {
        const vespaLogs = db.vespaInsertionLogs;
        if (vespaLogs) {
          await vespaLogs.create({
            data: {
              status: VespaInsertionStatus.FAILED,
              type: VespaOperationType.INSERT,
              entityId: ticketId,
              entityType: ticketSchema,
              namespace: NAMESPACE,
              errorMessage: `Failed to enqueue Vespa job: ${error instanceof Error ? error.message : String(error)}`,
              errorDetails: JSON.stringify(error),
              userId: userId,
              createdAt: new Date(),
            },
          });
        }
      } catch (dbError) {
        logger.error('[EmailService] Failed to log Vespa insertion error to database:', dbError);
      }
    });
  }

  /**
   * Fire-and-forget: run the description-generator on the email body and update
   * the ticket's description column when it resolves. Never throws. Ticket row
   * stays with the raw body if the AI call fails or times out, so webhook
   * ingestion is never blocked by AI availability.
   */
  private async enrichTicketDescription(params: {
    ticketId: string;
    emailBody: string;
    emailSubject: string;
    userId: string;
    channelId: string;
  }): Promise<void> {
    const { ticketId, emailBody, emailSubject, userId, channelId } = params;
    let updatedTicket;
    try {
      const result = await generateDescription(
        { rawContext: emailBody, title: emailSubject },
        { userId, channelId },
      );

      if (!result.description || result.description.trim().length === 0) return;

      updatedTicket = await this.prisma.ticket.update({
        where: { id: ticketId },
        data: { description: result.description, updatedBy: userId },
      });

      // Re-index so search reflects the cleaned description.
      this.pushVespaJobForTicket(ticketId, userId).catch(() => {});
      logger.info(`[EmailService] Ticket description enriched`, { ticketId });
    } catch (error) {
      logger.warn('[EmailService] Ticket description enrichment failed — keeping raw body', {
        ticketId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return;
    }

    // Description is now persisted. Refresh the denormalised markdown
    // projections so the UI / AI consumers see the enriched version instead of
    // the raw email body. Failures here don't roll back the description — they
    // just leave the md stale, which will self-heal on the next ticket update.
    try {
      await syncConversationTicketMdFromPrismaTicket(this.prisma, updatedTicket);
      if (updatedTicket.conversationId) {
        await messageMetadataService.syncInitialMessageMd(updatedTicket.conversationId);
      }
    } catch (error) {
      logger.warn('[EmailService] Ticket description enriched but md sync failed', {
        ticketId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async triggerAutoDraft(params: {
    ticketId: string;
    conversationId: string;
    channelId: string;
    emailSubject: string;
    emailBody: string;
  }): Promise<void> {
    const { ticketId, conversationId, channelId, emailSubject, emailBody } = params;
    const startTime = Date.now();

    logger.info('[AutoDraft] start', {
      mode: 'autodraft',
      ticketId,
      conversationId,
      channelId,
      subjectLen: emailSubject?.length ?? 0,
      bodyLen: emailBody?.length ?? 0,
    });

    const preference = await this.emailChannelPreferenceRepository.findByChannelId(channelId);
    if (preference?.autoDraftMode !== 'DRAFT') {
      logger.info('[AutoDraft] skip: auto-draft not enabled for channel', {
        mode: 'autodraft',
        ticketId,
        channelId,
        autoDraftMode: preference?.autoDraftMode ?? 'unset',
        durationMs: Date.now() - startTime,
      });
      return;
    }

    const personaUserId = preference.ownerUserId;
    if (!personaUserId) {
      logger.info('[AutoDraft] skip: no desk owner configured', {
        mode: 'autodraft',
        ticketId,
        channelId,
        durationMs: Date.now() - startTime,
      });
      return;
    }

    const persona = await this.userRepository.findById(personaUserId);
    if (!persona?.email) {
      logger.warn('[AutoDraft] skip: desk owner has no email', {
        mode: 'autodraft',
        ticketId,
        channelId,
        ownerUserId: personaUserId,
        durationMs: Date.now() - startTime,
      });
      return;
    }

    const userInfo: AgentUserInfo = {
      userId: persona.id,
      userName: persona.name || 'Support',
      userEmail: persona.email,
    };

    const signatureCount = await this.prisma.emailSignature.count({
      where: { userId: personaUserId },
    });
    
    const hasDeskSignature = signatureCount > 0;
    const agentsConfig = await AgentsConfig.fetch({ email: persona.email });
    const baseQuery = `Draft a reply for this ticket.\n\nLatest inbound email:\nSubject: ${emailSubject}\n\n${emailBody}\n\n---\nWhen looking up topic context for this draft, use \`search_relevant_content\` (covers chat messages, tickets, AND canvases together). Reserve \`search_files\` for cases where you need a specific file artifact by name — using it instead of \`search_relevant_content\` for topic lookup misses every chat thread and ticket on the topic.`;

    let summary = '';
    let autodraftSessionId: string | undefined;
    const streamStart = Date.now();
    logger.info('[AutoDraft] stream invoke', {
      mode: 'autodraft',
      ticketId,
      conversationId,
      channelId,
      hasDeskSignature,
      queryLen: baseQuery.length,
    });
    try {
      const stream = xyneAIStream({
        query: baseQuery,
        channelIds: [channelId],
        conversationId,
        userId: personaUserId,
        userInfo,
        webSearchEnabled: true,
        deepResearchEnabled: false,
        ticketIds: [ticketId],
        agentName: 'ask-ai',
        agentsConfig,
        systemPromptOverride: buildDraftEmailSystemPrompt(userInfo, hasDeskSignature),
      });

      for await (const chunk of stream) {
        if (chunk.type === 'start' && typeof chunk.sessionId === 'string') {
          autodraftSessionId = chunk.sessionId;
        }
        if (chunk.type === 'complete' && chunk.output?.summary) {
          summary = chunk.output.summary;
          break;
        }
      }
      logger.info('[AutoDraft] stream complete', {
        mode: 'autodraft',
        ticketId,
        sessionId: autodraftSessionId,
        summaryLen: summary.length,
        streamDurationMs: Date.now() - streamStart,
      });
    } catch (error) {
      logger.warn('[AutoDraft] stream failed', {
        mode: 'autodraft',
        ticketId,
        sessionId: autodraftSessionId,
        streamDurationMs: Date.now() - streamStart,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }


    if (!summary.trim()) {
      logger.warn('[AutoDraft] skip persist: empty summary', {
        mode: 'autodraft',
        ticketId,
        sessionId: autodraftSessionId,
        durationMs: Date.now() - startTime,
      });
      return;
    }

    const html = await marked.parse(summary);
    const now = new Date();
    try {
      const existingSeed = await this.prisma.emailDraft.findFirst({
        where: { conversationId, userId: null },
        select: { id: true },
      });
      if (existingSeed) {
        await this.prisma.emailDraft.update({
          where: { id: existingSeed.id },
          data: { draftContent: html, channelId, updatedAt: now },
        });
      } else {
        await this.prisma.emailDraft.create({
          data: {
            conversationId,
            channelId,
            userId: null,
            draftContent: html,
          },
        });
      }
      logger.info('[AutoDraft] draft persisted', {
        mode: 'autodraft',
        ticketId,
        conversationId,
        sessionId: autodraftSessionId,
        htmlLen: html.length,
      });
    } catch (error) {
      logger.error('[AutoDraft] persist failed', {
        mode: 'autodraft',
        ticketId,
        conversationId,
        sessionId: autodraftSessionId,
        durationMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      });

      return;
    }

    if (autodraftSessionId) {
      try {
        await this.prisma.workflowExecution.update({
          where: { id: autodraftSessionId },
          data: { tag: AUTODRAFT_SESSION_TAG },
        });
        logger.info('[AutoDraft] session tagged', {
          mode: 'autodraft',
          ticketId,
          sessionId: autodraftSessionId,
        });
      } catch (error) {
        logger.warn('[AutoDraft] session tagging failed', {
          mode: 'autodraft',
          ticketId,
          sessionId: autodraftSessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    logger.info('[AutoDraft] done', {
      mode: 'autodraft',
      ticketId,
      conversationId,
      sessionId: autodraftSessionId,
      durationMs: Date.now() - startTime,
      summaryLen: summary.length,
    });
  }

  /**
   * Private utility function to create attachment entries for email
   */
  private async createEmailAttachments(
    emailId: string,
    conversationId: string,
    userId: string,
    workspaceId: string,
    uploadedFiles: UploadedFileResult[]
  ): Promise<void> {
    if (!uploadedFiles || uploadedFiles.length === 0) {
      return;
    }

    const attachmentData: CreateMessageAttachmentInput[] = uploadedFiles.map((file) => ({
      entityId: emailId,
      entityType: AttachmentEntityType.EMAIL,
      originalFilename: file.originalName,
      size: file.fileSize,
      mimetype: file.mimeType,
      url: file.fileUrl,
      thumbnailUrl: file.thumbnailUrl,
      width: file.width,
      height: file.height,
      uploadedByUserId: userId,
      createdBy: userId,
      storageProvider: config.fileStorage.provider,
      conversationId: conversationId,
      workspaceId: workspaceId,
      metadata: file.metadata || {},
    }));

    await this.messageAttachmentRepository.createMany(attachmentData);
  }

  /**
   * Create new conversation with empty message, ticket, and email entry.
   * Creates conversation first, then ticket, then message.
   * Ensures channel type is set to EMAIL and broadcasts the new conversation.
   */
  async createConversationWithEmail(params: CreateConversationWithEmailParams) {
    const {
      channelId,
      boardId: passedBoardId, // boardId passed from ExternalSource
      userId,
      emailSubject,
      emailBody,
      emailTo,
      emailFrom,
      emailCc = [],
      emailBcc = [],
      emailReplyTo = [],
      externalThreadId,
      externalMessageId,
      ticketMetadata,
      uploadedFiles = [],
      sourceName,
      receivedAt,
    } = params;

    // Check if channel exists and get projectId
    const channel = await this.channelRepository.findById(channelId);
    if (!channel) {
      throw new Error('Channel not found');
    }

    // If channel type is not EMAIL, set it to EMAIL
    if (channel.type !== ChannelType.EMAIL) {
      await this.channelRepository.update(channelId, {
        type: ChannelType.EMAIL,
      });
    }
    
    // Step 0: Superposition guard — bail out before creating anything
    if (sourceName) {
      try {
        const context = createBlockingContext({
          sourceName: sourceName,
          email: emailFrom,
          emailSubject: emailSubject,
        });

        if (!superpositionClient.isReady()) {
          logger.warn('[EmailService] SuperpositionClient not ready, proceeding without blocking check', {
            sourceName,
            email: emailFrom,
            domain: context.domain,
          });
        } else {
          const isBlocked = await superpositionClient.getBooleanValue('blocked', false, context);
          
          logger.info('[EmailService] Superposition check result', {
            sourceName,
            domain: context.domain,
            email: emailFrom,
            isBlocked,
          });

          if (isBlocked) {
            logger.warn('[EmailService] Blocking Zoho ingestion (no conversation/ticket/email)', {
              sourceName,
              domain: context.domain,
              email: emailFrom,
            });
            return { blocked: true };
          }
        }
      } catch (error) {
        logger.error('[EmailService] Error checking Superposition flag, proceeding with ticket creation', {
          error: error instanceof Error ? error.message : 'Unknown error',
          sourceName,
        });
        // If Superposition check fails, proceed with ticket creation (fail-open)
      }
    }

    const projectId = channel.projectId;

    // Fetch boardId from EmailChannelPreference table
    const emailChannelPreference = await this.emailChannelPreferenceRepository.findByChannelId(channelId);

    // boardId MUST be configured in EmailChannelPreference - no fallback allowed
    // If passed boardId exists (deprecated), prefer the one from EmailChannelPreference
    const configuredBoardId = emailChannelPreference?.boardId || passedBoardId;

    if (!configuredBoardId) {
      logger.error(`[EmailService] EmailChannelPreference missing boardId configuration for channel: ${channelId}`);
      throw new Error(`EmailChannelPreference must have a boardId configured. Channel: ${channelId}. Please configure boardId in email_channel_preferences table.`);
    }

    // Validate that the configured boardId exists
    const configuredBoard = await this.boardRepository.findById(configuredBoardId);
    if (!configuredBoard) {
      logger.error(`[EmailService] Configured boardId ${configuredBoardId} not found in database`);
      throw new Error(`Configured boardId ${configuredBoardId} not found in database. Please verify email_channel_preferences.boardId points to a valid board.`);
    }

    // Validate that the board belongs to the same project as the channel
    if (configuredBoard.projectId !== projectId) {
      logger.error(`[EmailService] Board project mismatch: boardId ${configuredBoardId} belongs to project ${configuredBoard.projectId}, but channel belongs to project ${projectId}`);
      throw new Error(`Configured boardId ${configuredBoardId} belongs to different project (${configuredBoard.projectId} vs ${projectId}). Email channel and board must be in the same project.`);
    }

    const boardId = configuredBoardId;
    logger.info(`[EmailService] Using configured boardId ${boardId} from EmailChannelPreference table`);

    // Validate that board has stages before creating conversation
    const stages = await this.prisma.stage.findMany({
      where: {
        boardId: boardId
      },
      orderBy: {
        sequenceNumber: 'asc'
      }
    });

    if (!stages || stages.length === 0) {
      throw new Error(`No stages found for board ${boardId}. Board must have at least one stage.`);
    }

    const firstStage = stages[0];

    // Get assignee user group from EmailChannelPreference (already fetched above)
    const groupId = emailChannelPreference?.assigneeUserGroupId;

    let userGroup = null;
    if (groupId) {
      userGroup = await this.prisma.userGroup.findUnique({
        where: { id: groupId },
        select: { id: true },
      });
    }

    // Derive ticket priority outside the transaction so we can look up the SLA policy.
    const ticketPriorityForSla = derivePriorityFromSubject(emailSubject ?? '');
    const slaResolutionDue = await this.getSlaResolutionDue(
      boardId,
      ticketPriorityForSla,
      receivedAt ?? new Date(),
    );

    // Create conversation + email + ticket in a single transaction.
    // Email has @@unique on externalMessageId — if a duplicate notification arrives
    // concurrently, the transaction rolls back everything (no orphaned tickets).
    let txResult: { conversation: any; ticket: any; email: any };
    try {
      txResult = await this.prisma.$transaction(async (tx) => {
      // Create conversation
      const conv = await tx.conversation.create({
        data: {
          channelId,
          createdBy: userId,
          initialMessageId: 'temp',
          ...(receivedAt && { createdAt: receivedAt, lastActivityAt: receivedAt }),
        },
      });

      // Create email FIRST — unique constraint on externalMessageId acts as dedup lock.
      // If this fails (P2002), the entire transaction rolls back.
      const createdEmail = await tx.email.create({
        data: {
          type: EmailType.DEFAULT,
          subject: emailSubject,
          body: emailBody,
          to: emailTo,
          from: emailFrom,
          cc: emailCc || [],
          bcc: emailBcc || [],
          replyTo: emailReplyTo || [],
          conversationId: conv.conversationId,
          channelId,
          externalThreadId,
          externalMessageId,
          ...(receivedAt && { createdAt: receivedAt }),
        } as Prisma.EmailUncheckedCreateInput,
      });

      // Generate xyneId and create ticket
      const xyneId = await TicketIdService.generateTicketId(tx, projectId);
      const ticketTitle = (emailSubject ?? '').replace(SUBJECT_PREFIX_REGEX, '').trim() || emailSubject;
      const ticketPriority = derivePriorityFromSubject(emailSubject);
      const createdTicket = await tx.ticket.create({
        data: {
          title: ticketTitle,
          description: emailBody,
          createdBy: userId,
          updatedBy: userId,
          conversationId: conv.conversationId,
          channelId,
          xyneId,
          projectId,
          workspaceId: channel.workspaceId,
          boardId,
          emailCount: 1,
          lastEmailAt: receivedAt ?? new Date(),
          stageName: firstStage.name,
          priority: ticketPriority,
          ticketType: BaseTicketType.DESK,
          ...(slaResolutionDue && { eta: slaResolutionDue }),
          ...(userGroup && { userGroupId: groupId }),
          ...(ticketMetadata && { metadata: ticketMetadata as Prisma.InputJsonValue }),
          ...(receivedAt && { createdAt: receivedAt }),
        },
      });

      await syncConversationTicketMdFromPrismaTicket(tx, createdTicket);

      await tx.channelUserStatus.updateMany({
        where: { channelId, isDeleted: false },
        data: { unreadCount: { increment: 1 }, updatedAt: new Date() },
      });

      return { conversation: conv, ticket: createdTicket, email: createdEmail };
    });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        logger.warn(`[EmailService] Duplicate externalMessageId skipped: ${externalMessageId}`);
        return { isDuplicate: true };
      }
      throw err;
    }
    const { conversation, ticket, email } = txResult;

    // --- Side effects (outside transaction) ---

    // Direct DB insert bypasses Zero side-effects, so dispatch the EMAIL app event ourselves.
    void dispatchEmailEventForEmailId(email.id);

    this.pushVespaJobForTicket(ticket.id, userId, channel.workspaceId).catch(error => {
      logger.error(`[EmailService] Error pushing Vespa job for ticket ${ticket.id}:`, error);
    });

    // Enqueue AI classification as a Redis worker job
    await emailClassificationQueue.getQueue().add('classify', {
      ticketId: ticket.id,
      channelId,
      subject: emailSubject,
      body: emailBody,
      groupId: groupId ?? null,
    }).catch((err: unknown) => {
      logger.error(`[Classification] Failed to enqueue classification job for ticket ${ticket.id}`, err);
    });

    // Fire-and-forget: enrich the ticket description via the AI agent. Never
    // blocks ingestion; ticket keeps the raw email body if this fails or times out.
    void this.enrichTicketDescription({
      ticketId: ticket.id,
      emailBody,
      emailSubject,
      userId,
      channelId,
    });

    // Auto-assign ticket based on group and board
    if (groupId && boardId) {
      try {
        const boardRow = await this.prisma.board.findUnique({ where: { id: boardId }, select: { metadata: true } });
        const boardMetadata = boardRow?.metadata as BoardMetadata | undefined;

        if (boardMetadata?.fullRoleAssignment === true) {
          const fullRoles = await ticketAssignmentService.assignFullRolesToTicket({
            ticketId: ticket.id,
            userGroupId: groupId,
            boardId,
            createdBy: userId,
            projectId: ticket.projectId,
          });
          if (fullRoles.member) {
            const updatedTicket = await this.prisma.ticket.update({
              where: { id: ticket.id },
              data: { assignedTo: fullRoles.member },
            });
            await syncConversationTicketMdFromPrismaTicket(this.prisma, updatedTicket);
          }
        } else {
        const assignmentResult = await evaluateAssignmentRule(groupId, boardId, undefined, undefined, ticket.projectId);
        if (assignmentResult.assignedUserId) {
          const updatedTicket = await this.prisma.ticket.update({
            where: { id: ticket.id },
            data: { assignedTo: assignmentResult.assignedUserId }
          });

          await syncConversationTicketMdFromPrismaTicket(this.prisma, updatedTicket);

          // Sync workload mapping for the assigned user
          try {
            await syncUserWorkload(assignmentResult.assignedUserId, groupId, boardId, userId);
            logger.info(`[EmailService] Synced workload for user ${assignmentResult.assignedUserId}`);
          } catch (workloadError) {
            logger.error('[EmailService] Error syncing workload:', workloadError);
            }
          }
        }
      } catch (error) {
        logger.error('[EmailService] Auto-assignment failed:', error);
      }
    }

    void this.triggerAutoDraft({
      ticketId: ticket.id,
      conversationId: conversation.conversationId,
      channelId,
      emailSubject,
      emailBody,
    });

    // Start workflow (only for Zoho sources, controlled by config)
    const isZohoSource = sourceName?.startsWith('zoho');
    let workflowResult: { workflowId: string; executionId: string; status: string } | null = null;
    if (isZohoSource && config.zoho.autoWorkflowEnabled) {
      try {
        workflowResult = await workflowManager.startWorkflow({
          ticketId: ticket.id,
          workflowType: WorkflowType.GENIUS_QUERY_WORKFLOW,
          context: {
            ticketId: ticket.id
          }
        });
        logger.info(`Workflow created for ticket ${ticket.id}: ${workflowResult.workflowId}`);
      } catch (error) {
        logger.error("Error while creating workflow zoho: tickets", error)
      }
    } else {
      logger.info(`[EmailService] Skipping auto-workflow for ticket ${ticket.id} (ZOHO_AUTO_WORKFLOW_ENABLED=false)`);
    }

    // Create message with ticket
    const messageData: CreateMessageInput = {
      conversationId: conversation.conversationId,
      senderId: userId,
      content: '',
      hasAttachment: true,
      metadata: {
        ticketId: ticket.id,
      },
    };

    const message = await this.messageRepository.create(messageData, true);

    // Update conversation with real initial message ID
    await this.conversationRepository.update(conversation.conversationId, {
      initialMessageId: message.messageId,
      ticketId: ticket.id
    });
    await messageMetadataService.syncInitialMessageMd(conversation.conversationId);

    if (isZohoSource && config.zoho.autoWorkflowEnabled) {
      const messageDataSys: CreateMessageInput = {
        conversationId: conversation.conversationId,
        senderId: userId,
        content: '',
        msgType: MessageType.SYSTEM,
        hasAttachment: true,
        metadata: {
          ticketId: ticket.id,
          xyneId: ticket.xyneId,
          ...(workflowResult && {
            workflowId: workflowResult.workflowId,
            workflowName: emailSubject,
            workflowType: WorkflowType.GENIUS_QUERY_WORKFLOW,
          }),
        },
      };
      await this.messageRepository.create(messageDataSys, true);
    }

    // Push Vespa job for mail indexing (Desk search). `email` is created
    // inside the conversation+email+ticket transaction earlier in this method.
    this.pushVespaJobForMail(email.id, userId, channel.workspaceId).catch(error => {
      logger.error(`[EmailService] Error pushing Vespa job for mail ${email.id}:`, error);
    });

    // Create MessageAttachment entries for email attachments
    await this.createEmailAttachments(email.id, conversation.conversationId, userId, channel.workspaceId, uploadedFiles);

    // Process Google Meet links from email body and send to SAM 
    try {
      const zohoTicketId = ticketMetadata?.ticketId as string | undefined;
      if (!zohoTicketId) {
        logger.warn('[EmailService] No Zoho ticketId found in metadata, skipping meet link processing', {
          xyneTicketId: ticket.xyneId,
          externalThreadId,
        });
      } else {
        const meetResult = await processMeetLinksFromEmail(
          emailBody,
          ticket.xyneId,
          externalThreadId,
          zohoTicketId
        );
        if (meetResult.processed > 0) {
          logger.info('[EmailService] Processed Google Meet links', {
            xyneTicketId: ticket.xyneId,
            meetCodes: meetResult.meetCodes,
          });
        }
      }
    } catch (error) {
      // Don't fail email processing if meet link extraction fails
      logger.error('[EmailService] Failed to process meet links', {
        error: error instanceof Error ? error.message : 'Unknown error',
        xyneTicketId: ticket.xyneId,
      });
    }

    // Update channel last activity
      await this.channelRepository.updateLastActivity(channelId);

      // Get sender info
      const senderInfo = await this.getUserInfo(userId);

      // Broadcast new conversation via WebSocket
      const conversationMessage = {
        conversationId: conversation.conversationId,
        channelId,
        messageId: message.messageId,
        senderId: senderInfo.id,
        senderName: senderInfo.name,
        senderPicture: senderInfo.picture,
        content: message.content,
        msgType: message.msgType,
        hasAttachment: message.hasAttachment,
        attachments: [],
        createdAt: message.createdAt,
      };

      // Real-time broadcast via WebSocket
      await websocketService.broadcastToSession(channelId, 'new_conversation', conversationMessage);

    // Also broadcast via Redis for horizontal scaling
    await redisService.broadcastMessageToSession(channelId, conversationMessage);

    return {
      conversation,
      message,
      ticket,
      email,
      channel,
      senderInfo,
    };
  }

  /**
   * Add email entry to existing conversation
   * Just creates an email record, nothing else
   */
  async addEmailToConversation(params: AddEmailToConversationParams) {
    try {
      const {
        conversationId,
        emailSubject,
        emailBody,
        emailTo,
        emailFrom,
        emailCc = [],
        emailBcc = [],
        emailReplyTo = [],
        externalThreadId,
        externalMessageId,
        emailType = EmailType.DEFAULT,
        uploadedFiles = [],
        receivedAt,
      } = params;

      // Validate conversation exists
      const conversation = await this.conversationRepository.findById(conversationId);
      if (!conversation) {
        throw new Error('Conversation not found');
      }

      // Get channel and check if type is EMAIL, if not set it to EMAIL
      const channel = await this.channelRepository.findById(conversation.channelId);
      if (channel && channel.type !== ChannelType.EMAIL) {
        await this.channelRepository.update(conversation.channelId, {
          type: ChannelType.EMAIL,
        });
      }

      // Create email entry
      const emailData = {
        type: emailType,
        subject: emailSubject,
        body: emailBody,
        to: emailTo,
        from: emailFrom,
        cc: emailCc,
        bcc: emailBcc,
        replyTo: emailReplyTo,
        conversationId: conversationId,
        channelId: conversation.channelId,
        externalThreadId: externalThreadId,
        externalMessageId: externalMessageId,
        ...(receivedAt && { createdAt: receivedAt }),
      };

      const email = await this.emailRepository.create(emailData);

      // Direct DB insert bypasses Zero side-effects, so dispatch the EMAIL app event ourselves.
      void dispatchEmailEventForEmailId(email.id);

      const ticketRow = await this.prisma.ticket.findFirst({
        where: { conversationId },
        select: { id: true, lastEmailAt: true },
      });

      if (ticketRow) {
        if (receivedAt && receivedAt > ticketRow.lastEmailAt) {
          await this.prisma.ticket.update({
            where: { id: ticketRow.id },
            data: { lastEmailAt: receivedAt },
          });
        }

        const previousLatest = await this.prisma.email.findFirst({
          where: { conversationId, id: { not: email.id } },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        });

        if (previousLatest) {
          const caughtUpUsers = await this.prisma.emailRead.findMany({
            where: {
              ticketId: ticketRow.id,
              lastReadEmailId: previousLatest.id,
            },
            select: { userId: true },
          });
          if (caughtUpUsers.length > 0) {
            await this.prisma.channelUserStatus.updateMany({
              where: {
                channelId: conversation.channelId,
                userId: { in: caughtUpUsers.map(r => r.userId) },
                isDeleted: false,
              },
              data: { unreadCount: { increment: 1 }, updatedAt: new Date() },
            });
          }
        }
      }

      this.pushVespaJobForMail(email.id, conversation.createdBy, channel?.workspaceId).catch(error => {
        logger.error(`[EmailService] Error pushing Vespa job for mail ${email.id}:`, error);
      });

      // Create MessageAttachment entries for email attachments
      await this.createEmailAttachments(email.id, conversation.conversationId, conversation.createdBy, channel?.workspaceId ?? '', uploadedFiles);

      if (ticketRow) {
        void this.triggerAutoDraft({
          ticketId: ticketRow.id,
          conversationId,
          channelId: conversation.channelId,
          emailSubject,
          emailBody,
        });
      }

      // Process Google Meet links from reply email body and send to SAM service
      try {
        // Get ticket associated with this conversation to get xyneTicketId and zohoTicketId
        const ticket = await repositories.tickets.findByConversationIdForMeet(conversationId);

        if (ticket?.xyneId) {
          // Extract zohoTicketId from ticket metadata
          const ticketMetadata = ticket.metadata as Record<string, unknown> | null;
          const zohoTicketId = ticketMetadata?.ticketId as string | undefined;
          
          if (!zohoTicketId) {
            logger.warn('[EmailService] No Zoho ticketId found in ticket metadata, skipping meet link processing for reply', {
              xyneTicketId: ticket.xyneId,
              externalThreadId,
              conversationId,
            });
          } else {
            const meetResult = await processMeetLinksFromEmail(
              emailBody,
              ticket.xyneId,
              externalThreadId,
              zohoTicketId
            );
            if (meetResult.processed > 0) {
              logger.info('[EmailService] Processed Google Meet links from reply', {
                xyneTicketId: ticket.xyneId,
                meetCodes: meetResult.meetCodes,
              });
            }
          }
        }
      } catch (error) {
        // Don't fail email processing if meet link extraction fails
        logger.error('[EmailService] Failed to process meet links from reply', {
          error: error instanceof Error ? error.message : 'Unknown error',
          conversationId,
        });
      }

      return {
        email,
        conversation,
      };
    } catch (error) {
      logger.warn('Error in addEmailToConversation:', error);
      throw error;
    }
  }

  /**
   * Create new conversation and ticket from existing email data
   * Used for demerge operation to create a new ticket from a demerged email
   */
  async createConversationFromEmail(params: CreateConversationFromEmailParams) {
    const {
      channelId,
      userId,
      emailSubject,
      emailBody,
      projectId,
      boardId,
      stageName,
      userGroupId,
      ticketMetadata,
    } = params;

    // Check if channel exists
    const channel = await this.channelRepository.findById(channelId);
    if (!channel) {
      throw new Error('Channel not found');
    }

    // If channel type is not EMAIL, set it to EMAIL
    if (channel.type !== ChannelType.EMAIL) {
      await this.channelRepository.update(channelId, {
        type: ChannelType.EMAIL,
      });
    }

    // Step 1: Create conversation
    const conversationData: CreateConversationInput = {
      channelId,
      createdBy: userId,
      initialMessageId: 'temp',
    };

    const conversation = await this.conversationRepository.create(conversationData);

    // Step 2: Create ticket in a transaction.
    // Derive priority + SLA deadline outside the transaction so a slow policy
    // lookup never holds an open DB transaction.
    const ticketPriority = derivePriorityFromSubject(emailSubject);
    const slaResolutionDue = await this.getSlaResolutionDue(boardId, ticketPriority, new Date());
    const ticket = await this.prisma.$transaction(async (tx) => {
      // Generate xyneId using project-scoped format
      const xyneId = await TicketIdService.generateTicketId(tx, projectId);

      return await tx.ticket.create({
        data: {
          title: emailSubject,
          description: emailBody,
          createdBy: userId,
          updatedBy: userId,
          conversationId: conversation.conversationId,
          channelId: channelId,
          xyneId: xyneId,
          projectId: projectId,
          workspaceId: channel.workspaceId,
          boardId: boardId,
          stageName: stageName,
          priority: ticketPriority,
          ticketType: BaseTicketType.DESK,
          ...(slaResolutionDue && { eta: slaResolutionDue }),
          ...(userGroupId && { userGroupId }),
          ...(ticketMetadata && { metadata: ticketMetadata as Prisma.InputJsonValue }),
          lastEmailAt: new Date(),
        }
      });
    });

    this.pushVespaJobForTicket(ticket.id, userId, channel.workspaceId).catch(error => {
      logger.error(`[EmailService] Error pushing Vespa job for ticket ${ticket.id}:`, error);
    });

    // Fire-and-forget enrichment — same pattern as createConversationWithEmail.
    void this.enrichTicketDescription({
      ticketId: ticket.id,
      emailBody,
      emailSubject,
      userId,
      channelId,
    });

    // Auto-assign ticket if userGroupId is provided
    if (userGroupId && boardId) {
      try {
        const boardRow = await this.prisma.board.findUnique({ where: { id: boardId }, select: { metadata: true } });
        const boardMetadata = boardRow?.metadata as BoardMetadata | undefined;

        if (boardMetadata?.fullRoleAssignment === true) {
          const fullRoles = await ticketAssignmentService.assignFullRolesToTicket({
            ticketId: ticket.id,
            userGroupId,
            boardId,
            createdBy: userId,
            projectId: ticket.projectId,
          });
          if (fullRoles.member) {
            const updatedTicket = await this.prisma.ticket.update({
              where: { id: ticket.id },
              data: { assignedTo: fullRoles.member },
            });
            await syncConversationTicketMdFromPrismaTicket(this.prisma, updatedTicket);
          }
        } else {
        const assignmentResult = await evaluateAssignmentRule(userGroupId, boardId, undefined, undefined, ticket.projectId);
        if (assignmentResult.assignedUserId) {
          const updatedTicket = await this.prisma.ticket.update({
            where: { id: ticket.id },
            data: { assignedTo: assignmentResult.assignedUserId }
          });

          await syncConversationTicketMdFromPrismaTicket(this.prisma, updatedTicket);

          try {
            await syncUserWorkload(assignmentResult.assignedUserId, userGroupId, boardId, userId);
            logger.info(`[EmailService] Synced workload for user ${assignmentResult.assignedUserId}`);
          } catch (workloadError) {
            logger.error('[EmailService] Error syncing workload:', workloadError);
            }
          }
        }
      } catch (error) {
        logger.error('[EmailService] Auto-assignment failed:', error);
      }
    }

    // Step 3: Create message with ticket
    const messageData: CreateMessageInput = {
      conversationId: conversation.conversationId,
      senderId: userId,
      content: '',
      hasAttachment: true,
      metadata: {
        ticketId: ticket.id,
      },
    };

    const message = await this.messageRepository.create(messageData, true);

    // Update conversation with real initial message ID
    await this.conversationRepository.update(conversation.conversationId, {
      initialMessageId: message.messageId,
      ticketId: ticket.id
    });
    await messageMetadataService.syncInitialMessageMd(conversation.conversationId);

    //Update channel last activity
    await this.channelRepository.updateLastActivity(channelId);

    return {
      conversation,
      message,
      ticket,
      channel,
    };
  }

  /**
   * Records the timestamp of the first outbound agent reply on a ticket.
   *
   * Sets `firstRespondedAt` on every ticket linked to `conversationId` where
   * it is not yet set. The write is idempotent — subsequent replies are no-ops.
   *
   * This method is intentionally independent of any caller transaction: an SLA
   * tracking failure must never roll back or block the reply that triggered it.
   * Errors are logged at ERROR level and swallowed.
   */
  async recordFirstResponse(conversationId: string, respondedAt: Date): Promise<void> {
    try {
      await this.prisma.ticket.updateMany({
        where: { conversationId, firstRespondedAt: null },
        data: { firstRespondedAt: respondedAt },
      });
    } catch (err) {
      logger.error('[EmailService.recordFirstResponse] Failed to record first response time', {
        conversationId,
        respondedAt,
        err,
      });
    }
  }

  /**
   * Send a mail-provider (Microsoft/Google) reply on a conversation and
   * persist the Email + ExternalMessage rows. Used by the call-invitation
   * flow; pass `tx` to roll back on provider failures. Zoho replies go
   * through the controller's own path.
   */
  async sendReplyOnConversation(
    params: {
      conversationId: string;
      body: string;
      type: 'REPLY' | 'REPLY_ALL';
      to?: string[];
      cc?: string[];
      bcc?: string[];
      fileAttachments?: Array<{ name: string; contentType: string; content: Buffer | string }>;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<{
    emailId: string;
    threadId: string;
    externalMessageId: string;
    externalSourceType: string;
  }> {
    const client = tx ?? this.prisma;

    const conversation = await this.conversationRepository.findById(params.conversationId);
    if (!conversation) throw new Error(`Conversation not found: ${params.conversationId}`);
    const externalSource = await new ExternalSourceRepository().findByChannelId(conversation.channelId);
    if (!externalSource) throw new Error(`No external source for channel ${conversation.channelId}`);
    const emails = await this.emailRepository.findByConversationId(params.conversationId);
    if (emails.length === 0) throw new Error(`No emails in conversation ${params.conversationId}`);
    const initialEmail = emails[emails.length - 1];
    const latestEmail = emails[0];

    const preference = await this.emailChannelPreferenceRepository.findByChannelId(conversation.channelId);
    if (!preference?.ownerUserId) {
      throw new Error(`Desk owner not configured for channel ${conversation.channelId}. Set ownerUserId in EmailChannelPreference.`);
    }
    const owner = await this.userRepository.findById(preference.ownerUserId);
    if (!owner?.email) {
      throw new Error(`Desk owner user ${preference.ownerUserId} not found or has no email.`);
    }
    const fromEmailAddress = preference.sendAsEmail || owner.email;

    const to = params.to?.length
      ? params.to
      : params.type === 'REPLY'
        ? [initialEmail.replyTo?.[0] ?? initialEmail.from]
        : [...new Set([initialEmail.replyTo?.[0] ?? initialEmail.from, ...initialEmail.to])];
    const cc = params.cc ?? (params.type === 'REPLY_ALL' && !params.to ? (initialEmail.cc || []) : []);
    const bcc = params.bcc ?? [];

    const adapter = adapterRegistry.getAdapter(externalSource.name);
    if (!adapter.sendMailReply) {
      throw new Error(`Adapter "${adapter.name}" does not support mail reply`);
    }

    logger.info(
      `[emailService.sendReplyOnConversation] ${params.type} via ${externalSource.sourceType} conv=${params.conversationId}`,
    );
    const sent = await adapter.sendMailReply({
      encryptedCredentials: externalSource.credentials,
      sourceId: externalSource.id,
      body: params.body,
      subject: initialEmail.subject,
      to, cc, bcc,
      initialExternalThreadId: initialEmail.externalThreadId,
      latestExternalThreadId: latestEmail.externalThreadId,
      latestExternalMessageId: latestEmail.externalMessageId,
      fromEmailAddress,
      ...(params.fileAttachments && { fileAttachments: params.fileAttachments }),
    });

    const externalMessageId = sent.messageId || sent.threadId;
    const email = await client.email.create({
      data: {
        type: params.type === 'REPLY' ? EmailType.REPLY : EmailType.REPLY_ALL,
        subject: `Re: ${initialEmail.subject}`,
        body: params.body,
        to,
        from: fromEmailAddress,
        cc,
        bcc,
        conversationId: params.conversationId,
        channelId: conversation.channelId,
        externalThreadId: sent.threadId,
        externalMessageId,
      } as Prisma.EmailUncheckedCreateInput,
    });
    await syncTicketEmailCount(client, params.conversationId);

    try {
      await client.externalMessage.create({
        data: {
          externalSourceId: externalSource.id,
          externalId: externalMessageId,
          externalThreadId: initialEmail.externalThreadId,
          messageId: email.id,
          entityId: email.id,
          direction: MessageDirection.OUTGOING,
          entityType: ExternalEntityType.EMAIL,
        },
      });
    } catch (err) {
      // P2002 = webhook raced us with the inbound copy of this same message.
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
    }

    // Record the first response time for SLA tracking. Uses the email's own
    // createdAt so the timestamp is consistent with what is persisted in the DB.
    // Called after the transaction so a tracking failure never rolls back the reply.
    await this.recordFirstResponse(params.conversationId, email.createdAt);

    return {
      emailId: email.id,
      threadId: sent.threadId,
      externalMessageId,
      externalSourceType: externalSource.sourceType,
    };
  }

  async ingestEmailThread(params: IngestEmailThreadParams): Promise<IngestEmailThreadResult> {
    const {
      channelId,
      externalThreadId,
      externalSourceId,
      userId,
      ticketMetadata,
      sourceName,
    } = params;

    if (params.emails.length === 0) {
      return { conversationId: '', inserted: 0, duplicates: 0, isNew: false };
    }

    const emails = [...params.emails].sort((a, b) => {
      const at = a.receivedAt?.getTime() ?? 0;
      const bt = b.receivedAt?.getTime() ?? 0;
      return at - bt;
    });

    const firstEmail = emails[0]!;
    const channel = await this.channelRepository.findById(channelId);
    if (!channel) throw new Error(`Channel not found: ${channelId}`);
    if (channel.type !== ChannelType.EMAIL) {
      throw new Error(
        `[EmailService] refusing to ingest into non-EMAIL channel ${channelId} (type=${channel.type})`,
      );
    }

    const projectId = channel.projectId;
    if (sourceName) {
      try {
        const ctx = createBlockingContext({
          sourceName,
          email: firstEmail.from,
          emailSubject: firstEmail.subject,
        });
        if (
          superpositionClient.isReady() &&
          (await superpositionClient.getBooleanValue('blocked', false, ctx))
        ) {
          return { conversationId: '', inserted: 0, duplicates: 0, isNew: false, blocked: true };
        }
      } catch (error) {
        logger.error('[EmailService] Superposition check failed, proceeding', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const existingFirstEmail = await this.emailRepository.findFirstByThreadAndChannel(
      externalThreadId,
      channelId,
    );

    // Cross-thread duplicate check: same subject + sender in same channel.
    // Gated by per-inbox setting — only runs when auto-merge is enabled for this channel.
    let vespaMatchConversationId: string | null = null;
    let preference: Awaited<
      ReturnType<typeof this.emailChannelPreferenceRepository.findByChannelId>
    > = null;
    if (!existingFirstEmail) {
      preference = await this.emailChannelPreferenceRepository.findByChannelId(channelId);
      if (preference?.emailMergeMode === EmailMergeMode.ENABLED) {
        const duplicateCheck = await findDuplicateEmailConversation(
          channelId,
          firstEmail.from,
          firstEmail.subject,
        );
        if (duplicateCheck.isDuplicate && duplicateCheck.match) {
          vespaMatchConversationId = duplicateCheck.match.conversationId;
          logger.info('[EmailService] ingestEmailThread: Vespa duplicate found, merging into existing conversation', {
            conversationId: vespaMatchConversationId,
            subject: firstEmail.subject,
            from: firstEmail.from,
          });
        }
      }
    }

    let boardId: string | undefined;
    let groupId: string | null = null;
    if (!existingFirstEmail) {
      const externalSource = await this.prisma.externalSource.findUnique({
        where: { id: externalSourceId },
        select: { boardId: true },
      });
      boardId =
        preference?.boardId ?? externalSource?.boardId ?? undefined;
      if (!boardId) {
        const firstBoard = await this.prisma.board.findFirst({
          where: { projectId },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        });
        boardId = firstBoard?.id;
      }
      if (!boardId) {
        throw new Error(
          `[EmailService] No board configured for channel ${channelId} (project ${projectId})`,
        );
      }
      groupId = preference?.assigneeUserGroupId ?? null;
    }

    // Pre-compute SLA due dates before the transaction using the first email's
    // priority (derived from subject) and its receivedAt timestamp.
    const ingestTicketPriority = derivePriorityFromSubject(firstEmail.subject ?? '');
    const ingestSlaResolutionDue = existingFirstEmail
      ? null
      : await this.getSlaResolutionDue(
          boardId,
          ingestTicketPriority,
          firstEmail.receivedAt ?? new Date(),
        );

    const emailRowIds = emails.map(() => uuidv4());
    const emailRows = emails.map((e, i) => ({
      id: emailRowIds[i]!,
      type: e.type ?? EmailType.DEFAULT,
      subject: e.subject,
      body: e.body,
      to: e.to,
      from: e.from,
      cc: e.cc ?? [],
      bcc: e.bcc ?? [],
      replyTo: e.replyTo ?? [],
      channelId,
      externalThreadId,
      externalMessageId: e.externalMessageId,
      ...(e.receivedAt && { createdAt: e.receivedAt }),
    }));

    let txResult: ThreadTxResult;
    try {
      txResult = await this.prisma.$transaction(async tx => {
        let conversationId: string;
        let ticketId: string | undefined;
        let ticketXyneId: string | undefined;
        let isNew: boolean;
        let existingTicketLastEmailAt: Date | null = null;
        let previousLatestEmailId: string | null = null;

        const createNewConversation = async () => {
          const stages = await tx.stage.findMany({
            where: { boardId: boardId! },
            orderBy: { sequenceNumber: 'asc' },
          });
          if (stages.length === 0) {
            throw new Error(`No stages found for board ${boardId}`);
          }
          const firstStage = stages[0]!;

          const conv = await tx.conversation.create({
            data: {
              channelId,
              createdBy: userId,
              initialMessageId: 'temp',
              ...(firstEmail.receivedAt && {
                createdAt: firstEmail.receivedAt,
                lastActivityAt: firstEmail.receivedAt,
              }),
            },
          });

          const xyneId = await TicketIdService.generateTicketId(tx, projectId);
          const ticketTitle =
            (firstEmail.subject ?? '').replace(/^(\s*(re|fwd|fw)\s*:\s*)+/i, '').trim() ||
            firstEmail.subject;
          const createdTicket = await tx.ticket.create({
            data: {
              title: ticketTitle,
              description: firstEmail.body,
              createdBy: userId,
              updatedBy: userId,
              conversationId: conv.conversationId,
              channelId,
              workspaceId: channel.workspaceId,
              xyneId,
              projectId,
              boardId: boardId!,
              lastEmailAt: firstEmail.receivedAt ?? new Date(),
              stageName: firstStage.name,
              ticketType: BaseTicketType.DESK,
              ...(ingestSlaResolutionDue && { eta: ingestSlaResolutionDue }),
              ...(groupId && { userGroupId: groupId }),
              ...(ticketMetadata && { metadata: ticketMetadata as Prisma.InputJsonValue }),
              ...(firstEmail.receivedAt && { createdAt: firstEmail.receivedAt }),
            },
          });
          await syncConversationTicketMdFromPrismaTicket(tx, createdTicket);

          // Seed the conversation's initial message inside the same tx so we
          // never leave a `'temp'` sentinel in `Conversation.initialMessageId`
          // pointing at no real Message row. Doing this post-tx (the previous
          // shape) meant any failure between tx commit and the seeding update
          // stranded the conversation forever; the catch-and-log there was a
          // permanent data-rot vector, not a transient blip.
          const initialMessage = await tx.message.create({
            data: {
              conversationId: conv.conversationId,
              senderId: userId,
              content: '',
              hasAttachment: true,
              metadata: { ticketId: createdTicket.id },
            },
          });
          await tx.conversation.update({
            where: { conversationId: conv.conversationId },
            data: {
              initialMessageId: initialMessage.messageId,
              ticketId: createdTicket.id,
            },
          });

          return {
            conversationId: conv.conversationId,
            ticketId: createdTicket.id,
            ticketXyneId: createdTicket.xyneId,
          };
        };

        if (existingFirstEmail) {
          conversationId = existingFirstEmail.conversationId;
          isNew = false;
          const ticketRow = await tx.ticket.findFirst({
            where: { conversationId },
            select: { id: true, xyneId: true },
          });
          ticketId = ticketRow?.id;
          ticketXyneId = ticketRow?.xyneId;
        } else if (vespaMatchConversationId) {
          let shouldCreateConversation = false;
          conversationId = vespaMatchConversationId;
          isNew = false;
          const existingConversation = await tx.conversation.findUnique({
            where: { conversationId },
            select: { conversationId: true },
          });
          if (!existingConversation) {
            logger.warn('[EmailService] ingestEmailThread: stale Vespa duplicate ignored, creating new conversation', {
              conversationId,
              channelId,
              externalThreadId,
              subject: firstEmail.subject,
              from: firstEmail.from,
            });
            shouldCreateConversation = true;
            vespaMatchConversationId = null;
          } else {
            const ticketRow = await tx.ticket.findFirst({
              where: { conversationId },
              select: { id: true, xyneId: true, lastEmailAt: true },
            });
            ticketId = ticketRow?.id;
            ticketXyneId = ticketRow?.xyneId;
            existingTicketLastEmailAt = ticketRow?.lastEmailAt ?? null;
            const previousLatest = await tx.email.findFirst({
              where: { conversationId },
              orderBy: { createdAt: 'desc' },
              select: { id: true },
            });
            previousLatestEmailId = previousLatest?.id ?? null;
          }

          if (shouldCreateConversation) {
            const created = await createNewConversation();
            conversationId = created.conversationId;
            ticketId = created.ticketId;
            ticketXyneId = created.ticketXyneId;
            isNew = true;
          }
        } else {
          const created = await createNewConversation();
          conversationId = created.conversationId;
          ticketId = created.ticketId;
          ticketXyneId = created.ticketXyneId;
          isNew = true;
        }

        const emailInsert = await tx.email.createMany({
          data: emailRows.map(row => ({ ...row, conversationId })),
          skipDuplicates: true,
        });
        await syncTicketEmailCount(tx, conversationId);

        await tx.externalMessage.createMany({
          data: emailRows.map(row => ({
            externalSourceId,
            externalId: row.externalMessageId,
            externalThreadId,
            entityType: ExternalEntityType.EMAIL,
            entityId: row.id,
            messageId: row.id,
            direction: MessageDirection.INCOMING,
          })),
          skipDuplicates: true,
        });

        const latestReceived = emails.reduce<Date | null>((acc, e) => {
          if (!e.receivedAt) return acc;
          return acc && acc > e.receivedAt ? acc : e.receivedAt;
        }, null);
        if (ticketId && latestReceived) {
          if (!vespaMatchConversationId || !existingTicketLastEmailAt || latestReceived > existingTicketLastEmailAt) {
            await tx.ticket.update({
              where: { id: ticketId },
              data: { lastEmailAt: latestReceived },
            });
          }
        }

        if (emailInsert.count > 0 && vespaMatchConversationId && previousLatestEmailId && ticketId) {
          const caughtUpUsers = await tx.emailRead.findMany({
            where: { ticketId, lastReadEmailId: previousLatestEmailId },
            select: { userId: true },
          });
          if (caughtUpUsers.length > 0) {
            await tx.channelUserStatus.updateMany({
              where: { channelId, userId: { in: caughtUpUsers.map(r => r.userId) }, isDeleted: false },
              data: { unreadCount: { increment: 1 }, updatedAt: new Date() },
            });
          }
        }

        return {
          conversationId,
          ticketId,
          ticketXyneId,
          inserted: emailInsert.count,
          duplicates: emails.length - emailInsert.count,
          isNew,
          wasVespaMerge: !!(vespaMatchConversationId && previousLatestEmailId && ticketId),
        };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        logger.warn('[EmailService] ingestEmailThread hit unique conflict, treating as duplicate', {
          channelId,
          externalThreadId,
        });
        return {
          conversationId: existingFirstEmail?.conversationId ?? '',
          inserted: 0,
          duplicates: emails.length,
          isNew: false,
        };
      }
      throw error;
    }

    const insertedEmails = emailRows.map((row, i) => ({
      id: row.id,
      body: emails[i]!.body,
      externalMessageId: row.externalMessageId,
      uploadedFiles: emails[i]!.uploadedFiles ?? [],
    }));

    // Initial message + conversation pointer are now seeded inside the
    // transaction above. Only the metadata md sync (which reads committed
    // rows for its query) runs here; if it fails the data is still
    // consistent — only the cached md field is stale, recoverable on next
    // write to the conversation.
    if (txResult.isNew && txResult.ticketId) {
      try {
        await messageMetadataService.syncInitialMessageMd(txResult.conversationId);
      } catch (error) {
        logger.warn('[EmailService] failed to sync initial message md', error);
      }
    }

    for (const e of insertedEmails) {
      void dispatchEmailEventForEmailId(e.id);
    }

    for (const e of insertedEmails) {
      this.pushVespaJobForMail(e.id, userId, channel.workspaceId).catch(error => {
        logger.error(`[EmailService] Vespa job push failed for mail ${e.id}:`, error);
      });
    }
    if (txResult.isNew && txResult.ticketId) {
      this.pushVespaJobForTicket(txResult.ticketId, userId, channel.workspaceId).catch(error => {
        logger.error(
          `[EmailService] Vespa job push failed for ticket ${txResult.ticketId}:`,
          error,
        );
      });

      // Enqueue AI classification as a Redis worker job
      await emailClassificationQueue.getQueue().add('classify', {
        ticketId: txResult.ticketId,
        channelId,
        subject: firstEmail.subject ?? '',
        body: firstEmail.body ?? '',
        groupId: groupId ?? null,
      }).catch((err: unknown) => {
        logger.error(`[Classification] Failed to enqueue classification job for ticket ${txResult.ticketId}`, err);
      });
    }

    for (const e of insertedEmails) {
      if (e.uploadedFiles.length > 0) {
        try {
          await this.createEmailAttachments(
            e.id,
            txResult.conversationId,
            userId,
            channel.workspaceId,
            e.uploadedFiles,
          );
        } catch (error) {
          logger.warn(
            `[EmailService] createEmailAttachments failed for email ${e.id}`,
            error,
          );
        }
      }
    }


    return {
      conversationId: txResult.conversationId,
      ticketId: txResult.ticketId,
      ticketXyneId: txResult.ticketXyneId,
      inserted: txResult.inserted,
      duplicates: txResult.duplicates,
      isNew: txResult.isNew,
      wasVespaMerge: txResult.wasVespaMerge,
    };
  }
}

// Export singleton instance
export const emailService = new EmailService();
