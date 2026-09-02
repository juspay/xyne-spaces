import { Request, Response } from 'express';
import { flowStepVisibilitySchemaShape, TicketPriority } from '@xyne/shared';
import { z } from 'zod';
import { getKanbanCounts } from '@/services/tickets/kanbanCountsService';
import { logger } from '@/utils/logger';

const kanbanCountsBodySchema = z.object({
  viewMode: z.enum(['project', 'board', 'my-tickets', 'user-tickets', 'group-tickets']),
  columnType: z.enum(['stage', 'status']).optional(),
  projectId: z.string().optional(),
  boardId: z.string().optional(),
  boardIds: z.array(z.string()).optional(),
  userId: z.string().optional(),
  groupId: z.string().optional(),
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
      z.enum(['none', 'assignee', 'status', 'priority', 'createdBy']),
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
}
