import { Request, Response } from 'express';
import {
  flowStepVisibilitySchemaShape,
  SDLC_CONTAINMENT_RELATION,
  TicketPriority,
} from '@xyne/shared';
import { z } from 'zod';
import { db } from '@/database/client';
import { getKanbanCounts } from '@/services/tickets/kanbanCountsService';
import { logger } from '@/utils/logger';

const kanbanCountsBodyObject = z.object({
  viewMode: z.enum(['project', 'board', 'my-tickets', 'user-tickets', 'group-tickets', 'desk']),
  columnType: z.enum(['stage', 'status']).optional(),
  projectId: z.string().optional(),
  boardId: z.string().optional(),
  boardIds: z.array(z.string()).optional(),
  userId: z.string().optional(),
  groupId: z.string().optional(),
  channelId: z.string().optional(),
  deskFilters: z
    .object({
      assignedTo: z.array(z.string()).optional(),
      createdBy: z.array(z.string()).optional(),
      priority: z.array(z.nativeEnum(TicketPriority)).optional(),
      stageName: z.array(z.string()).optional(),
      aiCategory: z.array(z.string()).optional(),
      conversationIds: z.array(z.string()).optional(),
      hasAiDraft: z.boolean().optional(),
      hasSubTickets: z.boolean().optional(),
      userGroups: z.array(z.string()).optional(),
      lastEmailAtStart: z.number().optional(),
      lastEmailAtEnd: z.number().optional(),
      createdAtStart: z.number().optional(),
      createdAtEnd: z.number().optional(),
      conversationLabelId: z.string().optional(),
    })
    .optional(),
  ...flowStepVisibilitySchemaShape,
  filters: z
    .object({
      priority: z.array(z.nativeEnum(TicketPriority)).optional(),
      assignee: z.array(z.string()).optional(),
      userGroups: z.array(z.string()).optional(),
      createdBy: z.array(z.string()).optional(),
      prReviewers: z.array(z.string()).optional(),
      qaAssigned: z.array(z.string()).optional(),
      roleAssignments: z
        .array(z.object({ roleId: z.string(), userIds: z.array(z.string()) }))
        .optional(),
      dueDateStart: z.number().optional(),
      dueDateEnd: z.number().optional(),
      createdDateStart: z.number().optional(),
      createdDateEnd: z.number().optional(),
      boards: z.array(z.string()).optional(),
      sourceChannels: z.array(z.string()).optional(),
      tags: z.array(z.string()).optional(),
      assigned: z.boolean().optional(),
      created: z.boolean().optional(),
      stages: z.array(z.string()).optional(),
      ticketTypes: z.array(z.string()).optional(),
      merchantIds: z.array(z.string()).optional(),
      dynamicFields: z
        .record(
          z.union([
            z.array(z.string()),
            z.object({ start: z.number().optional(), end: z.number().optional() }),
          ]),
        )
        .optional(),
    })
    .optional(),
  groupBy: z
    .union([
      z.enum(['none', 'assignee', 'createdBy', 'status', 'priority', 'merchantId']),
      z.object({
        type: z.literal('formField'),
        fieldId: z.string(),
        fieldName: z.string(),
        fieldType: z.string(),
      }),
    ])
    .optional(),
  showOverdueOnly: z.boolean().optional(),
});
const kanbanCountsBodySchema = kanbanCountsBodyObject.refine(
  body => body.viewMode !== 'desk' || !!body.channelId,
  'channelId is required for desk counts',
);

// A track's tickets span boards, so the track is their scope, not a board or a project.
const trackKanbanCountsBodySchema = kanbanCountsBodyObject
  .omit({ viewMode: true, projectId: true, boardId: true, userId: true, groupId: true })
  .extend({ channelId: z.string(), trackId: z.string() });

export class KanbanTicketController {
  getCounts = async (req: Request, res: Response): Promise<void> => {
    try {
      const workspaceId = req.user?.workspaceId;
      if (!workspaceId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const body = kanbanCountsBodySchema.parse(req.body);
      const counts = await getKanbanCounts({
        ...body,
        workspaceId,
        currentUserId: req.user?.id,
      });

      res.json(counts);
    } catch (error) {
      logger.error('[KanbanTicketController] Failed to fetch Kanban counts:', error);
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Invalid request body', details: error.errors });
        return;
      }

      res.status(500).json({ error: 'Failed to fetch Kanban counts' });
    }
  };

  /** The same counts as getCounts, over the tickets one SDLC track holds. */
  getTrackCounts = async (req: Request, res: Response): Promise<void> => {
    try {
      const workspaceId = req.user?.workspaceId;
      if (!workspaceId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { channelId, trackId, ...body } = trackKanbanCountsBodySchema.parse(req.body);
      const edges = await db.sdlcEntityLink.findMany({
        where: {
          workspaceId,
          channelId,
          sourceType: 'TRACK',
          sourceId: trackId,
          targetType: 'TICKET',
          relationType: SDLC_CONTAINMENT_RELATION,
        },
        select: { targetId: true },
      });
      const counts = await getKanbanCounts(
        { ...body, viewMode: 'board', workspaceId, currentUserId: req.user?.id },
        { id: { in: edges.map(edge => edge.targetId) } },
      );

      res.json(counts);
    } catch (error) {
      logger.error('[KanbanTicketController] Failed to fetch track Kanban counts:', error);
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Invalid request body', details: error.errors });
        return;
      }

      res.status(500).json({ error: 'Failed to fetch Kanban counts' });
    }
  };
}
