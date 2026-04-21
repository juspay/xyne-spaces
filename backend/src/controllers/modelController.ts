import { Request, Response } from 'express';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { repositories } from '../database/repositories';
import { modelSyncService } from '../services/modelSyncService';
import { 
  CreateModelInput,
  UpdateModelInput
} from '../types/database';
import {logger} from '@/utils/logger';

export class ModelController {

  createModel = async (req: Request, res: Response): Promise<void> => {
    try {
      const modelData: CreateModelInput = req.body;

      if (!modelData.userDefinedId || !modelData.name || !modelData.provider || !modelData.credentials) {
        res.status(400).json({ 
          error: 'Missing required fields: userDefinedId, name, provider, and credentials are required' 
        });
        return;
      }

      const model = await repositories.models.create(modelData);
      res.status(201).json(model);
    } catch (error) {
      logger.error('Error creating model:', error);
      
      if (error instanceof PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          const target = error.meta?.target as string[];
          if (target && target.includes('userDefinedId')) {
            res.status(409).json({ 
              error: 'A model with this userDefinedId already exists',
              code: 'DUPLICATE_USER_DEFINED_ID'
            });
            return;
          }
        }
      }
      
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  getModelById = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const includeAgents = req.query.includeAgents === 'true';

      let model;
      
      if (includeAgents) {
        model = await repositories.models.findWithAgents(id);
      } else {
        model = await repositories.models.findById(id);
      }

      if (!model) {
        res.status(404).json({ error: 'Model not found' });
        return;
      }

      res.status(200).json(model);
    } catch (error) {
      logger.error('Error getting model:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  getModelByUserDefinedId = async (req: Request, res: Response): Promise<void> => {
    try {
      const { userDefinedId } = req.params;

      const model = await repositories.models.findByUserDefinedId(userDefinedId);

      if (!model) {
        res.status(404).json({ error: 'Model not found' });
        return;
      }

      res.status(200).json(model);
    } catch (error) {
      logger.error('Error getting model by userDefinedId:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  getAllModels = async (req: Request, res: Response): Promise<void> => {
    try {
      const page = req.query.page ? parseInt(req.query.page as string) : 1;
      const pageSize = req.query.pageSize ? parseInt(req.query.pageSize as string) : 10;
      const search = req.query.search as string;
      const provider = req.query.provider as string;
      const name = req.query.name as string;

      if (page < 1) {
        res.status(400).json({ error: 'Page must be greater than 0' });
        return;
      }

      if (pageSize < 1 || pageSize > 100) {
        res.status(400).json({ error: 'PageSize must be between 1 and 100' });
        return;
      }

      let models;

      if (search) {
        models = await repositories.models.findBySearch(search);
        res.status(200).json({
          data: models,
          pagination: {
            page: 1,
            pageSize: models.length,
            total: models.length,
            totalPages: 1
          }
        });
      } else {
        const where: any = {};
        if (provider) where.provider = provider;
        if (name) where.name = { contains: name, mode: 'insensitive' };

        const skip = (page - 1) * pageSize;
        const take = pageSize;

        const [data, total] = await Promise.all([
          repositories.models.findMany({
            skip,
            take,
            where: Object.keys(where).length > 0 ? where : undefined,
            orderBy: { createdAt: 'desc' }
          }),
          repositories.models.findMany({ where: Object.keys(where).length > 0 ? where : undefined }).then(results => results.length)
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
      logger.error('Error getting all models:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  updateModel = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const updateData: UpdateModelInput = req.body;

      const existingModel = await repositories.models.findById(id);
      if (!existingModel) {
        res.status(404).json({ error: 'Model not found' });
        return;
      }

      const updatedModel = await repositories.models.update(id, updateData);
      res.status(200).json(updatedModel);
    } catch (error) {
      logger.error('Error updating model:', error);
      
      if (error instanceof PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          const target = error.meta?.target as string[];
          if (target && target.includes('userDefinedId')) {
            res.status(409).json({ 
              error: 'A model with this userDefinedId already exists',
              code: 'DUPLICATE_USER_DEFINED_ID'
            });
            return;
          }
        }
      }
      
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  getModelsByProvider = async (req: Request, res: Response): Promise<void> => {
    try {
      const { provider } = req.params;

      const models = await repositories.models.findByProvider(provider);
      res.status(200).json(models);
    } catch (error) {
      logger.error('Error getting models by provider:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  getModelsByName = async (req: Request, res: Response): Promise<void> => {
    try {
      const { name } = req.params;
      const workspaceId = req.user?.workspaceId;

      if (!workspaceId) {
        res.status(400).json({ error: 'Missing workspaceId' });
        return;
      }

      const models = await repositories.models.findByName(name, workspaceId);
      res.status(200).json(models);
    } catch (error) {
      logger.error('Error getting models by name:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  syncModelsWithLiteLLM = async (_req: Request, res: Response): Promise<void> => {
    try {
      logger.info('Manual model sync triggered via API');
      await modelSyncService.syncWithLiteLLM();
      res.status(200).json({ message: 'Model sync completed successfully' });
    } catch (error) {
      logger.error('Error syncing models with LiteLLM:', error);
      res.status(500).json({
        error: 'Failed to sync models with LiteLLM',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };
}
