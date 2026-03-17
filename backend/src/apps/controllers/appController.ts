import { Request, Response } from 'express';
import { z } from 'zod';
import { repositories } from '@/database/repositories';
import { CreateAppInput } from '@/database/repositories/appsRepository';
import { logger } from '@/utils/logger';
import { installApp, configureWebhook } from '../core/appUtils';

const CreateAppBodySchema = z.object({
  name: z.string().min(1, 'App name cannot be empty').trim(),
  description: z.string().trim().optional(),
});

const AppIdParamsSchema = z.object({
  appId: z.string().min(1, 'App ID is required').trim(),
});

const ConfigureWebhookBodySchema = z.object({
  webhookUrl: z.string().url('Invalid webhook URL format').min(1, 'Webhook URL is required').trim(),
});

export class AppController {
  /**
   * Create a new app
   * POST /api/apps
   */
  createApp = async (req: Request, res: Response): Promise<void> => {
    try {
      // Validate request body with Zod
      const bodyResult = CreateAppBodySchema.safeParse(req.body);
      
      if (!bodyResult.success) {
        res.status(400).json({ 
          error: `Validation error`,
          code: 'VALIDATION_ERROR',
          details: bodyResult.error.errors
        });
        return;
      }

      const { name, description } = bodyResult.data;

      // Get user ID from request (should be set by auth middleware)
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ 
          error: 'Authentication required',
          code: 'UNAUTHORIZED'
        });
        return;
      }

      // Create app data
      const appData: CreateAppInput = {
        name,
        description,
        createdBy: userId,
      };

      // Create the app
      const app = await repositories.apps.createApp(appData);

      res.status(201).json(app);
    } catch (error) {
      logger.error('Error creating external app:', error);

      // Handle duplicate name error
      if (error instanceof Error && error.message.includes('already exists')) {
        res.status(409).json({
          error: error.message,
          code: 'DUPLICATE_APP_NAME',
        });
        return;
      }

      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * Install an app
   * POST /api/apps/:appId/install
   */
  installApp = async (req: Request, res: Response): Promise<void> => {
    try {
      // Validate params with Zod
      const paramsResult = AppIdParamsSchema.safeParse(req.params);
      
      if (!paramsResult.success) {
        res.status(400).json({ 
          error: `Validation error`,
          code: 'VALIDATION_ERROR',
          details: paramsResult.error.errors
        });
        return;
      }

      const { appId } = paramsResult.data;

      // Install the app
      const installedApp = await installApp(appId);

      res.status(201).json(installedApp);
    } catch (error) {
      logger.error('Error installing external app:', error);

      // Handle app not found error
      if (error instanceof Error && error.message.includes('not found')) {
        res.status(404).json({
          error: error.message,
          code: 'APP_NOT_FOUND',
        });
        return;
      }

      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * Configure webhook URL for an installed app
   * POST /api/apps/:appId/configureWebhook
   */
  configureWebhook = async (req: Request, res: Response): Promise<void> => {
    try {
      const paramsResult = AppIdParamsSchema.safeParse(req.params);
      
      if (!paramsResult.success) {
        res.status(400).json({ 
          error: `Validation error`,
          code: 'VALIDATION_ERROR',
        });
        return;
      }

      const bodyResult = ConfigureWebhookBodySchema.safeParse(req.body);
      
      if (!bodyResult.success) {
        res.status(400).json({ 
          error: `Validation error`,
          code: 'VALIDATION_ERROR',
        });
        return;
      }
      const { appId } = paramsResult.data;
      const { webhookUrl } = bodyResult.data;
      const result = await configureWebhook(appId, webhookUrl);

      res.status(200).json(result);
    } catch (error) {
      logger.error('Error configuring webhook:', error);

      if (error instanceof Error && error.message.includes('not found')) {
        res.status(404).json({
          error: error.message,
          code: 'INSTALLED_APP_NOT_FOUND',
        });
        return;
      }

      if (error instanceof Error && error.message.includes('Invalid webhook URL')) {
        res.status(400).json({
          error: error.message,
          code: 'INVALID_WEBHOOK_URL',
        });
        return;
      }

      res.status(500).json({ error: 'Internal server error' });
    }
  };
}
