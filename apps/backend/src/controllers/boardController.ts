import { Request, Response } from 'express';
import {
  BoardType,
  FLOW_STAGE_NAMES,
  FlowPlanSchema,
  TicketStatusV2,
  validateFlowPlan,
  type FlowPlan,
} from '@xyne/shared';
import { validateFlowDecisionFieldsWithPrisma } from '@/services/flowDecisionFieldValidator';
import { BoardRepository } from '../database/repositories/boardRepository';
import { ProjectRepository } from '../database/repositories/projectRepository';
import { logger } from '@/utils/logger';

export class BoardController {
  private boardRepository: BoardRepository;
  private projectRepository: ProjectRepository;

  constructor() {
    this.boardRepository = new BoardRepository();
    this.projectRepository = new ProjectRepository();
  }

  createBoard = async (req: Request, res: Response): Promise<void> => {
    try {
      const { name, description, projectId, stages, boardType, metadata, flowPlan } = req.body;
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      if (!name || typeof name !== 'string' || name.trim() === '') {
        res.status(400).json({ error: 'Board name is required' });
        return;
      }

      if (!projectId || typeof projectId !== 'string' || projectId.trim() === '') {
        res.status(400).json({ error: 'Project ID is required' });
        return;
      }

      // Verify project exists
      const project = await this.projectRepository.findById(projectId.trim());
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      const workspaceId = project.workspaceId;

      // Validate stages if provided
      if (stages && Array.isArray(stages)) {
        for (const stage of stages) {
          if (!stage.name || !stage.name.trim()) {
            res.status(400).json({ error: 'All stages must have a name' });
            return;
          }
          // ETA is optional - only validate if provided
          if (stage.eta !== undefined && (typeof stage.eta !== 'number' || stage.eta <= 0)) {
            res.status(400).json({ error: 'If provided, ETA must be a valid positive number' });
            return;
          }
          if (typeof stage.sequenceNumber !== 'number' || stage.sequenceNumber <= 0) {
            res.status(400).json({ error: 'All stages must have a valid sequence number' });
            return;
          }
        }
      }

      let effectiveStages = stages;
      let effectiveFlowPlan: FlowPlan | undefined;
      if (boardType === BoardType.FLOW) {
        if (stages && stages.length > 0) {
          res.status(400).json({ error: 'Flow boards do not support custom stages' });
          return;
        }
        const parsedPlan = FlowPlanSchema.safeParse(flowPlan);
        if (!parsedPlan.success) {
          res.status(400).json({ error: 'Flow boards require a valid flowPlan' });
          return;
        }
        try {
          validateFlowPlan(parsedPlan.data);
          await validateFlowDecisionFieldsWithPrisma(parsedPlan.data);
        } catch (error) {
          res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid flow plan' });
          return;
        }
        effectiveFlowPlan = parsedPlan.data;
        effectiveStages = [
          { name: FLOW_STAGE_NAMES.TODO, sequenceNumber: 1, defaultTicketStatusV2: TicketStatusV2.TODO },
          { name: FLOW_STAGE_NAMES.STARTED, sequenceNumber: 2, defaultTicketStatusV2: TicketStatusV2.STARTED },
          { name: FLOW_STAGE_NAMES.PAUSED, sequenceNumber: 3, defaultTicketStatusV2: TicketStatusV2.PAUSED },
          { name: FLOW_STAGE_NAMES.BACKLOG, sequenceNumber: 4, defaultTicketStatusV2: TicketStatusV2.PAUSED },
          { name: FLOW_STAGE_NAMES.COMPLETED, sequenceNumber: 5, defaultTicketStatusV2: TicketStatusV2.COMPLETED },
          { name: FLOW_STAGE_NAMES.CANCELLED, sequenceNumber: 6, defaultTicketStatusV2: TicketStatusV2.CANCELLED },
        ];
      }

      // Check for duplicate name within the project
      const isDuplicate = await this.boardRepository.checkDuplicateName(name.trim(), projectId.trim());
      if (isDuplicate) {
        res.status(409).json({ error: `Board with name '${name.trim()}' already exists in this project` });
        return;
      }

      const board = await this.boardRepository.createWithStages({
        name: name.trim(),
        description: description?.trim(),
        projectId: projectId.trim(),
        workspaceId: workspaceId,
        createdBy: userId,
        stages: effectiveStages && effectiveStages.length > 0 ? effectiveStages : undefined,
        boardType: boardType || BoardType.DEFAULT,
        ...(metadata !== undefined && { metadata }),
        ...(effectiveFlowPlan !== undefined && { flowPlan: effectiveFlowPlan }),
      });

      res.status(201).json({
        success: true,
        message: 'Board created successfully',
        board: {
          id: board.id,
          name: board.name,
          description: board.description,
          boardType: board.boardType,
          projectId: board.projectId,
          createdBy: board.createdBy,
          createdAt: board.createdAt,
          metadata: board.metadata,
          flowPlan: board.flowPlan,
          stages: board.stages?.map((stage) => ({
            id: stage.id,
            name: stage.name,
            eta: stage.eta,
            sequenceNumber: stage.sequenceNumber,
            prStatuses: stage.prStatuses || [],
            createdAt: stage.createdAt,
          })),
        },
      });
    } catch (error) {
      logger.error('Error creating board:', error);

      if (error instanceof Error && error.message.includes('already exists')) {
        res.status(409).json({ error: error.message });
        return;
      }

      res.status(500).json({ error: 'Internal server error' });
    }
  };
}
