import { Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '@/utils/logger';
import { createTicketWithConversation } from '../core/ticketutils';
import { TicketPriority } from '@prisma/client';
import { repositories } from '@/database/repositories';
import { evaluateAssignmentRule } from '@/utils/assignmentEngine';
import { ticketService } from '@/services/ticketService';

const CreateTicketBodySchema = z.object({
  title: z.string().min(1, 'Title is required').trim(),
  description: z.string().min(1, 'Description is required').trim(),
  projectId: z.string().min(1, 'Project ID is required').trim(),
  boardId: z.string().min(1, 'Board ID is required').trim(),
  channelId: z.string().min(1, 'Channel ID is required').trim(),
  text: z.string().trim().optional(),
  priority: z.nativeEnum(TicketPriority).optional(),
  assignedToEmail: z.string().email('Invalid email format').trim().optional(),
  assignedUserGroupAlias: z.string().trim().optional(),
  userId: z.string().min(1, 'User ID is required').trim(),
});

const UpdateTicketBodySchema = z.object({
  ticketId: z.string().min(1, 'Ticket ID is required').trim(),
  userId: z.string().min(1, 'User ID is required').trim(),
  channelId: z.string().trim().optional(),
  conversationId: z.string().trim().optional(),
  assigneeId: z.string().trim().optional(),
  stage: z.string().trim().optional(),
  groupId: z.string().trim().optional(),
}).refine(
  data => !!data.channelId || !!data.conversationId,
  { message: 'Either channelId or conversationId is required', path: ['channelId'] }
).refine(
  data => !!data.assigneeId || !!data.stage || !!data.groupId,
  { message: 'At least one of assigneeId, stage, or groupId is required', path: ['assigneeId'] }
);

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
        priority,
        assignedToEmail,
        assignedUserGroupAlias,
        text,
        userId,
      } = bodyResult.data;

      // Resolve assignedToEmail to userId if provided
      let assignedTo: string | undefined;
      if (assignedToEmail) {
        const user = await repositories.users.findByEmail(assignedToEmail);
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
        const userGroup = await repositories.userGroups.findByAlias(assignedUserGroupAlias);
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
      if (userGroupId && !assignedTo) {
        try {
          const assignmentResult = await evaluateAssignmentRule(userGroupId, boardId);
          if (assignmentResult.assignedUserId) {
            resolvedAssignedTo = assignmentResult.assignedUserId;
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
        channelId,
        userId,
        priority,
        assignedTo: resolvedAssignedTo,
        userGroupId,
        text,
      });

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

      const { ticketId, userId, assigneeId, stage, groupId } = bodyResult.data;

      logger.info(`[TicketController] Updating ticket: ${ticketId}`, {
        userId,
        assigneeId,
        stage,
        groupId,
      });

      // Execute updates based on provided fields
      if (assigneeId) {
        await ticketService.updateTicketAssignee(ticketId, userId, assigneeId);
        logger.info(`[TicketController] Ticket assignee updated: ${ticketId}`);
      }

      if (stage) {
        await ticketService.updateTicketStageForWorkflow(ticketId, userId, stage);
        logger.info(`[TicketController] Ticket stage updated: ${ticketId}`);
      }

      if (groupId) {
        await ticketService.asignUserGroupToTicket(ticketId, userId, groupId);
        logger.info(`[TicketController] User group assigned: ${ticketId}`);
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
}
