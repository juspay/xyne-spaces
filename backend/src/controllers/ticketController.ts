import { Request, Response } from 'express';
import { Ticket, TicketStatusV2, TicketPriority, AttachmentEntityType, MessageAttachment, ChannelType, ActivityType, TicketReferenceRelation } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { TicketRepository } from '../database/repositories/ticketRepository';
import { ConversationRepository } from '../database/repositories/conversationRepository';
import { BoardRepository } from '../database/repositories/boardRepository';
import { ChannelRepository } from '../database/repositories/channelRepository';
import { ChannelParticipantRepository } from '../database/repositories/channelParticipantRepository';
import { MessageRepository } from '../database/repositories/messageRepository';
import { MessageAttachmentRepository, CreateMessageAttachmentInput } from '../database/repositories/messageAttachmentRepository';
import {
  CreateTicketRequest,
  GetTicketDetailsResponse,
  TicketDuplicateCheckRequest,
  TicketDuplicateCheckResponse,
  TicketBoardSuggestionRequest,
  TicketBoardCandidate,
  TicketBoardAnalysis,
  TicketBoardSuggestionResponse,
} from '../types/ticket';
import { evaluateAssignmentRule } from '../utils/assignmentEngine';
import { syncUserWorkload } from '../utils/workloadUtils';
import { ticketAssignmentService, type RoleAssignment } from '../services/ticketAssignmentService';
import type { BoardMetadata } from '@xyne/shared';
import { syncConversationTicketMdFromPrismaTicket } from '../utils/ticketMd';
import { TicketAssignmentsSideEffectHandler } from '@/zero/side-effects/tables/ticket-assignments-handler';
import { TicketsSideEffectHandler } from '@/zero/side-effects/tables/tickets-handler';
import { uploadFiles, UploadedFileResult } from '../services/fileUploadService';
import { config } from '../config/env';
import { superpositionClient } from '@/services/superpositionClient';
import { randomUUID } from 'crypto';
import { vespaQueue } from '@/queues/vespaQueue';
import { ticketSchema, fileSchema, SubApp } from '@/vespa/src/types';
import { isSupportedMimeType } from '@/services/fileProcessor';
import { logger } from '@/utils/logger';
import { messageMetadataService } from '@/services/messageMetadataService';
import { db } from '@/database/client';
import { NAMESPACE } from '@/vespa/vespaConfig';
import { DatabaseClient } from '@/database/client';
import { ticketDuplicateService } from '@/services/ticketDuplicateService';
import { ticketBoardService } from '@/services/ticketBoardService';
import { BaseTicketType, FormContextType, FormEntityType, serializeTicketMd } from '@xyne/shared';
import type { TicketCardSummary } from '@xyne/shared';
import { CommitAnalysisController } from './commitAnalysisController';
import { isReleaseTicket } from '@xyne/shared';

import { z } from 'zod';

const AddAttachmentsFromConversationBodySchema = z.object({
  sourceConversationId: z.string().min(1, 'sourceConversationId is required'),
  sourceMessageId: z.string().min(1).optional(),
});
import { userActivityTrackingService } from '@/services/userActivityTrackingService';
import { TicketIdService } from '@/services/ticketIdService';
import { unifiedBotUserService } from '@/bots/unified';
import { workflowManager } from '@/workflows/services/workflowManager';
import { WorkflowType } from '@/workflows/types/workflow-enums';
import { ticketService } from '@/services/ticketService';


const prisma = DatabaseClient.getInstance();

export class TicketController {
  private ticketRepository: TicketRepository;
  private conversationRepository: ConversationRepository;
  private boardRepository: BoardRepository;
  private channelRepository: ChannelRepository;
  private channelParticipantRepository: ChannelParticipantRepository;
  private messageRepository: MessageRepository;
  private messageAttachmentRepository: MessageAttachmentRepository;
  private commitAnalysisController: CommitAnalysisController | null = null;

  constructor() {
    this.ticketRepository = new TicketRepository();
    this.conversationRepository = new ConversationRepository();
    this.boardRepository = new BoardRepository();
    this.channelRepository = new ChannelRepository();
    this.channelParticipantRepository = new ChannelParticipantRepository();
    this.messageRepository = new MessageRepository();
    this.messageAttachmentRepository = new MessageAttachmentRepository();

    const bitbucketConfig = config.bitbucket;
    const hasToken = Boolean(bitbucketConfig.apiToken);
    const hasBasicAuth = Boolean(bitbucketConfig.apiUsername) && Boolean(bitbucketConfig.password);
    if (hasToken || hasBasicAuth) {
      this.commitAnalysisController = new CommitAnalysisController();
    }
  }

  private async pushVespaJobForAttachments(
    attachments: Array<{ id: string; mimetype: string }>,
    userId: string,
    workspaceId?: string
  ): Promise<void> {
    if (attachments.length === 0) return;

    // Filter only supported MIME types (PDF, DOCX, TXT, MD, etc.)
    const supportedAttachments = attachments.filter(att => isSupportedMimeType(att.mimetype));

    for (const attachment of supportedAttachments) {
      vespaQueue.addJob({
        schema: fileSchema,
        jobType: "feed",
        docId: attachment.id,
        app: SubApp.TICKET_ATTACHMENT,
        ...(workspaceId ? { workspaceId } : {}),
      }).catch(async (error) => {
        logger.error(`[TicketController] Error queuing Vespa job for attachment ${attachment.id}:`, error);
        // Log failed insertion to Postgres
        try {
          if (db.vespaInsertionLogs) {
            await db.vespaInsertionLogs.create({
              data: {
                status: "FAILED",
                type: "INSERT",
                entityId: attachment.id,
                entityType: fileSchema,
                namespace: NAMESPACE,
                errorMessage: `Failed to enqueue Vespa job: ${error instanceof Error ? error.message : String(error)}`,
                errorDetails: JSON.stringify(error),
                userId: userId,
                createdAt: new Date(),
              },
            });
          }
        } catch (dbError) {
          logger.error('Failed to log Vespa insertion error to database:', dbError);
        }
      });
    }
  }

  /**
   * Shared method to create a ticket with conversation context
   * Used by both HTTP API and transcription agent tool
   */
  async createTicketWithConversation(params: {
    title: string;
    description: string;
    createdBy: string;
    updatedBy: string;
    conversationId: string;
    projectId: string;
    boardId: string;
    assignedTo?: string;
    priority?: string;
    statusV2?: string;
    metadata?: Record<string, any>;
    messageContent?: string;
    messageSubtype?: string;
  }): Promise<Ticket> {
    const {
      title,
      description,
      createdBy,
      updatedBy,
      conversationId,
      projectId,
      boardId,
      assignedTo,
      priority = 'MEDIUM',
      statusV2 = 'TODO',
      metadata = {},
      messageContent,
      messageSubtype = 'ai_ticket',
    } = params;

    const db = DatabaseClient.getInstance();

    const ticket = await prisma.$transaction(async (tx) => {
      // Get channelId from conversation
      const conversation = await this.conversationRepository.findById(conversationId);
      if (!conversation) {
        throw new Error(`Conversation ${conversationId} not found`);
      }
      const channelId = conversation.channelId;

      // Get workspaceId from channel
      const channelWorkspaceId = await this.channelRepository.getWorkspaceId(channelId);

      // Generate xyneId using project-scoped format
      const xyneId = await TicketIdService.generateTicketId(tx, projectId);

      // Create ticket
      const ticket = await this.ticketRepository.createTicket({
        title,
        description,
        createdBy,
        updatedBy,
        assignedTo: assignedTo || undefined,
        conversationId,
        channelId,
        projectId,
        workspaceId: channelWorkspaceId,
        boardId,
        statusV2: statusV2 as TicketStatusV2,
        priority: priority.toUpperCase() as TicketPriority,
        xyneId,
      }, tx);

      // Post ticket notification as SYSTEM message in conversation
      const now = new Date();
      await db.message.create({
        data: {
          messageId: randomUUID(),
          conversationId,
          senderId: createdBy,
          content: messageContent || `Ticket created: ${title}`,
          msgType: 'SYSTEM',
          showInChannel: false,
          metadata: {
            messageSubtype,
            ticketId: ticket.id,
            xyneId: ticket.xyneId,
            isAiGenerated: true,
            ...metadata,
          },
        },
      });

      // Update conversation reply count and set ticketId
      await db.conversation.update({
        where: { conversationId },
        data: {
          replyCount: { increment: 1 },
          lastActivityAt: now,
          ticketId: ticket.id,
        },
      });

      // Update lastReplyAt on all participants (denormalized for userConversationsPaginatedV2)
      await db.conversationParticipant.updateMany({
        where: { conversationId },
        data: { lastReplyAt: now },
      });

      // Add/update ticket creator as MENTIONED participant (subscribed by default)
      await db.conversationParticipant.upsert({
        where: {
          conversationId_userId: {
            conversationId,
            userId: createdBy,
          },
        },
        create: {
          id: randomUUID(),
          conversationId,
          userId: createdBy,
          participationType: 'MENTIONED',
          isSubscribed: true,
          joinedAt: now,
          channelId,
        },
        update: {
          participationType: 'MENTIONED',
          isSubscribed: true,
        },
      });

      await this.channelRepository.updateLastActivity(channelId);

      return ticket;
    });

    ticketDuplicateService.persistDuplicateReferences({
      ticketId: ticket.id,
      ticketCreatedBy: ticket.createdBy,
      title,
      description,
      projectId,
      userId: createdBy,
    }).catch((error: Error) => {
      logger.error('Failed to persist duplicate references for ticket', {
        ticketId: ticket.id,
        error,
      });
    });

    return ticket;
  }

  createTicket = async (req: Request, res: Response): Promise<void> => {
    try {
      // If this is a support/error-report ticket, resolve channel+board from CAC
      if (req.headers['x-support-ticket'] === 'true') {
        const cacConfig = await superpositionClient.getObjectValue(
          'error_report_channel_config',
          null,
          {},
        ) as { channelId: string; boardId?: string } | null;

        if (!cacConfig?.channelId) {
          res.status(503).json({ error: 'Error reporting is not configured.' });
          return;
        }

        const channel = await this.channelRepository.findById(cacConfig.channelId);
        if (!channel?.projectId) {
          res.status(503).json({ error: 'Support channel not found or has no project mapping.' });
          return;
        }

        const SUPPORT_TAG = 'Support Ticket';
        const existingTags: string[] = Array.isArray(req.body.tags) ? req.body.tags : [];
        req.body.channelId = cacConfig.channelId;
        req.body.projectId = channel.projectId;
        if (cacConfig.boardId) {
          req.body.boardId = cacConfig.boardId;
        }
        req.body.tags = [
          SUPPORT_TAG,
          ...existingTags.filter(t => t.toLowerCase() !== SUPPORT_TAG.toLowerCase()),
        ];
      }

      // Handle both FormData (with files) and JSON requests
      const {
        title,
        description,
        assignedTo,
        projectId,
        userGroupId,
        statusV2,
        priority,
        eta,
        metadata,
        closedAt,
        closedBy,
        sourceConversationId,
        channelId,
        excludedChatAttachmentIds,
        draftAttachmentIds,
        tags,
        merchantId,
        parentTicketId,
        ticketType
      }: CreateTicketRequest & { parentTicketId?: string } = req.body;
      // Validate excludedChatAttachmentIds if provided
      if (excludedChatAttachmentIds && !Array.isArray(excludedChatAttachmentIds)) {
        res.status(400).json({ error: 'Invalid format for excludedChatAttachmentIds. Must be an array of strings.' });
        return;
      }

      // Validate draftAttachmentIds if provided
      if (draftAttachmentIds && !Array.isArray(draftAttachmentIds)) {
        res.status(400).json({ error: 'Invalid format for draftAttachmentIds. Must be an array of strings.' });
        return;
      }

      // Extract files from multer if present
      // uploadMultiple uses fields() so files are stored as { files: [...], thumbnails: [...] }
      const reqFiles = (req as Express.Request & { files?: { [fieldname: string]: Express.Multer.File[] } }).files || {};
      const files = reqFiles['files'] || [];

      // Parse file metadata if present (contains dimensions for images/videos)
      let fileMetadata: Array<{ fileIndex: number; hasThumbnail: boolean; thumbnailIndex?: number; width?: number; height?: number }> | undefined;
      if (req.body.fileMetadata) {
        try {
          fileMetadata = JSON.parse(req.body.fileMetadata);
        } catch {
          logger.warn('[Ticket Creation] Failed to parse fileMetadata');
        }
      }

      // Extract dynamic fields if present (support both string and string[] for MULTI_SELECT)
      const dynamicFields = (req.body.dynamicFields as Record<string, string | string[]>) || {};
      const requiredFields = { title, description, projectId };
      for (const [field, value] of Object.entries(requiredFields)) {
        if (!value) {
          res.status(400).json({ error: `${field.charAt(0).toUpperCase() + field.slice(1)} is required` });
          return;
        }
      }

      if (!channelId && !sourceConversationId) {
        res.status(400).json({ error: 'Either channelId or sourceConversationId is required' });
        return;
      }

      // Determine the actual channel to check its type
      let actualChannelId = channelId;
      if (!actualChannelId && sourceConversationId) {
        const sourceConv = await this.conversationRepository.findById(sourceConversationId);
        if (sourceConv) {
          actualChannelId = sourceConv.channelId;
        }
      }

      // Validate boardId based on channel type
      let boardId = req.body.boardId as string | undefined;
      if (!boardId) {
        let isSupportChannel = false;
        if (actualChannelId) {
          const channel = await this.channelRepository.findById(actualChannelId);
          isSupportChannel = channel?.type === ChannelType.SUPPORT;
        }

        if (isSupportChannel) {
          // Support channels can use default board
          boardId = await this.boardRepository.findDefaultBoardIdForProject(projectId);
        } else {
          // Non-support channels must provide boardId
          res.status(400).json({ error: 'boardId is required' });
          return;
        }
      }

      // Validate enum fields if provided
      if (statusV2 && !Object.values(TicketStatusV2).includes(statusV2 as TicketStatusV2)) {
        res.status(400).json({
          error: `Invalid statusV2 provided. Must be one of: ${Object.values(TicketStatusV2).join(', ')}`
        });
        return;
      }

      if (priority && !Object.values(TicketPriority).includes(priority as TicketPriority)) {
        res.status(400).json({
          error: `Invalid priority provided. Must be one of: ${Object.values(TicketPriority).join(', ')}`
        });
        return;
      }

      const userId = req.user?.id;
      if (!userId || !req.user) {
        res.status(401).json({ error: 'User not authenticated' });
        return;
      }

      if (req.body.createdBy && req.body.createdBy !== userId) {
        res.status(400).json({ error: 'createdBy must match the authenticated user' });
        return;
      }
      if (req.body.updatedBy && req.body.updatedBy !== userId) {
        res.status(400).json({ error: 'updatedBy must match the authenticated user' });
        return;
      }
      if (req.body.closedBy && req.body.closedBy !== userId) {
        res.status(400).json({ error: 'closedBy must match the authenticated user' });
        return;
      }

      const queryContext = {
        userID: userId,
        workspaceId: req.user.workspaceId,
        role: req.user.role,
        orgRole: req.user.orgRole,
        memberId: req.user.memberId,
      };

      const initialMessageId = randomUUID();

      const board = await this.boardRepository.findBoardById(boardId);

      // Process file uploads BEFORE transaction (external I/O operation)
      let uploadedFiles: UploadedFileResult[] = [];
      if (files.length > 0 && (!draftAttachmentIds || draftAttachmentIds.length === 0)) {
        // Fail entire ticket creation if file upload fails
        // Pass fileMetadata to include dimensions for images/videos
        uploadedFiles = await uploadFiles(files, undefined, fileMetadata);
      }

      // Validate conversation access before transaction
      let validatedConversation: any = null;
      if (sourceConversationId) {
        validatedConversation = await this.conversationRepository.findById(sourceConversationId);

        if (!validatedConversation) {
          res.status(400).json({ error: 'Source conversation not found' });
          return;
        }

        // 🔒 SECURITY FIX: ENFORCE CONVERSATION ACCESS CONTROL
        // Check if user has access to the conversation via channel participation
        const channel = await this.channelRepository.findById(validatedConversation.channelId);

        if (channel && channel.visibility === 'PRIVATE') {
          const isParticipant = await this.channelParticipantRepository.isParticipant(
            validatedConversation.channelId,
            userId
          );
          if (!isParticipant) {
            res.status(403).json({
              error: 'Access denied - you do not have permission to access this conversation',
              code: 'NOT_CONVERSATION_PARTICIPANT',
            });
            return;
          }
        }
      }

      // Auto-assign ticket if userGroupId is provided but assignedTo is not
      let finalAssignedTo = assignedTo;
      let pendingFullRoleAssignment = false;

      if (userGroupId && !assignedTo) {
        try {
          const boardMetaRow = await prisma.board.findUnique({ where: { id: boardId }, select: { metadata: true } });
          const boardMeta = boardMetaRow?.metadata as BoardMetadata | undefined;

          if (boardMeta?.fullRoleAssignment === true) {
            // Full role assignment will be done after ticket creation
            pendingFullRoleAssignment = true;
          } else {
            const assignmentResult = await evaluateAssignmentRule(userGroupId, boardId, undefined, undefined, projectId);
            if (assignmentResult.assignedUserId) {
              finalAssignedTo = assignmentResult.assignedUserId;
            }
          }
        } catch (error) {
          logger.error('[Ticket Creation] Error during auto-assignment:', error);
          // Continue with ticket creation even if assignment fails
        }
      }

      // Wrap all database operations in a transaction for data integrity
      const { ticket } = await prisma.$transaction(async (tx) => {
        // Generate xyneId using project-scoped format
        const xyneId = await TicketIdService.generateTicketId(tx, projectId);

        let conversationId: string;
        let ticket: Ticket;

        if (sourceConversationId) {
          const existingConversation = validatedConversation;
          // Conversation existence already validated before transaction

          conversationId = existingConversation.conversationId;
          const channelIdFromConversation = existingConversation.channelId;
          const existingConversationWorkspaceId = await this.channelRepository.getWorkspaceId(channelIdFromConversation);

          ticket = await this.ticketRepository.createTicket({
            title,
            description,
            createdBy: userId,
            updatedBy: userId,
            assignedTo: finalAssignedTo,
            conversationId,
            channelId: channelIdFromConversation,
            projectId,
            workspaceId: existingConversationWorkspaceId,
            userGroupId,
            boardId,
            statusV2: statusV2 as TicketStatusV2,
            priority,
            eta,
            metadata,
            closedAt,
            closedBy,
            merchantId,
            xyneId,
            ticketType,
            dynamicFields: dynamicFields as Record<string, string>,
          }, tx);

          const ticketMd = serializeTicketMd({
            id: ticket.id,
            title: ticket.title,
            description: ticket.description,
            statusV2: ticket.statusV2 as TicketCardSummary['statusV2'],
            priority: ticket.priority as TicketCardSummary['priority'],
            assignedTo: ticket.assignedTo ?? null,
            createdBy: ticket.createdBy,
            createdAt: ticket.createdAt.getTime(),
            eta: ticket.eta ? ticket.eta.getTime() : null,
            xyneId: ticket.xyneId,
            stageName: ticket.stageName,
            ticketType: ticket.ticketType ?? null,
            channelId: ticket.channelId,
            conversationId: ticket.conversationId,
          });

          // Update conversation with ticketId and ticket_md
          await tx.conversation.update({
            where: { conversationId: existingConversation.conversationId },
            data: { ticketId: ticket.id, ticket_md: ticketMd },
          });


          // Add/update ticket creator as MENTIONED participant (subscribed by default)
          await db.conversationParticipant.upsert({
            where: {
              conversationId_userId: {
                conversationId,
                userId,
              },
            },
            create: {
              id: randomUUID(),
              conversationId,
              userId,
              participationType: 'MENTIONED',
              isSubscribed: true,
              joinedAt: new Date(),
              channelId,
            },
            update: {
              participationType: 'MENTIONED',
              isSubscribed: true,
            },
          });

          if (existingConversation.initialMessageId) {
            const initialMessage = await this.messageRepository.findById(existingConversation.initialMessageId);

            if (initialMessage) {
              const existingMetadata = (initialMessage.metadata as Record<string, unknown>) || {};
              await this.messageRepository.update(existingConversation.initialMessageId, {
                metadata: {
                  ...existingMetadata,
                  ticketId: ticket.id,
                },
              });
            }
          }

          // Get existing CHAT attachments from the FIRST MESSAGE ONLY and convert them to TICKET attachments (excluding any that user chose to exclude)
          let existingChatAttachments: MessageAttachment[] = [];

          if (existingConversation.initialMessageId) {
            // Only get attachments from the initial/first message of the conversation
            existingChatAttachments = await this.messageAttachmentRepository.findByMessageId(
              existingConversation.initialMessageId
            );
          }

          // Filter out excluded attachments
          const attachmentsToConvert = existingChatAttachments.filter(attachment =>
            !(excludedChatAttachmentIds || []).includes(attachment.id)
          );

          // Update existing CHAT attachments to TICKET attachments (atomic operation)
          if (attachmentsToConvert.length > 0) {
            const attachmentIdsToConvert = attachmentsToConvert.map(attachment => attachment.id);
            await this.messageAttachmentRepository.updateManyEntityTypeAndId(
              attachmentIdsToConvert,
              AttachmentEntityType.TICKET,
              ticket.id
            );
          }

          // If there were any excluded attachments, they remain as CHAT attachments
          // (they won't be deleted since the conversation still exists)
        } else {
          const conversation = await this.conversationRepository.create({
            channelId: channelId!,
            createdBy: userId,
            initialMessageId,
          });

          conversationId = conversation.conversationId;

          const newConversationWorkspaceId = await this.channelRepository.getWorkspaceId(channelId!);

          ticket = await this.ticketRepository.createTicket({
            title,
            description,
            createdBy: userId,
            updatedBy: userId,
            assignedTo: finalAssignedTo,
            conversationId,
            channelId: channelId!,
            projectId,
            workspaceId: newConversationWorkspaceId,
            userGroupId,
            boardId,
            statusV2: statusV2 as TicketStatusV2,
            priority,
            eta,
            metadata,
            closedAt,
            closedBy,
            merchantId,
            xyneId,
            ticketType,
            dynamicFields: dynamicFields as Record<string, string>,
          }, tx);

          await this.messageRepository.createWithExecutionId({
            conversationId,
            senderId: userId,
            content: `Ticket created in ${board?.name || 'Unknown Board'}: ${title}`,
            msgType: 'SYSTEM',
            metadata: { ticketId: ticket.id },
          }, initialMessageId);
          await messageMetadataService.syncInitialMessageMd(conversationId);

          const ticketMd = serializeTicketMd({
            id: ticket.id,
            title: ticket.title,
            description: ticket.description,
            statusV2: ticket.statusV2 as TicketCardSummary['statusV2'],
            priority: ticket.priority as TicketCardSummary['priority'],
            assignedTo: ticket.assignedTo ?? null,
            createdBy: ticket.createdBy,
            createdAt: ticket.createdAt.getTime(),
            eta: ticket.eta ? ticket.eta.getTime() : null,
            xyneId: ticket.xyneId,
            stageName: ticket.stageName,
            ticketType: ticket.ticketType ?? null,
            channelId: ticket.channelId,
            conversationId: ticket.conversationId,
          });

          // Update conversation with ticketId and ticket_md
          await tx.conversation.update({
            where: { conversationId },
            data: { ticketId: ticket.id, ticket_md: ticketMd },
          });

          // Add ticket creator as MENTIONED participant (subscribed by default)
          await tx.conversationParticipant.upsert({
            where: {
              conversationId_userId: {
                conversationId,
                userId: userId,
              },
            },
            create: {
              id: randomUUID(),
              conversationId,
              userId: userId,
              participationType: 'MENTIONED',
              isSubscribed: true,
              joinedAt: new Date(),
              channelId: ticket.channelId,
            },
            update: {
              participationType: 'MENTIONED',
              isSubscribed: true,
            },
          });
        }

        // Get workspaceId from channel for attachments
        const ticketChannelWorkspaceId = channelId
          ? await this.channelRepository.getWorkspaceId(channelId)
          : '';

        // Create attachment records for uploaded files (inside transaction)
        if (uploadedFiles.length > 0) {
          const attachmentData: CreateMessageAttachmentInput[] = uploadedFiles.map(file => ({
            entityId: ticket.id,
            entityType: AttachmentEntityType.TICKET,
            originalFilename: file.originalName,
            size: file.fileSize,
            mimetype: file.mimeType,
            url: file.fileUrl,
            thumbnailUrl: file.thumbnailUrl ?? undefined,
            width: file.width,
            height: file.height,
            uploadedByUserId: userId,
            createdBy: userId,
            storageProvider: config.fileStorage.provider,
            conversationId: conversationId,
            workspaceId: ticketChannelWorkspaceId,
            metadata: file.metadata || {},
          }));

          await this.messageAttachmentRepository.createMany(attachmentData);

          // Fetch back to get real IDs for manual Vespa trigger
          const savedAttachments = await this.messageAttachmentRepository.findByEntityIdAndType(ticket.id, AttachmentEntityType.TICKET);
          if (savedAttachments.length > 0) {
            const attachments = savedAttachments.map(a => ({ id: a.id, mimetype: a.mimetype }));
            this.pushVespaJobForAttachments(attachments, userId, ticketChannelWorkspaceId).catch((error: any) => {
              logger.error(`[TicketController] Error pushing Vespa job for ticket attachments ${ticket.id}:`, error);
            });
          }
        }

        // Trigger Vespa job for converted chat attachments
        if (sourceConversationId) {
          // chat attachments were updated to TICKET type, we should re-index them
          const convertedAttachments = await this.messageAttachmentRepository.findByEntityIdAndType(ticket.id, AttachmentEntityType.TICKET);
          if (convertedAttachments.length > 0) {
            const attachments = convertedAttachments.map(a => ({ id: a.id, mimetype: a.mimetype }));
            this.pushVespaJobForAttachments(attachments, userId, ticketChannelWorkspaceId).catch((error: any) => {
              logger.error(`[TicketController] Error pushing Vespa job for converted attachments in ticket ${ticket.id}:`, error);
            });
          }
        }

        // Transfer draft attachments to ticket (if provided)
        if (draftAttachmentIds && draftAttachmentIds.length > 0) {
          // Validate draft attachments exist and belong to the user
          const draftAttachments = await this.messageAttachmentRepository.findByIds(draftAttachmentIds);

          if (draftAttachments.length !== draftAttachmentIds.length) {
            logger.warn(`[Ticket Creation] Some draft attachments not found: requested ${draftAttachmentIds.length}, found ${draftAttachments.length}`);
          }

          // Validate all are DRAFT attachments owned by the user
          const validDraftAttachments = draftAttachments
            .filter((attachment: MessageAttachment) =>
              attachment.entityType === AttachmentEntityType.DRAFT &&
              attachment.uploadedByUserId === userId
            );

          const validDraftAttachmentIds = validDraftAttachments.map(a => a.id);

          // Update draft attachments to ticket attachments
          if (validDraftAttachmentIds.length > 0) {
            await this.messageAttachmentRepository.updateManyEntityTypeAndId(
              validDraftAttachmentIds,
              AttachmentEntityType.TICKET,
              ticket.id
            );

            // Also update conversationId to associate with the new conversation
            await tx.messageAttachment.updateMany({
              where: {
                id: { in: validDraftAttachmentIds },
              },
              data: {
                conversationId: conversationId,
              },
            });

            const draftMessage = await db.draftMessage.findUnique({
              where: {
                id: draftAttachments[0].entityId, // All attachments belong to the same draft message
              },
            });

            if (draftMessage) {
              await db.draftMessage.delete({
                where: {
                  id: draftMessage.id,
                },
              });
            }

            logger.info(`[Ticket Creation] Transferred ${validDraftAttachmentIds.length} draft attachments to ticket ${ticket.id}`);

            // Trigger Vespa re-indexing for transferred draft attachments
            const attachments = validDraftAttachments.map(a => ({ id: a.id, mimetype: a.mimetype }));
            this.pushVespaJobForAttachments(attachments, userId!, ticketChannelWorkspaceId).catch((error: any) => {
              logger.error(`[TicketController] Error pushing Vespa job for transferred draft attachments in ticket ${ticket.id}:`, error);
            });
          }
        }

        return { ticket, conversationId };
      });

      const ticketChannelId = sourceConversationId ? validatedConversation.channelId : channelId;
      if (ticketChannelId) {
        await this.channelRepository.updateLastActivity(ticketChannelId);
      }

      // Create TicketTag records for each tag
      if (tags && tags.length > 0) {
        try {
          await prisma.ticketTag.createMany({
            data: tags.map(tagName => ({
              name: tagName.trim(),
              ticketId: ticket.id,
            })),
          });
          logger.info(`[Ticket Creation] Created ${tags.length} tags for ticket ${ticket.id}`);
        } catch (error) {
          logger.error('[Ticket Creation] Error creating ticket tags:', error);
          // Don't fail ticket creation if tag creation fails
        }
      }


      // Queue Vespa job in background - worker will handle all processing
      vespaQueue.addJob({
        schema: ticketSchema,
        jobType: "feed",
        docId: ticket.id,
        userId: userId,
        workspaceId: req.user?.workspaceId,
      }).catch(async (error) => {
        logger.error('Error queuing Vespa job for ticket:', error);
        // Log failed insertion to Postgres for later retry
        try {
          const vespaLogs = db.vespaInsertionLogs;
          if (vespaLogs) {
            await vespaLogs.create({
              data: {
                status: "FAILED",
                type: "INSERT",
                entityId: ticket.id,
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
          logger.error('Failed to log Vespa insertion error to database:', dbError);
        }
      });

      // Create FormEntityValues records for dynamic fields
      if (Object.keys(dynamicFields).length > 0) {
        try {
          // Fetch form mapping for the board to get form ID
          const formMapping = await prisma.formContextMapping.findFirst({
            where: {
              contextId: boardId,
              contextType: FormContextType.BOARD,
              entityType: FormEntityType.TICKET,
            },
          });

          if (formMapping) {
            // Fetch form fields separately
            const formFields = await prisma.formFields.findMany({
              where: {
                formId: formMapping.formId,
              },
            });

            // Create FormEntityValues for each dynamic field
            const formEntityValuesData = formFields
              .filter((field: any) => dynamicFields[field.fieldName] !== undefined)
              .map((field: any) => {
                const value = dynamicFields[field.fieldName];
                // Provide both fields for backward compatibility
                return {
                  formId: formMapping.formId,
                  entityId: ticket.id,
                  entityType: FormEntityType.TICKET,
                  fieldId: field.id,
                  contextId: boardId,
                  fieldValue: '', // Empty string for backward compatibility (not used anymore)
                  actualFieldValue: value, // Actual value stored in JSON field
                };
              });

            if (formEntityValuesData.length > 0) {
              await prisma.formEntityValues.createMany({
                data: formEntityValuesData,
              });
              logger.info(`[Ticket Creation] Created ${formEntityValuesData.length} form entity values for ticket ${ticket.id}`);
            }
          }
        } catch (error) {
          logger.error('[Ticket Creation] Error creating form entity values:', error);
          // Don't fail ticket creation if form entity values creation fails
        }
      }

      void userActivityTrackingService.trackTicketCreated(userId, {
        ticketId: ticket.id,
        title: ticket.title,
        boardId: ticket.boardId,
      });

      // Full role assignment when toggle is ON (runs after ticket is committed)
      let fraAssignedUserId: string | null = null;
      if (pendingFullRoleAssignment && userGroupId) {
        try {
          const fullRoles = await ticketAssignmentService.assignFullRolesToTicket({
            ticketId: ticket.id,
            userGroupId,
            boardId,
            createdBy: userId,
            projectId: ticket.projectId,
          });
          if (fullRoles.member) {
            const prevAssignedTo = ticket.assignedTo;
            const updatedTicket = await prisma.ticket.update({
              where: { id: ticket.id },
              data: { assignedTo: fullRoles.member },
            });
            await syncConversationTicketMdFromPrismaTicket(prisma, updatedTicket);
            fraAssignedUserId = fullRoles.member;

            const ticketsHandler = new TicketsSideEffectHandler(queryContext);
            ticketsHandler.onUpdate({
              entityId: ticket.id,
              entityType: 'tickets',
              operation: 'update',
              args: { assignedTo: fullRoles.member },
              previousValue: {
                assignedTo: prevAssignedTo,
                stageName: ticket.stageName,
                statusV2: ticket.statusV2,
                eta: ticket.eta ? ticket.eta.getTime() : null,
                boardId: ticket.boardId,
                createdBy: ticket.createdBy,
                channelId: ticket.channelId,
              },
            }).catch(err => logger.error('[Ticket Creation] TicketsSideEffectHandler error:', err));
          }

          const assignmentsHandler = new TicketAssignmentsSideEffectHandler(queryContext);
          const fraAssignments = [fullRoles.manager, fullRoles.teamLead, fullRoles.prReviewer, fullRoles.qa].filter((a): a is RoleAssignment => Boolean(a));
          for (const assignment of fraAssignments) {
            assignmentsHandler.onInsert({
              entityId: assignment.assignmentId,
              entityType: 'ticket_assignments',
              operation: 'insert',
            }).catch(err => logger.error(`[Ticket Creation] TicketAssignmentsSideEffectHandler error for assignment ${assignment.assignmentId}:`, err));
          }

          logger.info(`[Ticket Creation] Full role assignment complete for ticket ${ticket.id}`);
        } catch (error) {
          logger.error('[Ticket Creation] Error during full role assignment:', error);
        }
      }

      // Sync workload mapping if ticket was assigned to a user
      const finalAssignedUserId = fraAssignedUserId || ticket.assignedTo;
      if (finalAssignedUserId && userGroupId) {
        try {
          await syncUserWorkload(finalAssignedUserId, userGroupId, boardId, userId);
          logger.info(`[Ticket Creation] Synced workload for user ${finalAssignedUserId}`);
        } catch (error) {
          logger.error('[Ticket Creation] Error syncing workload:', error);
        }
      }

      // Send notification for regular auto-assignment (non-FRA)
      // FRA notifications are handled by side-effect handlers above
      if (!pendingFullRoleAssignment && ticket.assignedTo && ticket.assignedTo !== userId) {
        const ticketsHandler = new TicketsSideEffectHandler(queryContext);
        ticketsHandler.onUpdate({
          entityId: ticket.id,
          entityType: 'tickets',
          operation: 'update',
          args: { assignedTo: ticket.assignedTo },
          previousValue: {
            assignedTo: null,
            stageName: ticket.stageName,
            statusV2: ticket.statusV2,
            eta: ticket.eta ? ticket.eta.getTime() : null,
            boardId: ticket.boardId,
            createdBy: ticket.createdBy,
            channelId: ticket.channelId,
          },
        }).catch(err => logger.error('[Ticket Creation] Non-FRA TicketsSideEffectHandler error:', err));
      }

      logger.info('analytics_event', {
        event: 'ticket_created',
        timestamp: new Date().toISOString(),
        userId: ticket.createdBy,
      });

      ticketDuplicateService.persistDuplicateReferences({
        ticketId: ticket.id,
        ticketCreatedBy: ticket.createdBy,
        title,
        description,
        projectId,
        userId,
        parentTicketId,
      }).catch(error => {
        logger.error('Failed to persist duplicate references for ticket', {
          ticketId: ticket.id,
          error,
        });
      });

      const response: GetTicketDetailsResponse = {
        id: ticket.id,
        title: ticket.title,
        description: ticket.description,
        status: ticket.statusV2,
        createdBy: ticket.createdBy,
        updatedBy: ticket.updatedBy,
        assignedTo: ticket.assignedTo,
        conversationId: ticket.conversationId,
        eta: ticket.eta,
        priority: ticket.priority,
        metadata: ticket.metadata as Record<string, any> | null,
        closedAt: ticket.closedAt,
        closedBy: ticket.closedBy,
        xyneId: ticket.xyneId,
        projectId: ticket.projectId,
        boardId: ticket.boardId,
        stageName: ticket.stageName,
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt,
      };

      res.status(201).json(response);

      // Check if this is a support channel by fetching the channel type
      const channel = await this.channelRepository.findById(ticket.channelId);
      if (channel && channel.type === ChannelType.SUPPORT) {
        // Trigger IT_SUPPORT_WORKFLOW for support channels
        await workflowManager.startWorkflow({
          ticketId: ticket.id,
          workflowType: WorkflowType.IT_SUPPORT_WORKFLOW,
          context: {
            title: ticket.title,
            description: ticket.description,
            ticketId: ticket.id,
            queryText: description,
            channelId: channel.id,
            userId,
            userName: req.user?.name,
            conversationId: ticket.conversationId,
            xyneId: ticket.xyneId,
          },
          createdBy: userId,
        })
      }

      // Trigger commit analysis 
      const deployedCommitId = dynamicFields?.['deployedCommitId'] as string;
      const newCommitId = dynamicFields?.['newCommitId'] as string;
      const branch = dynamicFields?.['branch'] as string;

      if (this.commitAnalysisController && isReleaseTicket(ticket.ticketType as BaseTicketType) && deployedCommitId && newCommitId && branch) {
        // TODO: Replace hardcoded values with actual configuration from project/board settings
        const workspace = 'XYNE';
        const repoSlug = 'xyne-spaces';
        const xyneReleaseBot = await unifiedBotUserService.getBotByBotId('xyne-release-bot', ticket.workspaceId);

        this.commitAnalysisController.analyzeCommits({
          workspace,
          repoSlug,
          conversationId: ticket.conversationId,
          userId: xyneReleaseBot?.id || userId,
          channelId: ticket.channelId || undefined,
          newCommitId,
          deployedCommitId,
          branch,
          parentTicketId,
          userName: req.user?.name,
          isHotFix: ticket.ticketType === BaseTicketType.Hotfix,
          workspaceId: xyneReleaseBot?.workspaceId || req.user?.workspaceId!,
        }).then((result) => {
          if (result.success) {
            logger.info(`[Ticket Creation] Commit analysis completed for ticket ${ticket.xyneId}`);
          } else {
            logger.error(`[Ticket Creation] Commit analysis failed for ticket ${ticket.xyneId}:`, result.error);
          }
        }).catch((error) => {
          logger.error(`[Ticket Creation] Commit analysis error for ticket ${ticket.xyneId}:`, error);
        });
      }

    } catch (error) {
      logger.error('Error creating ticket:', error);

      if (error instanceof PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          const target = error.meta?.target as string[];
          if (target && target.includes('xyneId')) {
            res.status(409).json({
              error: 'Ticket ID conflict. Please try again.',
              code: 'DUPLICATE_ID',
            });
            return;
          }
        }
      }

      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
     * Update a ticket
     * PATCH /api/tickets/:ticketId
     *
     * Path params:
     * - ticketId: ID of the ticket to update
     * - workspaceID
     *
     * Body (at least one update field required):
     * - assigneeId: string - New assignee user ID
     * - stage: string - New stage name (must exist on ticket's board)
     * - groupId: string - User group ID to assign
     * - title: string - New title
     * - description: string - New description
     * - priority: string - LOW | MEDIUM | HIGH | CRITICAL
     * - status: string - TODO | STARTED | PAUSED | CANCELLED | COMPLETED
     * - eta: string - Due date as ISO 8601 string
     */
  updateTicket = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'User not authenticated' });
        return;
      }

      const ticketId = req.params.ticketId;
      if (!ticketId) {
        res.status(400).json({ error: 'ticketId is required (path param)' });
        return;
      }

      const { assigneeId, stage, groupId, title, description, priority, status, eta } = req.body ?? {};

      if (!assigneeId && !stage && !groupId && !title && !description && !priority && !status && !eta) {
        res.status(400).json({
          error: 'At least one update field is required (assigneeId, stage, groupId, title, description, priority, status, or eta)',
        });
        return;
      }

      const updates = await ticketService.updateTicket(ticketId, userId, {
        assigneeId, stage, groupId, title, description, priority, status, eta,
      });

      res.status(200).json({ success: true, updated: updates });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('[TicketController] Error updating ticket:', {
        error: errorMessage,
        ticketId: req.params.ticketId,
        userId: req.user?.id,
      });
      res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: errorMessage,
      });
    }
  };




  checkDuplicateTickets = async (req: Request, res: Response): Promise<void> => {
    try {
      const { title, description, projectId, limit = 10 } = req.body as TicketDuplicateCheckRequest;

      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'User not authenticated' });
        return;
      }

      const { candidates, analysis } = await ticketDuplicateService.checkDuplicates({
        title,
        description,
        projectId,
        userId,
        limit,
      });

      const response: TicketDuplicateCheckResponse = {
        candidates,
        analysis,
      };

      res.json({ success: true, data: response });
    } catch (error) {
      logger.error('Error checking ticket duplicates:', error);
      res.status(500).json({ error: 'Failed to check ticket duplicates' });
    }
  };

  getPendingHumanIntervention = async (req: Request, res: Response): Promise<void> => {
    try {
      const { ticketId } = req.params;

      if (!ticketId) {
        res.status(400).json({ error: 'ticketId is required' });
        return;
      }
      const pendingStep = await this.findPendingUserApprovalStep(ticketId);

      if (!pendingStep) {
        res.status(200).json({
          requiresIntervention: false,
          step: null
        });
        return;
      }

      let stepTitle = 'Human Intervention Required';
      let responseSchema = null;

      if (pendingStep.data) {
        try {
          const stepData = JSON.parse(pendingStep.data);
          stepTitle = stepData?.externalMetadata?.title || stepTitle;
          responseSchema = stepData?.externalMetadata?.response_schema || null;
        } catch (e) {
          // Ignore parse errors
        }
      }

      res.status(200).json({
        requiresIntervention: true,
        step: {
          id: pendingStep.id,
          stepName: pendingStep.stepName,
          title: stepTitle,
          responseSchema,
          workflowExecutionId: pendingStep.workflowExecutionId,
          createdAt: pendingStep.createdAt
        }
      });
    } catch (error) {
      logger.error('Error checking pending human intervention:', error);
      res.status(500).json({ error: 'Failed to check pending human intervention' });
    }
  };

  private async findPendingUserApprovalStep(ticketId: string) {
    const workflows = await prisma.workflow.findMany({
      where: { ticketId },
      select: { id: true }
    });

    if (workflows.length === 0) {
      return null;
    }

    const workflowIds = workflows.map(w => w.id);

    const executions = await prisma.workflowExecution.findMany({
      where: { workflowId: { in: workflowIds } },
      select: { id: true }
    });

    if (executions.length === 0) {
      return null;
    }

    const executionIds = executions.map(e => e.id);

    // Step 3: Find input steps with stepSubType 'user_approval'
    const inputSteps = await prisma.workflowStep.findMany({
      where: {
        workflowExecutionId: { in: executionIds },
        stepExecutorType: 'external',
        stepSubType: 'user_approval',
        type: 'input'
      },
      orderBy: { createdAt: 'desc' }
    });

    if (inputSteps.length === 0) {
      return null;
    }

    for (const inputStep of inputSteps) {
      const externalStepResponse = await prisma.externalStepResponse.findUnique({
        where: {
          workflowStepId: inputStep.id
        }
      });

      if (!externalStepResponse) {
        return inputStep;
      }
    }

    return null;
  }

  suggestBoard = async (req: Request, res: Response): Promise<void> => {
    try {
      const { title, description, projectId } = req.body as TicketBoardSuggestionRequest;

      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'User not authenticated' });
        return;
      }

      const { candidates, analysis } = await this.analyzeBoardCandidates({
        title,
        description,
        projectId,
        userId,
      });

      const response: TicketBoardSuggestionResponse = {
        candidates,
        analysis,
      };

      res.json({ success: true, data: response });
    } catch (error) {
      logger.error('Error suggesting board:', error);
      res.status(500).json({ error: 'Failed to suggest board' });
    }
  };

  private async getBoardCandidates(projectId: string): Promise<TicketBoardCandidate[]> {
    const boards = await this.boardRepository.findBoardsByProject(projectId);

    return boards.map(board => ({
      id: board.id,
      name: board.name,
      description: undefined, // Board model doesn't have description field
      boardType: board.boardType || undefined,
      stageCount: undefined, // Can be populated if needed by fetching stages count
    }));
  }

  private async analyzeBoardCandidates(params: {
    title: string;
    description: string;
    projectId: string;
    userId: string;
  }): Promise<{ candidates: TicketBoardCandidate[]; analysis: TicketBoardAnalysis }> {
    const { title, description, projectId, userId } = params;
    const candidates = await this.getBoardCandidates(projectId);

    if (candidates.length === 0) {
      return {
        candidates,
        analysis: {
          suggestedBoardId: null,
          suggestedBoardName: null,
        },
      };
    }

    const analysis = await ticketBoardService.suggestBoard(
      { title, description },
      candidates,
      { userId, projectId },
    );

    return { candidates, analysis };
  }

  /**
   * POST /api/tickets/:ticketId/attachments/from-conversation
   * Transfer CHAT MessageAttachments from a Spaces conversation message to an
   * existing ticket. Used by the claw agent (spaces-add-ticket-attachments tool)
   * when a ticket was created without sourceConversationId.
   *
   * Body: { sourceConversationId: string, sourceMessageId?: string }
   * - If sourceMessageId is provided, transfers attachments from that specific message.
   * - Otherwise falls back to the conversation's initialMessageId.
   */
  addAttachmentsFromConversation = async (req: Request, res: Response): Promise<void> => {
    try {
      const { ticketId } = req.params;

      const bodyResult = AddAttachmentsFromConversationBodySchema.safeParse(req.body);
      if (!bodyResult.success) {
        res.status(400).json({ error: bodyResult.error.errors[0]?.message ?? 'Invalid request body' });
        return;
      }
      const { sourceConversationId, sourceMessageId } = bodyResult.data;

      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'User not authenticated' });
        return;
      }

      // Validate ticket exists and enforce workspace-scoped ACL
      const ticket = await this.ticketRepository.getTicketById(ticketId);
      if (!ticket) {
        res.status(404).json({ error: 'Ticket not found' });
        return;
      }
      if (ticket.workspaceId !== req.user!.workspaceId) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      // Validate conversation exists
      const conversation = await this.conversationRepository.findById(sourceConversationId);
      if (!conversation) {
        res.status(400).json({ error: 'Source conversation not found' });
        return;
      }

      // Determine which message to pull attachments from:
      // - If caller specifies sourceMessageId (e.g. the exact triggering message), prefer that.
      // - Otherwise fall back to the conversation's initialMessageId.
      const messageId = sourceMessageId ?? conversation.initialMessageId;
      if (!messageId) {
        res.json({ count: 0 });
        return;
      }

      const attachments = await this.messageAttachmentRepository.findByMessageId(messageId);
      if (attachments.length === 0) {
        res.json({ count: 0 });
        return;
      }

      const attachmentIds = attachments.map((a) => a.id);
      await this.messageAttachmentRepository.updateManyEntityTypeAndId(
        attachmentIds,
        AttachmentEntityType.TICKET,
        ticketId,
      );

      // Re-index transferred attachments in Vespa
      this.pushVespaJobForAttachments(
        attachments.map((a) => ({ id: a.id, mimetype: a.mimetype })),
        userId,
        ticket.workspaceId,
      ).catch((err) => {
        logger.error(`[TicketController] Vespa re-index failed for attachments on ticket ${ticketId}:`, err);
      });

      logger.info(`[TicketController] Transferred ${attachments.length} attachment(s) from message ${messageId} to ticket ${ticketId}`);
      res.json({ count: attachments.length });
    } catch (err) {
      logger.error('[TicketController] addAttachmentsFromConversation error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
  mergeTicket = async (req: Request, res: Response): Promise<void> => {
    try {
      const { ticketId } = req.params;
      const { targetTicketId } = req.body;
      const userId = req.user?.id ?? '';

      if (!targetTicketId) { res.status(400).json({ error: 'targetTicketId is required' }); return; }
      if (ticketId === targetTicketId) { res.status(400).json({ error: 'Cannot merge a ticket into itself' }); return; }

      const [source, target] = await Promise.all([
        prisma.ticket.findUnique({ where: { id: ticketId } }),
        prisma.ticket.findUnique({ where: { id: targetTicketId } }),
      ]);
      if (!source) { res.status(404).json({ error: 'Source ticket not found' }); return; }
      if (!target) { res.status(404).json({ error: 'Target ticket not found' }); return; }
      if (source.workspaceId !== target.workspaceId) { res.status(403).json({ error: 'Cannot merge tickets across workspaces' }); return; }
      if (source.isArchived || target.isArchived) { res.status(400).json({ error: 'Cannot merge archived tickets' }); return; }

      const existingMapping = await prisma.ticketReferenceMapping.findFirst({
        where: { sourceTicketId: ticketId, relationType: TicketReferenceRelation.MERGED_INTO },
      });
      if (existingMapping) {
        res.status(400).json({ error: 'Ticket is already merged into another ticket' });
        return;
      }

      const mapping = await prisma.$transaction(async (tx) => {
        const created = await tx.ticketReferenceMapping.create({
          data: { sourceTicketId: ticketId, targetTicketId, relationType: TicketReferenceRelation.MERGED_INTO, createdBy: userId },
        });
        await tx.ticket.update({ where: { id: ticketId }, data: { isArchived: true, updatedBy: userId } });

        await tx.ticketActivity.create({
          data: { ticketId, updatedBy: userId, activityType: ActivityType.MERGED, value: { targetTicketId: target.id, targetTicketXyneId: target.xyneId, targetTicketTitle: target.title } },
        });
        await tx.ticketActivity.create({
          data: { ticketId: targetTicketId, updatedBy: userId, activityType: ActivityType.MERGED, value: { sourceTicketId: ticketId, sourceTicketXyneId: source.xyneId, sourceTicketTitle: source.title } },
        });

        return created;
      });

      // Create Zero-side notification activities (fire-and-forget)
      TicketsSideEffectHandler.handleTicketMerged({
        sourceTicketId: ticketId,
        targetTicketId: target.id,
        sourceXyneId: source.xyneId,
        targetXyneId: target.xyneId,
        sourceTitle: source.title,
        targetTitle: target.title,
        actorId: userId,
        channelId: source.channelId,
      }).catch((err) => {
        logger.error('[TicketController] Failed to create merge notification activities:', err);
      });

      logger.info('[TicketController] Ticket merged', { sourceTicketId: ticketId, targetTicketId, mappingId: mapping.id });
      res.json({ success: true, mappingId: mapping.id, targetTicket: { id: target.id, title: target.title, xyneId: target.xyneId } });
    } catch (err) {
      logger.error('[TicketController] mergeTicket error:', err);
      res.status(500).json({ error: 'Failed to merge ticket' });
    }
  };

  unmergeTicket = async (req: Request, res: Response): Promise<void> => {
    try {
      const { ticketId } = req.params;
      const userId = req.user?.id ?? '';

      const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
      if (!ticket) { res.status(404).json({ error: 'Ticket not found' }); return; }
      if (!ticket.isArchived) { res.status(400).json({ error: 'Ticket is not archived' }); return; }

      const mapping = await prisma.ticketReferenceMapping.findFirst({
        where: { sourceTicketId: ticketId, relationType: TicketReferenceRelation.MERGED_INTO },
        include: { targetTicket: true },
      });
      if (!mapping) { res.status(400).json({ error: 'Ticket is not merged into another ticket' }); return; }

      await prisma.$transaction(async (tx) => {
        await tx.ticketReferenceMapping.delete({ where: { id: mapping.id } });
        await tx.ticket.update({ where: { id: ticketId }, data: { isArchived: false, updatedBy: userId } });

        await tx.ticketActivity.create({
          data: { ticketId, updatedBy: userId, activityType: ActivityType.UNMERGED, value: { targetTicketId: mapping.targetTicketId, targetTicketXyneId: mapping.targetTicket.xyneId, targetTicketTitle: mapping.targetTicket.title } },
        });
        await tx.ticketActivity.create({
          data: { ticketId: mapping.targetTicketId, updatedBy: userId, activityType: ActivityType.UNMERGED, value: { sourceTicketId: ticketId, sourceTicketXyneId: ticket.xyneId, sourceTicketTitle: ticket.title } },
        });
      });

      // Create Zero-side notification activities (fire-and-forget)
      TicketsSideEffectHandler.handleTicketUnmerged({
        sourceTicketId: ticketId,
        targetTicketId: mapping.targetTicketId,
        sourceXyneId: ticket.xyneId,
        targetXyneId: mapping.targetTicket.xyneId,
        sourceTitle: ticket.title,
        targetTitle: mapping.targetTicket.title,
        actorId: userId,
        channelId: ticket.channelId,
      }).catch((err) => {
        logger.error('[TicketController] Failed to create unmerge notification activities:', err);
      });

      logger.info('[TicketController] Ticket unmerged', { ticketId, previousTargetId: mapping.targetTicketId });
      res.json({ success: true, restoredTicket: { id: ticket.id, title: ticket.title, xyneId: ticket.xyneId, isArchived: false } });
    } catch (err) {
      logger.error('[TicketController] unmergeTicket error:', err);
      res.status(500).json({ error: 'Failed to unmerge ticket' });
    }
  };

}
