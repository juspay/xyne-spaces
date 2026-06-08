import { Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '@/utils/logger';
import { createTicketWithConversation } from '../core/ticketutils';
import { TicketPriority, TicketStatusV2, MessageDirection, ExternalEntityType, Prisma } from '@prisma/client';
import { repositories } from '@/database/repositories';
import { evaluateAssignmentRule } from '@/utils/assignmentEngine';
import { ticketService } from '@/services/ticketService';
import { ticketAssignmentService } from '@/services/ticketAssignmentService';
import { ticketDuplicateService } from '@/services/ticketDuplicateService';
import { DatabaseClient } from '@/database/client';
import type { BoardMetadata } from '@xyne/shared';
import { syncConversationTicketMdFromPrismaTicket } from '@/utils/ticketMd';
import { emitEventToWorkspaceApps } from '../core/eventSubscriptionUtils';
import { AppEventType, AdditionalFormFieldUpdatedPayload, BaseAppEvent } from '../types';
import { emailService } from '@/services/emailService';
import { buildEmailTicketAcknowledgmentBody } from '../core/emailUtils';
import { extractEmailAddress } from '@/utils/email';
import { ExternalSourceRepository } from '@/database/repositories/externalSourceRepository';
import { adapterRegistry } from '@/integrations/core/adapterRegistry';

import { resolveChannelId } from '../utils/channelUtils';

const externalSourceRepo = new ExternalSourceRepository();

const prismaClient = DatabaseClient.getInstance();

const CreateTicketBodySchema = z.object({
  title: z.string().min(1, 'Title is required').trim(),
  description: z.string().min(1, 'Description is required').trim(),
  projectId: z.string().min(1, 'Project ID is required').trim(),
  boardId: z.string().min(1, 'Board ID is required').trim(),
  channelId: z.string().min(1, 'Channel ID is required').trim().optional(),
  channelName: z.string().min(1, 'Channel name is required').trim().optional(),
  text: z.string().trim().optional(),
  priority: z.nativeEnum(TicketPriority).optional(),
  assignedToEmail: z.string().email('Invalid email format').trim().optional(),
  assignedUserGroupAlias: z.string().trim().optional(),
  stageName: z.string().trim().optional(),
  eta: z.string().datetime({ message: 'ETA must be a valid ISO 8601 date string' }).optional(),
  ticketType: z.string().trim().optional(),
}).refine(
  data => !!data.channelId || !!data.channelName,
  { message: 'Either channelId or channelName is required', path: ['channelId'] }
).refine(
  data => !data.eta || new Date(data.eta) > new Date(),
  { message: 'ETA must be a future date', path: ['eta'] }
);

const UpdateTicketBodySchema = z.object({
  ticketId: z.string().min(1, 'Ticket ID is required').trim(),
  channelId: z.string().trim().optional(),
  channelName: z.string().trim().optional(),
  conversationId: z.string().trim().optional(),
  assigneeId: z.string().trim().optional(),
  assignedToEmail: z.string().email('Invalid email format').trim().optional(),
  stageName: z.string().trim().optional(),
  statusV2: z.nativeEnum(TicketStatusV2).optional(),
  groupId: z.string().trim().optional(),
  title: z.string().min(1, 'Title cannot be empty').trim().optional(),
  description: z.string().min(1, 'Description cannot be empty').trim().optional(),
  priority: z.nativeEnum(TicketPriority).optional(),
  eta: z.string().datetime({ message: 'ETA must be a valid ISO 8601 date string' }).optional(),
  ticketType: z.string().trim().optional(),
}).refine(
  data => !!data.channelId || !!data.channelName || !!data.conversationId,
  { message: 'Either channelId, channelName, or conversationId is required', path: ['channelId'] }
).refine(
  data => !!(
    data.assigneeId || data.assignedToEmail || data.stageName || data.groupId ||
    data.title || data.description || data.priority || data.eta ||
    data.ticketType || data.statusV2
  ),
  { message: 'At least one field to update is required', path: ['assigneeId'] }
).refine(
  data => !(data.assigneeId && data.assignedToEmail),
  { message: 'Provide either assigneeId or assignedToEmail, not both', path: ['assigneeId'] }
).refine(
  data => !data.eta || new Date(data.eta) > new Date(),
  { message: 'ETA must be a future date', path: ['eta'] }
);

const CreateEmailTicketBodySchema = z.object({
  channelId: z.string().min(1, 'channelId is required').trim(),
  subject: z.string().min(1, 'subject is required').trim(),
  body: z.string().min(1, 'body is required').trim(),
  senderEmail: z.string().email('senderEmail must be a valid email').trim(),
  boardId: z.string().min(1, 'boardId must not be empty').trim().optional(),
  priority: z.nativeEnum(TicketPriority).optional(),
  assignedToEmail: z.string().email('Invalid email format').trim().optional(),
  assignedUserGroupAlias: z.string().trim().optional(),
  stageName: z.string().trim().optional(),
  ticketType: z.string().trim().optional(),
});

export class TicketController {

  /**
   * Create a ticket
   * POST /api/external-event/ticket/createTicket
   * 
   * Required fields:
   * - title: string - Title of the ticket
   * - description: string - Description of the ticket
   * - projectId: string - Project ID to which the ticket belongs
   * - boardId: string - Board ID to which the ticket belongs
   * - channelId: string - Channel ID (validated by middleware)
   * - userId: string - User ID (added by authentication middleware)
   * 
   * Optional fields:
   * - text: string - Text content for the message to which the ticket will be attached (if not provided, no text will be added to the message)
   * - priority: TicketPriority - Priority of the ticket (defaults to LOW)
   * - assignedToEmail: string - Email address of the user to assign the ticket to (user must exist)
   * - assignedUserGroupAlias: string - Alias of the user group to assign the ticket to (user group must exist)
   */
  createTicket = async (req: Request, res: Response): Promise<void> => {
    try {
      // Validate request body with Zod
      const bodyResult = CreateTicketBodySchema.safeParse(req.body);
      
      if (!bodyResult.success) {
        res.status(400).json({ 
          error: `Validation error`,
          code: 'VALIDATION_ERROR',
          details: bodyResult.error.errors
        });
        return;
      }

      const {
        title,
        description,
        projectId,
        boardId,
        channelId,
        channelName,
        priority,
        assignedToEmail,
        assignedUserGroupAlias,
        text,
        stageName: requestedStageName,
        eta: etaString,
        ticketType,
      } = bodyResult.data;

      const userId = req.user!.id;

      const board = await repositories.boards.findById(boardId);
      if (!board) {
        res.status(404).json({
          error: `Board with ID ${boardId} not found`,
          code: 'BOARD_NOT_FOUND',
        });
        return;
      }
      if (board.projectId !== projectId) {
        res.status(400).json({
          error: `Board does not belong to the specified project`,
          code: 'BOARD_PROJECT_MISMATCH',
        });
        return;
      }

      let resolvedStageName: string | undefined;
      if (requestedStageName) {
        const stage = await prismaClient.stage.findFirst({
          where: { boardId, name: requestedStageName },
          select: { name: true },
        });
        if (!stage) {
          res.status(400).json({
            error: `Stage "${requestedStageName}" does not exist on board ${boardId}`,
            code: 'STAGE_NOT_FOUND',
          });
          return;
        }
        resolvedStageName = stage.name;
      }

      let etaDate: Date | undefined;
      if (etaString) {
        etaDate = new Date(etaString);
        if (etaDate <= new Date()) {
          res.status(400).json({
            error: 'ETA must be a future date',
            code: 'INVALID_ETA',
          });
          return;
        }
      }

      // Resolve channelId from channelName if not provided
      const resolvedChannelId = await resolveChannelId(channelId, undefined, channelName);

      const channel = await repositories.channels.findById(resolvedChannelId);
      if (!channel) {
        res.status(404).json({
          error: `Channel with ID ${resolvedChannelId} not found`,
          code: 'CHANNEL_NOT_FOUND',
        });
        return;
      }
      if (channel.projectId !== projectId) {
        res.status(400).json({
          error: `Channel does not belong to the specified project`,
          code: 'CHANNEL_PROJECT_MISMATCH',
        });
        return;
      }

      // Resolve assignedToEmail to userId if provided
      let assignedTo: string | undefined;
      if (assignedToEmail) {
        const user = await repositories.users.findByEmail(assignedToEmail, req.user!.workspaceId!);
        if (!user) {
          res.status(404).json({
            error: `User with email ${assignedToEmail} not found`,
            code: 'USER_NOT_FOUND',
          });
          return;
        }
        assignedTo = user.id;
      }

      // Resolve assignedUserGroupAlias to userGroupId if provided
      let userGroupId: string | undefined;
      if (assignedUserGroupAlias) {
        const userGroup = await repositories.userGroups.findByAlias(assignedUserGroupAlias, req.user!.workspaceId!);
        if (!userGroup) {
          res.status(404).json({
            error: `User group with alias ${assignedUserGroupAlias} not found`,
            code: 'USER_GROUP_NOT_FOUND',
          });
          return;
        }
        userGroupId = userGroup.id;
      }

      let resolvedAssignedTo = assignedTo;
      let pendingFullRoleAssignment = false;

      if (userGroupId && !assignedTo) {
        try {
          const boardRow = await prismaClient.board.findUnique({ where: { id: boardId }, select: { metadata: true } });
          const boardMetadata = boardRow?.metadata as BoardMetadata | undefined;

          if (boardMetadata?.fullRoleAssignment === true) {
            // Full role assignment will be done after ticket creation
            pendingFullRoleAssignment = true;
          } else {
          const assignmentResult = await evaluateAssignmentRule(userGroupId, boardId, undefined, undefined, projectId);
          if (assignmentResult.assignedUserId) {
            resolvedAssignedTo = assignmentResult.assignedUserId;
            }
          }
        } catch (error) {
          logger.error('[Apps Ticket Creation] Error during auto-assignment:', error);
        }
      }

      // Create ticket with conversation using utility function
      const result = await createTicketWithConversation({
        title,
        description,
        projectId,
        boardId,
        channelId: resolvedChannelId,
        userId,
        priority,
        assignedTo: resolvedAssignedTo,
        userGroupId,
        text,
        stageName: resolvedStageName,
        eta: etaDate,
        ticketType,
      });

      // Check for duplicate tickets and persist references
      if (result.ticketId) {
        ticketDuplicateService.persistDuplicateReferences({
          ticketId: result.ticketId,
          ticketCreatedBy: userId,
          title,
          description,
          projectId,
          userId,
        }).catch(error => {
          logger.error('[Apps Ticket Creation] Failed to persist duplicate references for ticket', {
            ticketId: result.ticketId,
            error,
          });
        });
      }

      if (pendingFullRoleAssignment && userGroupId && result.ticketId) {
        try {
          const fullRoles = await ticketAssignmentService.assignFullRolesToTicket({
            ticketId: result.ticketId,
            userGroupId,
            boardId,
            createdBy: userId,
            projectId,
          });
          if (fullRoles.member) {
            const updatedTicket = await prismaClient.ticket.update({
              where: { id: result.ticketId },
              data: { assignedTo: fullRoles.member },
            });
            await syncConversationTicketMdFromPrismaTicket(prismaClient, updatedTicket);
          }
        } catch (error) {
          logger.error('[Apps Ticket Creation] Error during full role assignment:', error);
        }
      }

      res.status(201).json(result);
    } catch (error) {
      logger.error('Error creating ticket:', error);

      if (error instanceof Error) {
        if (error.message.includes('not found') || error.message.includes('No stages found')) {
          res.status(404).json({
            error: error.message,
            code: 'NOT_FOUND',
          });
          return;
        }
      }

      res.status(500).json({ 
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  };

  /**
   * Update a ticket - Generic update endpoint
   * POST /api/apps/ticket/updateTicket
   * 
   * Required fields:
   * - ticketId: string - ID of the ticket to update
   * - userId: string - User ID performing the update
   * - channelId or conversationId: string - For channel access validation
   * 
   * Optional fields (at least one required):
   * - assigneeId: string - Update ticket assignee
   * - stage: string - Update ticket stage
   * - groupId: string - Assign user group to ticket
   */
  updateTicket = async (req: Request, res: Response): Promise<void> => {
    try {
      // Validate request body with Zod
      const bodyResult = UpdateTicketBodySchema.safeParse(req.body);

      logger.info(`[TicketController] Received update ticket request`, {
        body: req.body,
        validationSuccess: bodyResult.success,
        validationErrors: bodyResult.success ? null : bodyResult.error.errors,
      });
      
      if (!bodyResult.success) {
        res.status(400).json({ 
          error: 'Validation error',
          code: 'VALIDATION_ERROR',
          details: bodyResult.error.errors
        });
        return;
      }

      const {
        ticketId,
        assigneeId,
        assignedToEmail,
        stageName,
        groupId,
        title,
        description,
        priority,
        eta: etaString,
        ticketType,
        statusV2,
      } = bodyResult.data;

      const userId = req.user!.id;

      logger.info(`[TicketController] Updating ticket: ${ticketId}`, {
        userId, assigneeId, assignedToEmail, stageName, groupId,
        title: !!title, description: !!description, priority, eta: etaString, ticketType, statusV2,
      });

      // Fetch the ticket to validate it exists and get board/project context
      const ticket = await prismaClient.ticket.findUnique({
        where: { id: ticketId },
        select: { id: true, boardId: true, projectId: true, workspaceId: true, conversationId: true },
      });
      if (!ticket) {
        res.status(404).json({
          error: `Ticket with ID ${ticketId} not found`,
          code: 'TICKET_NOT_FOUND',
        });
        return;
      }

      // --- Validate stageName exists on the ticket's board ---
      if (stageName) {
        const stage = await prismaClient.stage.findFirst({
          where: { boardId: ticket.boardId, name: stageName },
          select: { name: true, defaultTicketStatusV2: true },
        });
        if (!stage) {
          res.status(400).json({
            error: `Stage "${stageName}" does not exist on board ${ticket.boardId}`,
            code: 'STAGE_NOT_FOUND',
          });
          return;
        }
      }

      // --- Validate ETA is in the future ---
      let etaDate: Date | undefined;
      if (etaString) {
        etaDate = new Date(etaString);
        if (etaDate <= new Date()) {
          res.status(400).json({
            error: 'ETA must be a future date',
            code: 'INVALID_ETA',
          });
          return;
        }
      }

      // --- Resolve assignedToEmail to a userId ---
      let resolvedAssigneeId: string | undefined = assigneeId;
      if (assignedToEmail) {
        const user = await repositories.users.findByEmail(assignedToEmail, req.user!.workspaceId!);
        if (!user) {
          res.status(404).json({
            error: `User with email ${assignedToEmail} not found`,
            code: 'USER_NOT_FOUND',
          });
          return;
        }
        resolvedAssigneeId = user.id;
      }

      // --- Execute updates ---

      // Assignee
      if (resolvedAssigneeId) {
        await ticketService.updateTicketAssignee(ticketId, userId, resolvedAssigneeId);
        logger.info(`[TicketController] Ticket assignee updated: ${ticketId}`);
      }

      // Stage (updateTicketStageForWorkflow also updates statusV2 via defaultTicketStatusV2)
      if (stageName) {
        await ticketService.updateTicketStageForWorkflow(ticketId, userId, stageName);
        logger.info(`[TicketController] Ticket stage updated: ${ticketId}`);
      }

      // User group
      if (groupId) {
        await ticketService.asignUserGroupToTicket(ticketId, userId, groupId);
        logger.info(`[TicketController] User group assigned: ${ticketId}`);
      }

      // Direct field updates: title, description, priority, eta, ticketType, statusV2
      const directUpdates: Record<string, unknown> = {};
      if (title !== undefined) directUpdates.title = title;
      if (description !== undefined) directUpdates.description = description;
      if (priority !== undefined) directUpdates.priority = priority;
      if (etaDate !== undefined) directUpdates.eta = etaDate;
      if (ticketType !== undefined) directUpdates.ticketType = ticketType;
      if (statusV2 !== undefined) directUpdates.statusV2 = statusV2;

      if (Object.keys(directUpdates).length > 0) {
        directUpdates.updatedBy = userId;
        directUpdates.updatedAt = new Date();
        const updatedTicket = await prismaClient.ticket.update({
          where: { id: ticketId },
          data: directUpdates as Parameters<typeof prismaClient.ticket.update>[0]['data'],
        });
        await syncConversationTicketMdFromPrismaTicket(prismaClient, updatedTicket);
        logger.info(`[TicketController] Ticket direct fields updated: ${ticketId}`, { fields: Object.keys(directUpdates) });
      }

      res.status(200).json({ success: true });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      logger.error('[TicketController] Error updating ticket:', {
        error: errorMessage,
        stack: errorStack,
        ticketId: req.body.ticketId,
        userId: req.body.userId,
      });
      res.status(500).json({ 
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: errorMessage,
      });
    }
  };

  /**
   * Get ticket information by ID
   * GET /:ticketId
   */
  getInfo = async (req: Request, res: Response): Promise<void> => {
    try {
      const { ticketId } = req.params;

      if (!ticketId) {
        res.status(400).json({
          error: 'Ticket ID is required',
          code: 'VALIDATION_ERROR',
        });
        return;
      }

      const ticket = await repositories.tickets.getTicketById(ticketId);

      if (!ticket) {
        res.status(404).json({
          error: `Ticket with ID ${ticketId} not found`,
          code: 'TICKET_NOT_FOUND',
        });
        return;
      }

      res.status(200).json(ticket);
    } catch (error) {
      logger.error('[TicketController] Error fetching ticket info:', error);
      res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  };

  /**
   * Update a form field value on a ticket
   * POST /api/apps/ticket/updateFormField
   * 
   * This is a generic endpoint for apps to update custom form fields on tickets.
   * Used by external systems (like Genius) to update field values.
   */
  updateFormField = async (req: Request, res: Response): Promise<void> => {
    try {
      const { ticketId, fieldName, fieldValue, channelId, channelName, conversationId, sessionId: _sessionId } = req.body;

      // Validate required fields
      if (!ticketId || typeof ticketId !== 'string') {
        res.status(400).json({ error: 'ticketId is required', code: 'VALIDATION_ERROR' });
        return;
      }
      if (!fieldName || typeof fieldName !== 'string') {
        res.status(400).json({ error: 'fieldName is required', code: 'VALIDATION_ERROR' });
        return;
      }
      if (fieldValue === undefined || fieldValue === null) {
        res.status(400).json({ error: 'fieldValue is required', code: 'VALIDATION_ERROR' });
        return;
      }
      if (!channelId && !channelName && !conversationId) {
        res.status(400).json({ error: 'Either channelId, channelName, or conversationId is required', code: 'VALIDATION_ERROR' });
        return;
      }

      logger.info(`[TicketController] Updating form field: ${fieldName} on ticket ${ticketId}`);

      // Fetch ticket to get board context and conversation
      const ticket = await prismaClient.ticket.findUnique({
        where: { id: ticketId },
        select: { id: true, boardId: true, conversationId: true, workspaceId: true },
      });

      if (!ticket) {
        res.status(404).json({ error: `Ticket ${ticketId} not found`, code: 'TICKET_NOT_FOUND' });
        return;
      }

      // Get form mapping for this board
      const formMapping = await prismaClient.formContextMapping.findFirst({
        where: { contextId: ticket.boardId, contextType: 'BOARD', entityType: 'TICKET' },
        select: { formId: true },
      });

      if (!formMapping) {
        res.status(404).json({ error: 'No form configured for board', code: 'FORM_NOT_FOUND' });
        return;
      }

      // Get the field by name
      const field = await prismaClient.formFields.findFirst({
        where: { formId: formMapping.formId, fieldName: fieldName },
        select: { id: true },
      });

      if (!field) {
        res.status(404).json({ error: `Field "${fieldName}" not found`, code: 'FIELD_NOT_FOUND' });
        return;
      }

      const timestamp = new Date();
      const stringValue = String(fieldValue);

      // Upsert the form entity value
      const existing = await prismaClient.formEntityValues.findFirst({
        where: { entityId: ticketId, entityType: 'TICKET', fieldId: field.id },
      });

      if (existing) {
        await prismaClient.formEntityValues.update({
          where: { id: existing.id },
          data: { fieldValue: stringValue, actualFieldValue: stringValue, updatedAt: timestamp },
        });
      } else {
        await prismaClient.formEntityValues.create({
          data: {
            id: `fev_${ticketId}_${field.id}_${Date.now()}`,
            entityId: ticketId,
            entityType: 'TICKET',
            formId: formMapping.formId,
            fieldId: field.id,
            fieldValue: stringValue,
            actualFieldValue: stringValue,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        });
      }

      logger.info(`[TicketController] Form field "${fieldName}" updated to "${stringValue}" on ticket ${ticketId}`);

      // Emit ADDITIONAL_FORM_FIELD_UPDATED event to all apps in the workspace
      // Apps (like Genius) filter by fieldName and boardName to handle specific cases
      try {
        const board = await prismaClient.board.findUnique({
          where: { id: ticket.boardId },
          select: { id: true, name: true },
        });

        const conversation = ticket.conversationId
          ? await prismaClient.conversation.findUnique({
              where: { conversationId: ticket.conversationId },
              select: { channelId: true },
            })
          : null;

        if (board) {
          const payload: AdditionalFormFieldUpdatedPayload = {
            ticketId,
            conversationId: ticket.conversationId || '',
            channelId: conversation?.channelId || '',
            boardId: ticket.boardId,
            boardName: board.name,
            fieldName,
            fieldValue: stringValue,
            previousValue: existing?.fieldValue || undefined,
            updatedBy: req.user!.id,
            workspaceId: ticket.workspaceId,
          };

          const event: BaseAppEvent = {
            eventType: AppEventType.ADDITIONAL_FORM_FIELD_UPDATED,
            payload,
            timestamp: new Date().toISOString(),
          };

          // Fire and forget - don't block the response
          void emitEventToWorkspaceApps(ticket.workspaceId, event);
          
          logger.info(`[TicketController] Emitted ADDITIONAL_FORM_FIELD_UPDATED for field "${fieldName}" on ticket ${ticketId}`);
        }
      } catch (eventError) {
        // Don't fail the request if event emission fails
        logger.error('[TicketController] Error emitting form field update event:', eventError);
      }

      res.status(200).json({ success: true, fieldName, ticketId });
    } catch (error) {
      logger.error('[TicketController] Error updating form field:', error);
      res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
  };

  /**
   * Disable email sending for a ticket
   * POST /api/apps/ticket/disableEmailSend
   */
  disableEmailSend = async (req: Request, res: Response): Promise<void> => {
    try {
      const { ticketId, channelId, channelName, conversationId } = req.body;

      if (!ticketId || typeof ticketId !== 'string') {
        res.status(400).json({ error: 'ticketId is required', code: 'VALIDATION_ERROR' });
        return;
      }
      if (!channelId && !channelName && !conversationId) {
        res.status(400).json({ error: 'Either channelId, channelName, or conversationId is required', code: 'VALIDATION_ERROR' });
        return;
      }

      logger.info(`[TicketController] Disabling email reply for ticket ${ticketId}`);

      // Fetch ticket to verify it exists
      const ticket = await prismaClient.ticket.findUnique({
        where: { id: ticketId },
        select: { id: true, workspaceId: true },
      });

      if (!ticket) {
        res.status(404).json({ error: `Ticket ${ticketId} not found`, code: 'TICKET_NOT_FOUND' });
        return;
      }

      // Update ticket emailReplyEnabled column
      await prismaClient.ticket.update({
        where: { id: ticketId },
        data: { emailReplyEnabled: false },
      });

      logger.info(`[TicketController] Disabled email reply for ticket ${ticketId}`);

      res.status(200).json({ success: true, ticketId, emailReplyEnabled: false });
    } catch (error) {
      logger.error('[TicketController] Error disabling email send:', error);
      res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
  };

  /**
   * Enable email sending for a ticket
   * POST /api/apps/ticket/enableEmailSend
   */
  enableEmailSend = async (req: Request, res: Response): Promise<void> => {
    try {
      const { ticketId, channelId, channelName, conversationId } = req.body;

      if (!ticketId || typeof ticketId !== 'string') {
        res.status(400).json({ error: 'ticketId is required', code: 'VALIDATION_ERROR' });
        return;
      }
      if (!channelId && !channelName && !conversationId) {
        res.status(400).json({ error: 'Either channelId, channelName, or conversationId is required', code: 'VALIDATION_ERROR' });
        return;
      }

      logger.info(`[TicketController] Enabling email reply for ticket ${ticketId}`);

      // Fetch ticket to verify it exists
      const ticket = await prismaClient.ticket.findUnique({
        where: { id: ticketId },
        select: { id: true, workspaceId: true },
      });

      if (!ticket) {
        res.status(404).json({ error: `Ticket ${ticketId} not found`, code: 'TICKET_NOT_FOUND' });
        return;
      }

      // Update ticket emailReplyEnabled column
      await prismaClient.ticket.update({
        where: { id: ticketId },
        data: { emailReplyEnabled: true },
      });

      logger.info(`[TicketController] Enabled email reply for ticket ${ticketId}`);

      res.status(200).json({ success: true, ticketId, emailReplyEnabled: true });
    } catch (error) {
      logger.error('[TicketController] Error enabling email send:', error);
      res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
  };

  /**
   * Create an email-type ticket in Xyne Desk on behalf of an external sender.
   * Ticket appears as an email thread identical to Gmail-ingested tickets.
   * POST /api/apps/ticket/createEmailTicket
   *
   * Body: { channelId, subject, body, senderEmail }
   */
  createEmailTicket = async (req: Request, res: Response): Promise<void> => {
    try {
      const bodyResult = CreateEmailTicketBodySchema.safeParse(req.body);
      if (!bodyResult.success) {
        res.status(400).json({
          error: 'Validation error',
          code: 'VALIDATION_ERROR',
          details: bodyResult.error.errors,
        });
        return;
      }

      const {
        channelId,
        subject,
        body,
        senderEmail,
        boardId,
        priority,
        assignedToEmail,
        assignedUserGroupAlias,
        stageName,
        ticketType,
      } = bodyResult.data;

      const userId = req.user!.id;
      const workspaceId = req.user!.workspaceId;

      // Fetch channel to get projectId (needed for boardId validation)
      const channel = await repositories.channels.findById(channelId);
      if (!channel) {
        res.status(404).json({ error: `Channel with ID ${channelId} not found`, code: 'CHANNEL_NOT_FOUND' });
        return;
      }

      // Validate boardId if provided — must exist and belong to the same project as the channel
      if (boardId) {
        const board = await repositories.boards.findById(boardId);
        if (!board) {
          res.status(404).json({ error: `Board with ID ${boardId} not found`, code: 'BOARD_NOT_FOUND' });
          return;
        }
        if (board.projectId !== channel.projectId) {
          res.status(400).json({ error: `Board does not belong to the channel's project`, code: 'BOARD_PROJECT_MISMATCH' });
          return;
        }
      }

      // Resolve recipientEmail using same 3-level priority as outbound reply sender:
      //   1. EmailChannelPreference.sendAsEmail — admin-configured alias (highest priority)
      //   2. ExternalSource.displayName — connected mailbox from OAuth integration
      //   3. Desk owner's user email — last-resort fallback
      const channelPref = await prismaClient.emailChannelPreference.findUnique({
        where: { channelId },
        select: { sendAsEmail: true, ownerUserId: true },
      });
      const externalSource = await externalSourceRepo.findByChannelId(channelId);
      const ownerUser = channelPref?.ownerUserId
        ? await repositories.users.findById(channelPref.ownerUserId)
        : null;

      const recipientEmail =
        channelPref?.sendAsEmail ||
        extractEmailAddress(externalSource?.displayName ?? '') ||
        ownerUser?.email;

      if (!recipientEmail) {
        res.status(503).json({
          error: 'Channel recipient email is not configured',
          code: 'MISCONFIGURED',
        });
        return;
      }

      // Resolve assignedToEmail → userId (same as createTicket)
      let assignedTo: string | undefined;
      if (assignedToEmail) {
        const user = await repositories.users.findByEmail(assignedToEmail, workspaceId);
        if (!user) {
          res.status(404).json({ error: `User with email ${assignedToEmail} not found`, code: 'USER_NOT_FOUND' });
          return;
        }
        assignedTo = user.id;
      }

      // Resolve assignedUserGroupAlias → userGroupId (same as createTicket)
      let userGroupId: string | undefined;
      if (assignedUserGroupAlias) {
        const userGroup = await repositories.userGroups.findByAlias(assignedUserGroupAlias, workspaceId);
        if (!userGroup) {
          res.status(404).json({ error: `User group with alias ${assignedUserGroupAlias} not found`, code: 'USER_GROUP_NOT_FOUND' });
          return;
        }
        userGroupId = userGroup.id;
      }

      let pendingFullRoleAssignment = false;
      let resolvedAssignedTo = assignedTo;

      // Avoid UUID→provider thread ID races with webhooks:
      // 1) send acknowledgment email first and claim the provider thread immediately,
      // 2) create the desk ticket with real external IDs,
      // 3) link ExternalMessage to the Email row.
      let externalThreadId: string;
      let externalMessageId: string;
      let claimedExternalMessageId: string | undefined;

      const mailAdapter = externalSource ? adapterRegistry.getAdapter(externalSource.name) : null;
      const canSendViaProvider = !!(externalSource && mailAdapter?.sendMailNew);

      if (canSendViaProvider) {
        const acknowledgmentBody = buildEmailTicketAcknowledgmentBody(subject, body);
        let sent: { threadId: string; messageId?: string };
        try {
          sent = await mailAdapter!.sendMailNew!({
            encryptedCredentials: externalSource!.credentials,
            sourceId: externalSource!.id,
            subject,
            body: acknowledgmentBody,
            to: [senderEmail],
            cc: [],
            bcc: [],
            fromEmailAddress: recipientEmail,
          });
        } catch (sendErr) {
          logger.error('[Apps Email Ticket Creation] Failed to send acknowledgment email:', sendErr);
          res.status(502).json({
            error: 'Failed to send initial email via provider',
            code: 'EMAIL_SEND_FAILED',
          });
          return;
        }

        externalThreadId = sent.threadId;
        externalMessageId = sent.messageId || sent.threadId;

        // Claim thread before ticket creation so Gmail/MS webhooks dedupe instead of
        // spawning a second ticket while we persist the conversation.
        try {
          const claimed = await prismaClient.externalMessage.create({
            data: {
              externalSourceId: externalSource!.id,
              externalId: externalMessageId,
              externalThreadId,
              messageId: externalMessageId,
              direction: MessageDirection.OUTGOING,
              entityType: ExternalEntityType.EMAIL,
            },
          });
          claimedExternalMessageId = claimed.id;
        } catch (claimErr) {
          if (
            claimErr instanceof Prisma.PrismaClientKnownRequestError &&
            claimErr.code === 'P2002'
          ) {
            res.status(409).json({ error: 'Duplicate ticket', code: 'DUPLICATE' });
            return;
          }
          throw claimErr;
        }
      } else {
        if (externalSource) {
          logger.warn(
            `[Apps Email Ticket Creation] Adapter "${externalSource.name}" does not support sendMailNew — using local-only thread ids`,
          );
        }
        const { randomUUID } = await import('crypto');
        externalThreadId = randomUUID();
        externalMessageId = externalThreadId;
      }

      let result: Awaited<ReturnType<typeof emailService.createConversationWithEmail>>;
      try {
        result = await emailService.createConversationWithEmail({
          channelId,
          userId,
          emailSubject: subject,
          emailBody: body,
          emailFrom: senderEmail,
          emailTo: [recipientEmail],
          externalThreadId,
          externalMessageId,
          receivedAt: new Date(),
          ...(boardId && { boardId }),
        });
      } catch (createErr) {
        if (claimedExternalMessageId) {
          await prismaClient.externalMessage
            .delete({ where: { id: claimedExternalMessageId } })
            .catch(cleanupErr => {
              logger.warn('[Apps Email Ticket Creation] Failed to release thread claim after create error', {
                claimedExternalMessageId,
                cleanupErr,
              });
            });
        }
        throw createErr;
      }

      if (result && 'blocked' in result && result.blocked) {
        if (claimedExternalMessageId) {
          await prismaClient.externalMessage
            .delete({ where: { id: claimedExternalMessageId } })
            .catch(() => undefined);
        }
        res.status(403).json({ error: 'Ticket creation blocked by configuration', code: 'BLOCKED' });
        return;
      }

      if (result && 'isDuplicate' in result && result.isDuplicate) {
        res.status(409).json({ error: 'Duplicate ticket', code: 'DUPLICATE' });
        return;
      }

      const { ticket, conversation, email: initialEmail } = result as { ticket: any; conversation: any; email: any };

      if (claimedExternalMessageId) {
        await prismaClient.externalMessage.update({
          where: { id: claimedExternalMessageId },
          data: {
            entityId: initialEmail.id,
            messageId: initialEmail.id,
          },
        });
        logger.info(
          `[Apps Email Ticket Creation] Acknowledgment sent, threadId=${externalThreadId} ticket=${ticket.id}`,
        );
      }

      // Check for duplicate tickets and persist references
      if (ticket?.id) {
        ticketDuplicateService.persistDuplicateReferences({
          ticketId: ticket.id,
          ticketCreatedBy: userId,
          title: subject,
          description: body,
          projectId: ticket.projectId,
          userId,
        }).catch(error => {
          logger.error('[Apps Email Ticket Creation] Failed to persist duplicate references for ticket', {
            ticketId: ticket.id,
            error,
          });
        });
      }

      // Apply optional fields to the created ticket
      if (priority !== undefined || resolvedAssignedTo !== undefined || userGroupId !== undefined || stageName !== undefined || ticketType !== undefined) {
        const ticketUpdate: Record<string, unknown> = {};

        if (priority !== undefined) ticketUpdate.priority = priority;
        if (resolvedAssignedTo !== undefined) ticketUpdate.assignedTo = resolvedAssignedTo;
        if (userGroupId !== undefined) ticketUpdate.userGroupId = userGroupId;
        if (ticketType !== undefined) ticketUpdate.ticketType = ticketType;

        if (stageName !== undefined) {
          const stage = await prismaClient.stage.findFirst({
            where: { boardId: ticket.boardId, name: stageName },
            select: { name: true },
          });
          if (!stage) {
            res.status(400).json({
              error: `Stage "${stageName}" does not exist on board ${ticket.boardId}`,
              code: 'STAGE_NOT_FOUND',
            });
            return;
          }
          ticketUpdate.stageName = stage.name;
        }

        if (Object.keys(ticketUpdate).length > 0) {
          const updatedTicket = await prismaClient.ticket.update({
            where: { id: ticket.id },
            data: ticketUpdate,
          });
          await syncConversationTicketMdFromPrismaTicket(prismaClient, updatedTicket);
        }
      }

      // Full role assignment
      if (userGroupId && !assignedTo) {
        try {
          const boardRow = await prismaClient.board.findUnique({
            where: { id: ticket.boardId },
            select: { metadata: true },
          });
          const boardMetadata = boardRow?.metadata as BoardMetadata | undefined;

          if (boardMetadata?.fullRoleAssignment === true) {
            pendingFullRoleAssignment = true;
          } else {
            const assignmentResult = await evaluateAssignmentRule(userGroupId, ticket.boardId, undefined, undefined, ticket.projectId);
            if (assignmentResult.assignedUserId) {
              resolvedAssignedTo = assignmentResult.assignedUserId;
              const updatedTicket = await prismaClient.ticket.update({
                where: { id: ticket.id },
                data: { assignedTo: resolvedAssignedTo },
              });
              await syncConversationTicketMdFromPrismaTicket(prismaClient, updatedTicket);
            }
          }
        } catch (error) {
          logger.error('[Apps Email Ticket Creation] Error during auto-assignment:', error);
        }
      }

      if (pendingFullRoleAssignment && userGroupId && ticket.id) {
        try {
          const fullRoles = await ticketAssignmentService.assignFullRolesToTicket({
            ticketId: ticket.id,
            userGroupId,
            boardId: ticket.boardId,
            createdBy: userId,
            projectId: ticket.projectId,
          });
          if (fullRoles.member) {
            const updatedTicket = await prismaClient.ticket.update({
              where: { id: ticket.id },
              data: { assignedTo: fullRoles.member },
            });
            await syncConversationTicketMdFromPrismaTicket(prismaClient, updatedTicket);
          }
        } catch (error) {
          logger.error('[Apps Email Ticket Creation] Error during full role assignment:', error);
        }
      }

      res.status(201).json({
        ticketId: ticket?.id,
        xyneId: ticket?.xyneId,
        conversationId: conversation?.conversationId,
      });
    } catch (error) {
      logger.error('[TicketController] createEmailTicket error:', error);

      if (error instanceof Error) {
        if (error.message.includes('not found') || error.message.includes('No stages found')) {
          res.status(404).json({ error: error.message, code: 'NOT_FOUND' });
          return;
        }
        if (error.message.includes('boardId configured') || error.message.includes('not configured')) {
          res.status(503).json({ error: error.message, code: 'MISCONFIGURED' });
          return;
        }
      }

      res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
  };
}
