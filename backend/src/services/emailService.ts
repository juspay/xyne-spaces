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
} from '@prisma/client';
import { ExternalSourceRepository } from '@/database/repositories/externalSourceRepository';
import { adapterRegistry } from '@/integrations/core/adapterRegistry';
import { websocketService } from './websocketService';
import { redisService } from './redisService';
import { isRegisteredBot, getBotInfo } from '@/bots/core/bot-utils';
import { PrismaClient } from '@prisma/client';
import { evaluateAssignmentRule } from '@/utils/assignmentEngine';
import { syncUserWorkload } from '@/utils/workloadUtils';
import { ticketAssignmentService } from '@/services/ticketAssignmentService';
import type { BoardMetadata } from '@xyne/shared';
import { UploadedFileResult } from './fileUploadService';
import { config } from '@/config/env';
import { workflowManager, WorkflowType } from '@/workflows';
import { superpositionClient } from './superpositionClient';
import { createBlockingContext } from '@/utils/superpositionUtils';
import { vespaQueue } from '@/queues/vespaQueue';
import { ticketSchema } from '@/vespa/src/types';
import { logger } from '@/utils/logger';
import { messageMetadataService } from '@/services/messageMetadataService';
import { db } from '@/database/client';
import { NAMESPACE } from '@/vespa/vespaConfig';
import { processMeetLinksFromEmail } from './meetLinkService';
import { repositories } from '@/database/repositories';
import { TicketIdService } from './ticketIdService';
import { syncConversationTicketMdFromPrismaTicket } from '@/utils/ticketMd';
import { generateDescription } from './agents/description-generator';

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
  private async pushVespaJobForTicket(
    ticketId: string,
    userId: string
  ): Promise<void> {
    vespaQueue.addJob({
      schema: ticketSchema,
      jobType: "feed",
      docId: ticketId,
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
          conversationId: conv.conversationId,
          channelId,
          externalThreadId,
          externalMessageId,
          ...(receivedAt && { createdAt: receivedAt }),
        } as Prisma.EmailUncheckedCreateInput,
      });

      // Generate xyneId and create ticket
      const xyneId = await TicketIdService.generateTicketId(tx, projectId);
      const ticketTitle =
        (emailSubject ?? '').replace(/^(\s*(re|fwd|fw)\s*:\s*)+/i, '').trim() || emailSubject;
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
          lastEmailAt: receivedAt ?? new Date(),
          stageName: firstStage.name,
          ...(userGroup && { userGroupId: groupId }),
          ...(ticketMetadata && { metadata: ticketMetadata as Prisma.InputJsonValue }),
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

    this.pushVespaJobForTicket(ticket.id, userId).catch(error => {
      logger.error(`[EmailService] Error pushing Vespa job for ticket ${ticket.id}:`, error);
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
          });
          if (fullRoles.member) {
            const updatedTicket = await this.prisma.ticket.update({
              where: { id: ticket.id },
              data: { assignedTo: fullRoles.member },
            });
            await syncConversationTicketMdFromPrismaTicket(this.prisma, updatedTicket);
          }
        } else {
        const assignmentResult = await evaluateAssignmentRule(groupId, boardId);
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
        conversationId: conversationId,
        channelId: conversation.channelId,
        externalThreadId: externalThreadId,
        externalMessageId: externalMessageId,
        ...(receivedAt && { createdAt: receivedAt }),
      };

      const email = await this.emailRepository.create(emailData);
      const ticketRow = await this.prisma.ticket.findFirst({
        where: { conversationId },
        select: { id: true },
      });

      if (ticketRow) {
        await this.prisma.ticket.update({
          where: { id: ticketRow.id },
          data: { lastEmailAt: new Date() },
        });

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

      // Create MessageAttachment entries for email attachments
      await this.createEmailAttachments(email.id, conversation.conversationId, conversation.createdBy, channel?.workspaceId ?? '', uploadedFiles);

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

    // Step 2: Create ticket in a transaction
    const ticket = await this.prisma.$transaction(async (tx) => {
      // Generate xyneId using project-scoped format
      const xyneId = await TicketIdService.generateTicketId(tx, projectId);

      // Create ticket using transaction client
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
          ...(userGroupId && { userGroupId }),
          lastEmailAt: new Date(),
        }
      });
    });

    this.pushVespaJobForTicket(ticket.id, userId).catch(error => {
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
          });
          if (fullRoles.member) {
            const updatedTicket = await this.prisma.ticket.update({
              where: { id: ticket.id },
              data: { assignedTo: fullRoles.member },
            });
            await syncConversationTicketMdFromPrismaTicket(this.prisma, updatedTicket);
          }
        } else {
        const assignmentResult = await evaluateAssignmentRule(userGroupId, boardId);
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
    const fromEmailAddress = owner.email;

    const to = params.to?.length
      ? params.to
      : params.type === 'REPLY'
        ? [initialEmail.from]
        : [...new Set([initialEmail.from, ...initialEmail.to])];
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

    return {
      emailId: email.id,
      threadId: sent.threadId,
      externalMessageId,
      externalSourceType: externalSource.sourceType,
    };
  }
}

// Export singleton instance
export const emailService = new EmailService();
