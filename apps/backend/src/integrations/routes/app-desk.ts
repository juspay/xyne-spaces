import express, { Request, Response } from 'express';
import { AppPermissionStatus, AppPermissionType, ChannelType } from '@xyne/shared';
import { authV2Middleware } from '@/middleware/authV2Middleware';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { appDeskService } from '@/services/appDeskService';
import { resolveAppDeskInstalledAppId } from '@/integrations/core/deskSources';

const TAG = '[AppDesk]';
const APPROVED_STATUSES = [AppPermissionStatus.APPROVED, AppPermissionStatus.PENDINGDELETE];

const router = express.Router();

router.use(express.json());

async function authorizeAppDeskManager(
  channelId: string,
  userId: string,
  res: Response,
): Promise<string | null> {
  const channel = await db.channel.findUnique({
    where: { id: channelId },
    select: { id: true, createdBy: true, type: true },
  });

  if (!channel) {
    res.status(404).json({ error: 'Channel not found' });
    return null;
  }
  if (channel.type !== ChannelType.APP) {
    res.status(400).json({ error: 'Channel is not a Xyne App desk' });
    return null;
  }

  if (channel.createdBy !== userId) {
    const pref = await db.emailChannelPreference.findUnique({
      where: { channelId },
      select: { ownerUserId: true },
    });
    if (pref?.ownerUserId !== userId) {
      res.status(403).json({ error: 'Only the desk owner can manage this integration' });
      return null;
    }
  }
  return channel.id;
}

router.get('/apps', authV2Middleware.authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const workspaceId = req.user!.workspaceId!;

    const installedApps = await db.installedApps.findMany({
      where: {
        user: { workspaceId },
        installedAppPermissions: {
          some: {
            status: { in: APPROVED_STATUSES },
            permission: { name: 'desk', type: AppPermissionType.WRITE },
          },
        },
      },
      select: {
        id: true,
        appId: true,
        app: { select: { name: true, description: true } },
      },
    });

    const appDeskSources = await db.externalSource.findMany({
      where: { sourceType: 'app-desk', isActive: true, workspaceId },
      select: { name: true, externalIdentifier: true },
    });
    const deskCountByInstall = new Map<string, number>();
    for (const source of appDeskSources) {
      const installedAppId = resolveAppDeskInstalledAppId(source);
      if (!installedAppId) continue;
      deskCountByInstall.set(installedAppId, (deskCountByInstall.get(installedAppId) ?? 0) + 1);
    }

    const eligible = installedApps.map(a => ({
      installedAppId: a.id,
      appId: a.appId,
      name: a.app.name,
      description: a.app.description,
      deskCount: deskCountByInstall.get(a.id) ?? 0,
    }));

    res.json({ apps: eligible });
  } catch (error) {
    logger.error(`${TAG} Error listing eligible apps`, { error });
    res.status(500).json({ error: 'Failed to list apps' });
  }
});


router.post('/:conversationId/reply', authV2Middleware.authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { conversationId } = req.params;
    const { body, attachmentIds } = req.body as { body?: string; attachmentIds?: string[] };
    const userId = req.user!.id;

    const ids = Array.isArray(attachmentIds) ? attachmentIds : [];
    if ((!body || typeof body !== 'string' || body.trim().length === 0) && ids.length === 0) {
      res.status(400).json({ error: 'body or at least one attachment is required' });
      return;
    }

    const result = await appDeskService.sendAppReply({
      conversationId,
      body: (body ?? '').trim(),
      userId,
      attachmentIds: ids,
    });

    res.json(result);
  } catch (error) {
    logger.error(`${TAG} Error sending app reply`, { error });
    const message = error instanceof Error ? error.message : 'Failed to send app reply';
    res.status(500).json({ error: message });
  }
});

router.post(
  '/:channelId/disconnect',
  authV2Middleware.authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { channelId } = req.params;
      const userId = req.user!.id;

      const authorized = await authorizeAppDeskManager(channelId, userId, res);
      if (!authorized) return;

      const source = await db.externalSource.findFirst({
        where: { channelId, sourceType: 'app-desk', isActive: true },
        select: { id: true },
      });
      if (!source) {
        res.status(404).json({ error: 'No active integration found for this channel' });
        return;
      }

      await db.externalSource.update({ where: { id: source.id }, data: { isActive: false } });
      logger.info(`${TAG} App desk disconnected`, { channelId, sourceId: source.id });
      res.json({ message: 'Xyne App desk disconnected' });
    } catch (error) {
      logger.error(`${TAG} Error disconnecting app desk`, { error });
      res.status(500).json({ error: 'Failed to disconnect app desk' });
    }
  },
);

router.post(
  '/:channelId/reconnect',
  authV2Middleware.authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { channelId } = req.params;
      const userId = req.user!.id;

      const authorized = await authorizeAppDeskManager(channelId, userId, res);
      if (!authorized) return;

      const source = await db.externalSource.findFirst({
        where: { channelId, sourceType: 'app-desk', isActive: false },
        orderBy: { createdAt: 'desc' },
        select: { id: true, name: true, externalIdentifier: true },
      });
      if (!source) {
        res.status(404).json({ error: 'No disconnected integration found for this channel' });
        return;
      }

      const installedAppId = resolveAppDeskInstalledAppId(source);
      if (!installedAppId) {
        res.status(400).json({ error: 'App-desk source is missing its backing install' });
        return;
      }
      const installedApp = await db.installedApps.findFirst({
        where: {
          id: installedAppId,
          installedAppPermissions: {
            some: {
              status: { in: APPROVED_STATUSES },
              permission: { name: 'desk', type: AppPermissionType.WRITE },
            },
          },
        },
        select: { id: true },
      });
      if (!installedApp) {
        res.status(400).json({
          error: 'The app backing this desk is no longer installed or has lost desk:write access',
        });
        return;
      }

      await db.externalSource.update({ where: { id: source.id }, data: { isActive: true } });
      logger.info(`${TAG} App desk reconnected`, { channelId, sourceId: source.id, installedAppId });
      res.json({ message: 'Xyne App desk reconnected' });
    } catch (error) {
      logger.error(`${TAG} Error reconnecting app desk`, { error });
      res.status(500).json({ error: 'Failed to reconnect app desk' });
    }
  },
);

export default router;
