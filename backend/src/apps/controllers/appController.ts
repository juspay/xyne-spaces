import { Request, Response } from 'express';
import { z } from 'zod';
import { AccessType } from '@prisma/client';
import { repositories } from '@/database/repositories';
import { CreateAppInput } from '@/database/repositories/appsRepository';
import { logger } from '@/utils/logger';
import { installApp, configureWebhook, regenerateJwt, getSigningSecret } from '../core/appUtils';
import { UserManagementService } from '@/services/userManagementService';

const CreateAppBodySchema = z.object({
  name: z.string().min(1, 'App name cannot be empty').trim(),
  description: z.string().trim().optional(),
});

const AppIdParamsSchema = z.object({
  appId: z.string().min(1, 'App ID is required').trim(),
});

const ProjectIdParamsSchema = z.object({
  projectId: z.string().min(1, 'Project ID is required').trim(),
});

const ConfigureWebhookBodySchema = z.object({
  webhookUrl: z.string().url('Invalid webhook URL format').min(1, 'Webhook URL is required').trim(),
});

export class AppController {

  private async isAclAdmin(userId: string): Promise<boolean> {
    const resource = await repositories.resources.findByName('XYNE-APPS');
    if (!resource) return false;
    return await repositories.resourceAccess.hasAccess(userId, resource.id, AccessType.ADMIN);
  }

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

      const botName = name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-') 
      .replace(/^-|-$/g, '');

      const botEmail = `${botName}@app.xyne.ai`;
      const existingUser = await repositories.users.findByEmail(botEmail, req.user!.workspaceId);
      if (existingUser) {
        res.status(409).json({
          error: `An app with name "${name}" already exists`,
          code: 'DUPLICATE_APP_NAME',
        });
        return;
      }

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
      const workspaceId = req.user?.workspaceId;

      if (!workspaceId) {
        res.status(400).json({
          error: 'Workspace ID is required',
          code: 'WORKSPACE_REQUIRED',
        });
        return;
      }

      // Install the app
      const installedApp = await installApp(appId, workspaceId);

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

  /**
   * Regenerate JWT token for an installed app
   * POST /api/apps/:appId/regenerate-jwt
   */
  regenerateJwt = async (req: Request, res: Response): Promise<void> => {
    try {
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
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({
          error: 'Authentication required',
          code: 'UNAUTHORIZED'
        });
        return;
      }

      const [app, isAdmin] = await Promise.all([
        repositories.apps.findById(appId),
        this.isAclAdmin(userId)
      ]);

      if (!app) {
        res.status(404).json({
          error: 'App not found',
          code: 'NOT_FOUND'
        });
        return;
      }

      if (!isAdmin && app.createdBy !== userId) {
        res.status(403).json({
          error: 'Unauthorized: Only admin or app creator can regenerate JWT',
          code: 'FORBIDDEN'
        });
        return;
      }

      const result = await regenerateJwt(appId);

      res.status(200).json(result);
    } catch (error) {
      logger.error('Error regenerating JWT:', error);

      if (error instanceof Error && error.message.includes('not found')) {
        res.status(404).json({
          error: error.message,
          code: 'INSTALLED_APP_NOT_FOUND',
        });
        return;
      }

      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * Get signing secret for an installed app
   * POST /api/apps/signing-secret/:appId
   * Only app creator or ADMIN can access this.
   */
  getSigningSecret = async (req: Request, res: Response): Promise<void> => {
    try {
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
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({
          error: 'Authentication required',
          code: 'UNAUTHORIZED'
        });
        return;
      }

      const isAdmin = await this.isAclAdmin(userId);
      const result = await getSigningSecret(appId, userId, isAdmin);

      res.status(200).json(result);
    } catch (error) {
      logger.error('Error getting signing secret:', error);

      if (error instanceof Error && error.message.includes('Unauthorized')) {
        res.status(403).json({
          error: error.message,
          code: 'FORBIDDEN',
        });
        return;
      }

      if (error instanceof Error && error.message.includes('not found')) {
        res.status(404).json({
          error: error.message,
          code: 'NOT_FOUND',
        });
        return;
      }

      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * Upload profile picture for bot user
   * POST /api/apps/upload-picture/:appId
   */
  uploadBotPicture = async (req: Request, res: Response): Promise<void> => {
    try {
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
      const file = req.file;

      if (!file) {
        res.status(400).json({ error: 'No file provided' });
        return;
      }

      // Validate file type
      const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
      if (!ALLOWED_TYPES.includes(file.mimetype)) {
        res.status(400).json({ error: 'Invalid file type. Only JPG, PNG, and WebP are allowed.' });
        return;
      }

      // Validate file size (max 5MB)
      const MAX_FILE_SIZE = 5 * 1024 * 1024;
      if (file.size > MAX_FILE_SIZE) {
        res.status(413).json({ error: 'File too large. Maximum size is 5MB.' });
        return;
      }

      // Get the installed app to find the bot user
      const installedApp = await repositories.installedApps.findFirst({
        where: { appId }
      });

      if (!installedApp) {
        res.status(404).json({
          error: 'App is not installed',
          code: 'APP_NOT_INSTALLED'
        });
        return;
      }

      // Upload picture to bot user
      const userManagementService = UserManagementService.getInstance();
      const picturePath = await userManagementService.uploadProfilePicture(installedApp.userId, file);

      res.status(200).json({ picture: picturePath });
    } catch (error) {
      logger.error('Error uploading bot profile picture:', error);
      res.status(500).json({ error: 'Failed to upload profile picture' });
    }
  };

  getBotChannels = async (req: Request, res: Response): Promise<void> => {
    try {
      const paramsResult = AppIdParamsSchema.safeParse(req.params);
      if (!paramsResult.success) {
        res.status(400).json({ error: 'Validation error', code: 'VALIDATION_ERROR' });
        return;
      }

      const { appId } = paramsResult.data;
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const installedApp = await repositories.installedApps.findFirst({
        where: { appId },
      });
      if (!installedApp) {
        res.status(404).json({ error: 'App is not installed', code: 'APP_NOT_INSTALLED' });
        return;
      }

      const participations = await repositories.channelParticipants.getUserChannels(installedApp.userId);
      const channelIds = participations.map(p => p.channelId);
      const requesterChannelIds = await repositories.channelParticipants.getAccessibleChannelIds(channelIds, userId);
      const accessibleChannelIds = channelIds.filter(channelId => requesterChannelIds.has(channelId));
      const channels = await repositories.channels.getChannelsByIds(accessibleChannelIds);

      const result = channels.map(ch => ({
        id: ch.id,
        name: ch.name,
        visibility: ch.visibility,
        projectId: ch.projectId,
      }));

      res.status(200).json({ channels: result });
    } catch (error) {
      logger.error('Error getting bot channels:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  getProjectBoards = async (req: Request, res: Response): Promise<void> => {
    try {
      const paramsResult = ProjectIdParamsSchema.safeParse(req.params);
      if (!paramsResult.success) {
        res.status(400).json({ error: 'Validation error', code: 'VALIDATION_ERROR' });
        return;
      }

      const { projectId } = paramsResult.data;
      const workspaceId = req.user?.workspaceId;
      if (!workspaceId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const boards = await repositories.boards.findBoardsByProject(projectId);
      const scopedBoards = boards.filter(board => board.workspaceId === workspaceId);

      res.status(200).json({
        boards: scopedBoards.map(board => ({
          id: board.id,
          name: board.name,
          projectId: board.projectId,
        })),
      });
    } catch (error) {
      logger.error('Error getting project boards:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}
