import { Request, Response } from 'express';
import { Ticket, TicketStatusV2, TicketPriority, AttachmentEntityType, MessageAttachment, TicketReferenceRelation } from '@prisma/client';
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
  TicketDuplicateCandidate,
  TicketDuplicateCheckAnalysis,
  TicketDuplicateCheckResponse,
} from '../types/ticket';
import { evaluateAssignmentRule } from '../utils/assignmentEngine';
import { syncUserWorkload } from '../utils/workloadUtils';
import { notificationHooks } from '@/hooks/notificationHooks';
import { uploadFiles, UploadedFileResult } from '../services/fileUploadService';
import { config } from '../config/env';
import { randomUUID } from 'crypto';
import { vespaQueue } from '@/queues/vespaQueue';
import { ticketSchema } from '@/vespa/src/types';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { NAMESPACE } from '@/vespa/vespaConfig';
import { DatabaseClient } from '@/database/client';
import { transformVespaResults } from '@/services/vespaSearch/resultTransform';
import { vespaService } from '@/services/vespaSearch';
import { ticketDuplicateService } from '@/services/ticketDuplicateService';
import { BaseTicketType, FormContextType, FormEntityType } from '@xyne/shared';
import { CommitAnalysisController } from './commitAnalysisController';
import { isReleaseTicket } from '@xyne/shared';

const prisma = DatabaseClient.getInstance();
const DUPLICATE_REFERENCE_LIMIT = 10;

export class TicketController {
  private ticketRepository: TicketRepository;
  private conversationRepository: ConversationRepository;
  private boardRepository: BoardRepository;
  private channelRepository: ChannelRepository;
  private channelParticipantRepository: ChannelParticipantRepository;
  private messageRepository: MessageRepository;
  private messageAttachmentRepository: MessageAttachmentRepository;
  private commitAnalysisController: CommitAnalysisController;

  constructor() {
    this.ticketRepository = new TicketRepository();
    this.conversationRepository = new ConversationRepository();
    this.boardRepository = new BoardRepository();
    this.channelRepository = new ChannelRepository();
    this.channelParticipantRepository = new ChannelParticipantRepository();
    this.messageRepository = new MessageRepository();
    this.messageAttachmentRepository = new MessageAttachmentRepository();
    this.commitAnalysisController = new CommitAnalysisController();
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

      // Generate xyneId using PostgreSQL sequence
      const result = await tx.$queryRaw<[{ nextval: bigint }]>`SELECT nextval('ticket_xyne_id_seq')`;
      const xyneId = `XYNE-${result[0].nextval}`;

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
        boardId,
        statusV2: statusV2 as TicketStatusV2,
        priority: priority.toUpperCase() as TicketPriority,
        xyneId,
      });

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

      await this.channelRepository.updateLastActivity(channelId);

      return ticket;
    });

    this.persistDuplicateReferences({
      ticket,
      title,
      description,
      projectId,
      userId: createdBy,
    }).catch(error => {
      logger.error('Failed to persist duplicate references for ticket', {
        ticketId: ticket.id,
        error,
      });
    });

    return ticket;
  }

  createTicket = async (req: Request, res: Response): Promise<void> => {
    try {
      // Handle both FormData (with files) and JSON requests
      const {
        title,
        description,
        createdBy,
        updatedBy,
        assignedTo,
        projectId,
        userGroupId,
        boardId,
        statusV2,
        priority,
        eta,
        metadata,
        closedAt,
        closedBy,
        sourceConversationId,
        channelId,
        excludedChatAttachmentIds,
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
      const requiredFields = { title, description, projectId, boardId };
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

      // Use authenticated user's ID as createdBy and updatedBy if not provided
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'User not authenticated' });
        return;
      }

      const finalCreatedBy = createdBy || userId;
      const finalUpdatedBy = updatedBy || userId;

      const initialMessageId = randomUUID();

      const board = await this.boardRepository.findBoardById(boardId);

      // Process file uploads BEFORE transaction (external I/O operation)
      let uploadedFiles: UploadedFileResult[] = [];
      if (files.length > 0) {
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
      if (userGroupId && !assignedTo) {
        try {
          const assignmentResult = await evaluateAssignmentRule(userGroupId, boardId);
          if (assignmentResult.assignedUserId) {
            finalAssignedTo = assignmentResult.assignedUserId;
          }
        } catch (error) {
          logger.error('[Ticket Creation] Error during auto-assignment:', error);
          // Continue with ticket creation even if assignment fails
        }
      }

      // Wrap all database operations in a transaction for data integrity
      const { ticket } = await prisma.$transaction(async (tx) => {
        // Generate xyneId using PostgreSQL sequence (inside transaction)
        const result = await tx.$queryRaw<[{ nextval: bigint }]>`SELECT nextval('ticket_xyne_id_seq')`;
        const xyneId = `XYNE-${result[0].nextval}`;

        let conversationId: string;
        let ticket: Ticket;

        if (sourceConversationId) {
          const existingConversation = validatedConversation;
          // Conversation existence already validated before transaction

          conversationId = existingConversation.conversationId;
          const channelIdFromConversation = existingConversation.channelId;

          ticket = await this.ticketRepository.createTicket({
            title,
            description,
            createdBy: finalCreatedBy,
            updatedBy: finalUpdatedBy,
            assignedTo: finalAssignedTo,
            conversationId,
            channelId: channelIdFromConversation,
            projectId,
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
          });

          // Update conversation with ticketId
          await tx.conversation.update({
            where: { conversationId: existingConversation.conversationId },
            data: { ticketId: ticket.id },
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
            createdBy: finalCreatedBy,
            initialMessageId,
          });

          conversationId = conversation.conversationId;

          ticket = await this.ticketRepository.createTicket({
            title,
            description,
            createdBy: finalCreatedBy,
            updatedBy: finalUpdatedBy,
            assignedTo: finalAssignedTo,
            conversationId,
            channelId: channelId!,
            projectId,
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
          });

          await this.messageRepository.createWithExecutionId({
            conversationId,
            senderId: finalCreatedBy,
            content: `Ticket created in ${board?.name || 'Unknown Board'}: ${title}`,
            msgType: 'SYSTEM',
            metadata: { ticketId: ticket.id },
          }, initialMessageId);

          // Update conversation with ticketId
          await tx.conversation.update({
            where: { conversationId },
            data: { ticketId: ticket.id },
          });
        }

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
            uploadedByUserId: finalCreatedBy,
            createdBy: finalCreatedBy,
            storageProvider: config.fileStorage.provider,
            conversationId: conversationId,
            metadata: file.metadata || {},
          }));

          await this.messageAttachmentRepository.createMany(attachmentData);
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
        userId: userId
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
                  entityId: ticket.id,
                  entityType: FormEntityType.TICKET,
                  fieldId: field.id,
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

      // Sync workload mapping if ticket was assigned to a user
      if (ticket.assignedTo && userGroupId) {
        try {
          await syncUserWorkload(ticket.assignedTo, userGroupId, boardId, userId);
          logger.info(`[Ticket Creation] Synced workload for user ${ticket.assignedTo}`);
        } catch (error) {
          logger.error('[Ticket Creation] Error syncing workload:', error);
          // Don't fail ticket creation if workload sync fails
        }
      }

      // Send notification AFTER transaction (external operation)
      if (ticket.assignedTo && ticket.assignedTo !== userId) {
        try {
          await notificationHooks.onTicketAssignment(ticket.id, ticket.assignedTo, userId);
        } catch (error) {
          logger.error('Failed to send ticket assignment notification on creation:', error);
        }
      }

      this.persistDuplicateReferences({
        ticket,
        title,
        description,
        projectId,
        userId,
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

      // Trigger commit analysis 
      const deployedCommitId = dynamicFields?.['deployedCommitId'] as string;
      const newCommitId = dynamicFields?.['newCommitId'] as string;
      const branch = dynamicFields?.['branch'] as string;

      if (isReleaseTicket(ticket.ticketType as BaseTicketType) && deployedCommitId && newCommitId && branch) {
        // TODO: Replace hardcoded values with actual configuration from project/board settings
        const workspace = 'XYNE';
        const repoSlug = 'xyne-spaces';

        this.commitAnalysisController.analyzeCommits({
          workspace,
          repoSlug,
          conversationId: ticket.conversationId,
          userId: finalCreatedBy,
          channelId: ticket.channelId || undefined,
          newCommitId,
          deployedCommitId,
          branch,
          parentTicketId,
          userName: req.user?.name,
          isHotFix: ticket.ticketType === BaseTicketType.Hotfix,
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

  checkDuplicateTickets = async (req: Request, res: Response): Promise<void> => {
    try {
      const { title, description, projectId, limit = 10 } = req.body as TicketDuplicateCheckRequest;

      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'User not authenticated' });
        return;
      }

      const { candidates, analysis } = await this.analyzeDuplicateCandidates({
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

  private async persistDuplicateReferences(params: {
    ticket: Ticket;
    title: string;
    description: string;
    projectId: string;
    userId: string;
  }): Promise<void> {
    try {
      const { ticket, title, description, projectId, userId } = params;
      const { candidates, analysis } = await this.analyzeDuplicateCandidates({
        title,
        description,
        projectId,
        userId,
        limit: DUPLICATE_REFERENCE_LIMIT,
        excludeTicketId: ticket.id,
      });

      if (candidates.length === 0) {
        return;
      }

      if (!analysis.isDuplicate || !analysis.duplicateTicketId) {
        return;
      }

      const duplicateCandidate = candidates.find(
        candidate => candidate.id === analysis.duplicateTicketId,
      );

      if (!duplicateCandidate) {
        return;
      }

      const referenceRows = [
        {
          sourceTicketId: ticket.id,
          targetTicketId: duplicateCandidate.id,
          relationType: TicketReferenceRelation.DUPLICATE_POSSIBLE,
          createdBy: ticket.createdBy,
        },
      ];

      await prisma.ticketReferenceMapping.createMany({
        data: referenceRows,
        skipDuplicates: true,
      });
    } catch (error) {
      logger.error('Failed to persist duplicate ticket references', error);
    }
  }

  private async getDuplicateCandidates(params: {
    title: string;
    description: string;
    projectId: string;
    userId: string;
    limit: number;
    excludeTicketId?: string;
  }): Promise<TicketDuplicateCandidate[]> {
    const { title, description, projectId, userId, limit, excludeTicketId } = params;
    const query = `${title}\n\n${description}`.trim();

    if (!query) {
      return [];
    }

    const vespaResults = await vespaService.searchService.searchVespa(
      query,
      userId,
      ['ticket'],
      {
        offset: 0,
        limit,
        ticket: {
          projectId: [projectId],
        },
      },
    );

    const hits = vespaResults.root.children || [];
    const transformedResults = await transformVespaResults(hits, prisma);

    const candidates = transformedResults
      .filter(result => result.type === 'ticket')
      .map(result => ({
        id: result.id,
        title: result.title,
        description: result.context || '',
        boardId: result.searchContext?.boardId,
        status: result.searchContext?.ticketStatus || result.metadata.status,
        stage: result.subtitle,
        relevanceScore: result.relevanceScore,
        channelId: result.searchContext?.channelId,
        createdAt: result.metadata.timestamp,
      }));

    if (!excludeTicketId) {
      return candidates;
    }

    return candidates.filter(candidate => candidate.id !== excludeTicketId);
  }

  private async analyzeDuplicateCandidates(params: {
    title: string;
    description: string;
    projectId: string;
    userId: string;
    limit: number;
    excludeTicketId?: string;
  }): Promise<{ candidates: TicketDuplicateCandidate[]; analysis: TicketDuplicateCheckAnalysis }> {
    const { title, description, projectId, userId, limit, excludeTicketId } = params;
    const candidates = await this.getDuplicateCandidates({
      title,
      description,
      projectId,
      userId,
      limit,
      excludeTicketId,
    });

    if (candidates.length === 0) {
      return {
        candidates,
        analysis: {
          isDuplicate: false,
          duplicateTicketId: null,
          confidence: 0,
          reason: 'No similar tickets found.',
        },
      };
    }

    const analysis = await ticketDuplicateService.analyzeDuplicate(
      { title, description },
      candidates,
      { userId, projectId },
    );

    return { candidates, analysis };
  }

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
}
