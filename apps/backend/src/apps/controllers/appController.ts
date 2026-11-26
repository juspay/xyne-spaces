import { Request, Response } from 'express';
import { z } from 'zod';
import { repositories } from '@/database/repositories';
import { logger } from '@/utils/logger';
import { UserManagementService } from '@/services/userManagementService';

const AppIdParamsSchema = z.object({
  appId: z.string().min(1, 'App ID is required').trim() });

export class AppController {


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
          details: paramsResult.error.issues
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

      // Get THIS workspace's install (the bot user is per-install). Scope by the caller's
      // workspace so we never edit another workspace's bot. Guard workspaceId — an undefined
      // filter would un-scope the query.
      const workspaceId = req.user?.workspaceId;
      if (!workspaceId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const installedApp = await repositories.installedApps.findFirst({
        where: { appId, user: { workspaceId } }
      });

      if (!installedApp) {
        res.status(404).json({
          error: 'App is not installed in this workspace',
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

}
