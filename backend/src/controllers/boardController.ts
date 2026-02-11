import { Request, Response } from 'express';
import { BoardType } from '@prisma/client';
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
      const { name, projectId, stages, boardType } = req.body;
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

      // Validate stages if provided
      if (stages && Array.isArray(stages)) {
        for (const stage of stages) {
          if (!stage.name || !stage.name.trim()) {
            res.status(400).json({ error: 'All stages must have a name' });
            return;
          }
          if (typeof stage.eta !== 'number' || stage.eta <= 0) {
            res.status(400).json({ error: 'All stages must have a valid ETA (hours)' });
            return;
          }
          if (typeof stage.sequenceNumber !== 'number' || stage.sequenceNumber <= 0) {
            res.status(400).json({ error: 'All stages must have a valid sequence number' });
            return;
          }
        }
      }

      // Check for duplicate name
      const isDuplicate = await this.boardRepository.checkDuplicateName(name.trim());
      if (isDuplicate) {
        res.status(409).json({ error: `Board with name '${name.trim()}' already exists` });
        return;
      }

      const board = await this.boardRepository.createWithStages({
        name: name.trim(),
        projectId: projectId.trim(),
        createdBy: userId,
        stages: stages && stages.length > 0 ? stages : undefined,
        boardType: boardType || BoardType.DEFAULT,
      });

      res.status(201).json({
        success: true,
        message: 'Board created successfully',
        board: {
          id: board.id,
          name: board.name,
          boardType: board.boardType,
          projectId: board.projectId,
          createdBy: board.createdBy,
          createdAt: board.createdAt,
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
