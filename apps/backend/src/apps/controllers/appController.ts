import { Request, Response } from 'express';
import { AccessType } from '@xyne/shared';
import { z } from 'zod';
import { repositories } from '@/database/repositories';
import { db } from '@/database/client';
import { CreateAppInput } from '@/database/repositories/appsRepository';
import { logger } from '@/utils/logger';
import { installApp, configureWebhook, regenerateJwt, getSigningSecret } from '../core/appUtils';
import { isValidUrl } from '@/utils/urlUtils';
import { UserManagementService } from '@/services/userManagementService';
import { vespaQueue } from '@/queues/vespaQueue';
import { appSchema } from '@/vespa/src/types';
import { withWorkspaceScope, runAsSystem } from '@/database/tenant/context';

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

      // Resolve the creator's owning org (apps are owned at the org level, created at ORG scope).
      const workspace = await repositories.workspaces.findById(req.user!.workspaceId);
      if (!workspace?.orgId) {
        res.status(400).json({
          error: 'Could not resolve organization for the current workspace',
          code: 'ORG_REQUIRED',
        });
        return;
      }

      // Create app data
      const appData: CreateAppInput = {
        name,
        description,
        createdBy: userId,
        orgId: workspace.orgId,
      };

      // Create the app
      const app = await repositories.apps.createApp(appData);

      // Queue Vespa indexing for the new app (worker fetches + maps by docId).
      vespaQueue
        .addJob({ schema: appSchema, jobType: 'feed', docId: app.id })
        .catch((err) => logger.error(`Failed to queue Vespa feed for app ${app.id}:`, err));

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

      // Eligibility: ORG-scoped apps install only within the owning org; GLOBAL apps install anywhere.
      // (Install is gated to XYNE-APPS admins at the route level.)
      const app = await repositories.apps.findById(appId);
      if (!app) {
        res.status(404).json({ error: 'App not found', code: 'APP_NOT_FOUND' });
        return;
      }
      if (app.scope === 'ORG') {
        const workspace = await repositories.workspaces.findById(workspaceId);
        if (!workspace || workspace.orgId !== app.orgId) {
          res.status(403).json({
            error: 'This app is not available to your workspace',
            code: 'APP_NOT_IN_SCOPE',
          });
          return;
        }
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
   * Promote an app from ORG scope to GLOBAL (marketplace). XYNE-APPS resource admin only.
   * POST /api/apps/promote/:appId
   */
  promoteApp = async (req: Request, res: Response): Promise<void> => {
    try {
      const paramsResult = AppIdParamsSchema.safeParse(req.params);
      if (!paramsResult.success) {
        res.status(400).json({ error: 'Validation error', code: 'VALIDATION_ERROR', details: paramsResult.error.errors });
        return;
      }
      const { appId } = paramsResult.data;
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Authentication required', code: 'UNAUTHORIZED' });
        return;
      }

      const isAdmin = await this.isAclAdmin(userId);
      if (!isAdmin) {
        res.status(403).json({ error: 'Only a XYNE-APPS admin can promote apps to global', code: 'FORBIDDEN' });
        return;
      }

      const app = await repositories.apps.findById(appId);
      if (!app) {
        res.status(404).json({ error: 'App not found', code: 'APP_NOT_FOUND' });
        return;
      }
      if (app.scope === 'GLOBAL') {
        res.status(409).json({ error: 'App is already global', code: 'ALREADY_GLOBAL' });
        return;
      }

      // Ownership: only an admin of the app's OWN org may promote it (not just any XYNE-APPS admin).
      const workspace = await repositories.workspaces.findById(req.user!.workspaceId);
      if (!workspace?.orgId || workspace.orgId !== app.orgId) {
        res.status(403).json({ error: 'You can only promote apps owned by your organization', code: 'FORBIDDEN' });
        return;
      }

      // Promotion is authorised by org ownership above, not by who created the app. The app row
      // carries its creating workspace's id, which for a sibling workspace in the same org is not
      // the caller's — so neither the creator predicate nor workspace scope would match it. Both
      // checks that matter (XYNE-APPS admin, same owning org) have already run above.
      const updated = await runAsSystem(() =>
        repositories.apps.update(appId, { scope: 'GLOBAL' }),
      );
      res.status(200).json(updated);
    } catch (error) {
      logger.error('Error promoting app:', error);
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
      const workspaceId = req.user?.workspaceId;
      if (!workspaceId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const result = await configureWebhook(appId, webhookUrl, workspaceId);

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
   * PATCH /apps/installed/:installedAppId
   * Update the caller's INSTALL (not the template). Edits made from the Installed screen by a
   * workspace admin. Scoped to the caller's workspace via the install's bot-user relation, so
   * one workspace can never edit another's install. Currently supports the outbound webhook URL.
   */
  updateInstalledApp = async (req: Request, res: Response): Promise<void> => {
    try {
      const { installedAppId } = req.params;
      const workspaceId = req.user?.workspaceId;
      if (!installedAppId || !workspaceId) {
        res.status(400).json({ error: 'installedAppId and workspace are required' });
        return;
      }

      const { webhookUrl } = req.body as { webhookUrl?: string };
      if (webhookUrl !== undefined && webhookUrl !== '' && !isValidUrl(webhookUrl)) {
        res.status(400).json({ error: 'Invalid webhook URL format', code: 'INVALID_WEBHOOK_URL' });
        return;
      }

      // Ownership check: the install must belong to the caller's workspace (via bot user).
      const install = await repositories.installedApps.findFirst({
        where: { id: installedAppId, user: { workspaceId } },
      });
      if (!install) {
        res.status(404).json({ error: 'Installed app not found in this workspace', code: 'INSTALLED_APP_NOT_FOUND' });
        return;
      }

      const updated = await repositories.installedApps.update(install.id, {
        webhookUrl: webhookUrl === undefined ? install.webhookUrl : webhookUrl.trim() || null,
      });
      res.status(200).json({ webhookUrl: updated.webhookUrl });
    } catch (error) {
      logger.error('Error updating installed app:', error);
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

      const workspaceId = req.user?.workspaceId;
      if (!workspaceId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const result = await regenerateJwt(appId, workspaceId);

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

  /**
   * POST /apps/org-names
   * Resolve org ids -> org names for app attribution. Done server-side because the client only
   * syncs its own org (org-scoped ACL), so it can't resolve a cross-org app's origin (marketplace).
   * Org names aren't sensitive and only the ids the caller asks about are returned.
   * Body: { orgIds: string[] } -> { orgNames: Record<orgId, name> }
   */
  getOrgNames = async (req: Request, res: Response): Promise<void> => {
    try {
      const { orgIds } = req.body as { orgIds?: unknown };
      if (!Array.isArray(orgIds) || orgIds.some(id => typeof id !== 'string')) {
        res.status(400).json({ error: 'orgIds must be an array of strings' });
        return;
      }
      const ids = Array.from(new Set(orgIds as string[])).filter(Boolean);
      if (ids.length === 0) {
        res.status(200).json({ orgNames: {} });
        return;
      }
      // Resolves names for the requested orgs, which may include the app's origin org.
      const orgs = await withWorkspaceScope(() =>
        db.organization.findMany({
          where: { orgId: { in: ids } },
          select: { orgId: true, name: true },
        }),
      );
      const orgNames: Record<string, string> = {};
      for (const o of orgs) orgNames[o.orgId] = o.name;
      res.status(200).json({ orgNames });
    } catch (error) {
      logger.error('Error resolving org names:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}
