import { Request, Response } from 'express';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { repositories } from '../database/repositories';
import { 
  CreateToolInput,
  UpdateToolInput
} from '../types/database';
import {logger} from '@/utils/logger';

export class ToolController {

  createTool = async (req: Request, res: Response): Promise<void> => {
    try {
      const toolData: CreateToolInput = req.body;

      if (!toolData.name) {
        res.status(400).json({ 
          error: 'Missing required field: name is required' 
        });
        return;
      }

      const tool = await repositories.tools.create(toolData);
      res.status(201).json(tool);
    } catch (error) {
      logger.error('Error creating tool:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  getToolById = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const includeAgents = req.query.includeAgents === 'true';

      let tool;
      
      if (includeAgents) {
        tool = await repositories.tools.findWithAgents(id);
      } else {
        tool = await repositories.tools.findById(id);
      }

      if (!tool) {
        res.status(404).json({ error: 'Tool not found' });
        return;
      }

      res.status(200).json(tool);
    } catch (error) {
      logger.error('Error getting tool:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  getToolByName = async (req: Request, res: Response): Promise<void> => {
    try {
      const { name } = req.params;
      const workspaceId = req.user?.workspaceId;

      if (!workspaceId) {
        res.status(400).json({ error: 'Missing workspaceId' });
        return;
      }

      const tool = await repositories.tools.findByName(name, workspaceId);

      if (!tool) {
        res.status(404).json({ error: 'Tool not found' });
        return;
      }

      res.status(200).json(tool);
    } catch (error) {
      logger.error('Error getting tool by name:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  getAllTools = async (req: Request, res: Response): Promise<void> => {
    try {
      const page = req.query.page ? parseInt(req.query.page as string) : 1;
      const pageSize = req.query.pageSize ? parseInt(req.query.pageSize as string) : 10;
      const search = req.query.search as string;
      const status = req.query.status as string;

      if (page < 1) {
        res.status(400).json({ error: 'Page must be greater than 0' });
        return;
      }

      if (pageSize < 1 || pageSize > 100) {
        res.status(400).json({ error: 'PageSize must be between 1 and 100' });
        return;
      }

      let tools;

      if (search) {
        tools = await repositories.tools.findBySearch(search);
        res.status(200).json({
          data: tools,
          pagination: {
            page: 1,
            pageSize: tools.length,
            total: tools.length,
            totalPages: 1
          }
        });
      } else {
        const where: any = {};
        if (status) where.status = status;

        const skip = (page - 1) * pageSize;
        const take = pageSize;

        const [data, total] = await Promise.all([
          repositories.tools.findMany({
            skip,
            take,
            where: Object.keys(where).length > 0 ? where : undefined,
            orderBy: { createdAt: 'desc' }
          }),
          repositories.tools.findMany({ where: Object.keys(where).length > 0 ? where : undefined }).then(results => results.length)
        ]);

        const totalPages = Math.ceil(total / pageSize);

        res.status(200).json({
          data,
          pagination: {
            page,
            pageSize,
            total,
            totalPages
          }
        });
      }
    } catch (error) {
      logger.error('Error getting all tools:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  updateTool = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const updateData: UpdateToolInput = req.body;

      const existingTool = await repositories.tools.findById(id);
      if (!existingTool) {
        res.status(404).json({ error: 'Tool not found' });
        return;
      }

      const updatedTool = await repositories.tools.update(id, updateData);
      res.status(200).json(updatedTool);
    } catch (error) {
      logger.error('Error updating tool:', error);
      
      if (error instanceof PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          const target = error.meta?.target as string[];
          if (target && target.includes('name')) {
            res.status(409).json({ 
              error: 'A tool with this name already exists',
              code: 'DUPLICATE_NAME'
            });
            return;
          }
        }
      }
      
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  getToolsByStatus = async (req: Request, res: Response): Promise<void> => {
    try {
      const { status } = req.params;

      const tools = await repositories.tools.findByStatus(status);
      res.status(200).json(tools);
    } catch (error) {
      logger.error('Error getting tools by status:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  getEnabledTools = async (_req: Request, res: Response): Promise<void> => {
    try {
      const tools = await repositories.tools.findEnabledTools();
      res.status(200).json(tools);
    } catch (error) {
      logger.error('Error getting enabled tools:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}
