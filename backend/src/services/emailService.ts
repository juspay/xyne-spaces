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
import { DatabaseClient } from '@/database/client';
import {
  MessageType,
  EmailType,
  ChannelType,
  Prisma,
  AttachmentEntityType,
  VespaOperationType,
  VespaInsertionStatus,
} from '@prisma/client';
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

interface UserInfo {
  id: string;
  name: string;
  email: string;
  picture?: string;
}

export interface CreateConversationWithEmailParams {
  channelId: string;
  boardId?: string; // Target board for ticket creation (from ExternalSource)
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
  private prisma: PrismaClient;

  constructor() {
    this.conversationRepository = new ConversationRepository();
    this.messageRepository = new MessageRepository();
    this.emailRepository = new EmailRepository();
    this.messageAttachmentRepository = new MessageAttachmentRepository();
    this.channelRepository = new ChannelRepository();
    this.userRepository = new UserRepository();
    this.boardRepository = new BoardRepository();
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
   * Private utility function to create attachment entries for email
   */
  private async createEmailAttachments(
    emailId: string,
    conversationId: string,
    userId: string,
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

    // boardId MUST be configured in ExternalSource - no fallback allowed
    if (!passedBoardId) {
      logger.error(`[EmailService] ExternalSource missing boardId configuration for channel: ${channelId}`);
      throw new Error(`ExternalSource must have a boardId configured. Channel: ${channelId}. Please configure boardId in external_sources table.`);
    }

    // Validate that the passed boardId exists
    const configuredBoard = await this.boardRepository.findById(passedBoardId);
    if (!configuredBoard) {
      logger.error(`[EmailService] Configured boardId ${passedBoardId} not found in database`);
      throw new Error(`Configured boardId ${passedBoardId} not found in database. Please verify external_sources.boardId points to a valid board.`);
    }

    // Validate that the board belongs to the same project as the channel
    if (configuredBoard.projectId !== projectId) {
      logger.error(`[EmailService] Board project mismatch: boardId ${passedBoardId} belongs to project ${configuredBoard.projectId}, but channel belongs to project ${projectId}`);
      throw new Error(`Configured boardId ${passedBoardId} belongs to different project (${configuredBoard.projectId} vs ${projectId}). External source, channel, and board must all be in the same project.`);
    }

    const boardId = passedBoardId;
    logger.info(`[EmailService] Using configured boardId ${boardId} from ExternalSource`);

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
    const groupId = "cmk4j0ffq003n5ky5ctwjb561"; // Merchant Support Group Id
    const userGroup = await this.prisma.userGroup.findUnique({
      where: { id: groupId },
      select: { id: true },
    });

    // Step 1: Create conversation
    const conversationData: CreateConversationInput = {
      channelId,
      createdBy: userId,
      initialMessageId: 'temp', // Will be updated after message creation
    };

    const conversation = await this.conversationRepository.create(conversationData);

    // Step 2: Create ticket and generate xyneId in a transaction
    const ticket = await this.prisma.$transaction(async (tx) => {
      // Generate xyneId using project-scoped format
      const xyneId = await TicketIdService.generateTicketId(tx, projectId);

      // Create ticket using transaction client
      const createdTicket = await tx.ticket.create({
        data: {
          title: emailSubject,
          description: emailBody,
          createdBy: userId,
          updatedBy: userId,
          conversationId: conversation.conversationId,
          channelId: channelId,
          xyneId: xyneId,
          projectId: projectId,
          boardId: boardId,
          stageName: firstStage.name,
          ...(userGroup && { userGroupId: groupId }),
          ...(ticketMetadata && { metadata: ticketMetadata as Prisma.InputJsonValue }),
        }
      });

      await syncConversationTicketMdFromPrismaTicket(tx, createdTicket);
      return createdTicket;
    });

    this.pushVespaJobForTicket(ticket.id, userId).catch(error => {
      logger.error(`[EmailService] Error pushing Vespa job for ticket ${ticket.id}:`, error);
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
            // Don't fail the assignment if workload sync fails
            }
          }
        }
      } catch (error) {
        logger.error('[EmailService] Auto-assignment failed:', error);
      }
    }

    // Start workflow (controlled by config)
    let workflowResult: { workflowId: string; executionId: string; status: string } | null = null;
    if (config.zoho.autoWorkflowEnabled) {
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

    // Step 3: Create BOT message with ticket (always created first)
    const messageData: CreateMessageInput = {
      conversationId: conversation.conversationId,
      senderId: userId,
      content: '',
      msgType: MessageType.BOT,
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

    //Create SYSTEM message for WorkflowBubble (only when workflow is enabled, AFTER ticket message)
    if (config.zoho.autoWorkflowEnabled) {
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

    // Create email entry with type DEFAULT
    const emailData = {
      type: EmailType.DEFAULT,
      subject: emailSubject,
      body: emailBody,
      to: emailTo,
      from: emailFrom,
      cc: emailCc,
      bcc: emailBcc,
      conversationId: conversation.conversationId,
      externalThreadId: externalThreadId,
      externalMessageId: externalMessageId,
    };

    const email = await this.emailRepository.create(emailData);

    // Create MessageAttachment entries for email attachments
    await this.createEmailAttachments(email.id, conversation.conversationId, userId, uploadedFiles);

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
        externalThreadId: externalThreadId,
        externalMessageId: externalMessageId,
      };

      const email = await this.emailRepository.create(emailData);

      // Create MessageAttachment entries for email attachments
      await this.createEmailAttachments(email.id, conversation.conversationId, conversation.createdBy, uploadedFiles);

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
          boardId: boardId,
          stageName: stageName,
          ...(userGroupId && { userGroupId }),
        }
      });
    });

    this.pushVespaJobForTicket(ticket.id, userId).catch(error => {
      logger.error(`[EmailService] Error pushing Vespa job for ticket ${ticket.id}:`, error);
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

    // Step 3: Create BOT message with ticket
    const messageData: CreateMessageInput = {
      conversationId: conversation.conversationId,
      senderId: userId,
      content: '',
      msgType: MessageType.BOT,
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
}

// Export singleton instance
export const emailService = new EmailService();
