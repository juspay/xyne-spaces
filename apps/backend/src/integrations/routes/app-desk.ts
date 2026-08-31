import express, { Request, Response } from 'express';
import { AppPermissionStatus, AppPermissionType, ChannelRole, ChannelType, isDeskChannelType } from '@xyne/shared';
import { authV2Middleware } from '@/middleware/authV2Middleware';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { appDeskService } from '@/services/appDeskService';
import { resolveAppDeskInstalledAppId } from '@/integrations/core/deskSources';
import { ExternalSourceRepository } from '@/database/repositories/externalSourceRepository';
import { ChannelParticipantRepository } from '@/database/repositories/channelParticipantRepository';
import { validateZod } from '@/middleware/validation';
import { z } from 'zod';

const TAG = '[AppDesk]';
const APPROVED_STATUSES = [AppPermissionStatus.APPROVED, AppPermissionStatus.PENDINGDELETE];

const router = express.Router();
const externalSourceRepository = new ExternalSourceRepository();
const channelParticipantRepository = new ChannelParticipantRepository();

router.use(express.json());

async function authorizeAppDeskManager(
  channelId: string,
  userId: string,
  workspaceId: string,
  res: Response,
): Promise<{ id: string; name: string; type: string } | null> {
  const channel = await db.channel.findUnique({
    where: { id: channelId },
    select: { id: true, name: true, createdBy: true, type: true, workspaceId: true },
  });

  // 404 on workspace mismatch too — don't leak cross-workspace channel existence.
  if (!channel || channel.workspaceId !== workspaceId) {
    res.status(404).json({ error: 'Channel not found' });
    return null;
  }
  if (!isDeskChannelType(channel.type)) {
    res.status(400).json({ error: 'Channel is not a desk channel' });
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
  return channel;
}

type DeskInstall = { id: string; userId: string; app: { name: string } };
type DeskInstallResult =
  | { ok: true; installedApp: DeskInstall }
  | { ok: false; error: { status: number; message: string } };

/** Mirrors channelController's APP-channel validation: workspace-local install + effective desk:WRITE grant. */
async function findDeskWritableInstall(
  installedAppId: string,
  workspaceId: string,
): Promise<DeskInstallResult> {
  const installedApp = await db.installedApps.findUnique({
    where: { id: installedAppId },
    select: { id: true, userId: true, app: { select: { name: true } }, user: { select: { workspaceId: true } } },
  });
  if (!installedApp || installedApp.user.workspaceId !== workspaceId) {
    return { ok: false, error: { status: 404, message: 'App is not installed in this workspace' } };
  }
  const hasDeskWrite = await db.installedAppPermission.findFirst({
    where: {
      installedAppId,
      status: { in: APPROVED_STATUSES },
      permission: { name: 'desk', type: AppPermissionType.WRITE },
    },
    select: { id: true },
  });
  if (!hasDeskWrite) {
    return {
      ok: false,
      error: { status: 403, message: 'App must have the desk:write permission to back a desk' },
    };
  }
  return { ok: true, installedApp };
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

    // This route delivers agent-authored content to a third-party webhook, and it
    // now reaches conversations on any desk channel — so it must prove the caller
    // belongs to the conversation's workspace and channel before routing anything.
    const conversation = await db.conversation.findFirst({
      where: { conversationId, channel: { workspaceId: req.user!.workspaceId! } },
      select: { channelId: true },
    });
    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }
    const participant = await db.channelParticipant.findFirst({
      where: { channelId: conversation.channelId, userId },
      select: { id: true },
    });
    if (!participant) {
      res.status(403).json({ error: 'You do not have access to this channel' });
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

interface ConnectedAppEntry {
  sourceId: string;
  installedAppId: string;
  appName: string | null;
  isActive: boolean;
  createdAt: Date;
}

async function listConnectedApps(channelId: string): Promise<ConnectedAppEntry[]> {
  const sources = await externalSourceRepository.listChannelAppSources(channelId);
  const installedAppIds = sources
    .map(resolveAppDeskInstalledAppId)
    .filter((id): id is string => Boolean(id));

  const installedApps = installedAppIds.length
    ? await db.installedApps.findMany({
        where: { id: { in: installedAppIds } },
        select: { id: true, app: { select: { name: true } } },
      })
    : [];
  const appNameByInstallId = new Map(installedApps.map(a => [a.id, a.app.name]));

  return sources.flatMap(source => {
    const installedAppId = resolveAppDeskInstalledAppId(source);
    if (!installedAppId) return [];
    return [{
      sourceId: source.id,
      installedAppId,
      appName: appNameByInstallId.get(installedAppId) ?? null,
      isActive: source.isActive,
      createdAt: source.createdAt,
    }];
  });
}

router.get(
  '/channels/:channelId/apps',
  authV2Middleware.authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { channelId } = req.params;
      const channel = await authorizeAppDeskManager(
        channelId, req.user!.id, req.user!.workspaceId!, res,
      );
      if (!channel) return;

      res.json({ success: true, apps: await listConnectedApps(channelId) });
    } catch (error) {
      logger.error(`${TAG} Error listing connected apps`, { error });
      res.status(500).json({ success: false, error: 'Failed to list connected apps' });
    }
  },
);

const ConnectAppBodySchema = z.object({
  installedAppId: z.string().trim().min(1),
});

router.post(
  '/channels/:channelId/apps',
  authV2Middleware.authenticate,
  validateZod(ConnectAppBodySchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { channelId } = req.params;
      const { installedAppId } = req.body as z.infer<typeof ConnectAppBodySchema>;

      const channel = await authorizeAppDeskManager(
        channelId, req.user!.id, req.user!.workspaceId!, res,
      );
      if (!channel) return;

      const validation = await findDeskWritableInstall(installedAppId, req.user!.workspaceId!);
      if (!validation.ok) {
        res.status(validation.error.status).json({ success: false, error: validation.error.message });
        return;
      }

      const { source, outcome } = await externalSourceRepository.connectAppToChannel({
        channelId,
        installedAppId,
        workspaceId: req.user!.workspaceId!,
        displayName: channel.name,
      });

      // The binding alone is not enough to let the app post. Inbound runs through
      // validateChannelAccessForPost, and ChannelsACL only exposes a channel that
      // is PUBLIC or that the caller participates in — so without this the app's
      // bot user cannot even see a private desk and every push 404s. Mirrors the
      // legacy APP-channel creation path (channelController.ts). Idempotent, and
      // deliberately runs before the already-connected check so that re-POSTing
      // repairs bindings created before this was added.
      await channelParticipantRepository.addParticipant(
        channelId,
        validation.installedApp.userId,
        ChannelRole.MEMBER,
      );

      if (outcome === 'already-connected') {
        res.status(409).json({ success: false, error: 'App is already connected to this channel' });
        return;
      }

      logger.info(`${TAG} App connected to desk channel`, {
        channelId, installedAppId, sourceId: source.id, outcome,
      });
      res.status(outcome === 'created' ? 201 : 200).json({
        success: true,
        app: {
          sourceId: source.id,
          installedAppId,
          appName: validation.installedApp.app.name,
          isActive: true,
          createdAt: source.createdAt,
        },
      });
    } catch (error) {
      // Concurrent connect raced the unique name — treat as an existing binding.
      if ((error as { code?: string })?.code === 'P2002') {
        res.status(409).json({ success: false, error: 'App is already connected to this channel' });
        return;
      }
      logger.error(`${TAG} Error connecting app to channel`, { error });
      res.status(500).json({ success: false, error: 'Failed to connect app to channel' });
    }
  },
);

router.delete(
  '/channels/:channelId/apps/:installedAppId',
  authV2Middleware.authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { channelId, installedAppId } = req.params;
      const channel = await authorizeAppDeskManager(
        channelId, req.user!.id, req.user!.workspaceId!, res,
      );
      if (!channel) return;

      const source = await externalSourceRepository.findChannelAppSource(channelId, installedAppId);
      if (!source || !source.isActive) {
        res.status(404).json({ success: false, error: 'App is not connected to this channel' });
        return;
      }

      // Soft disconnect — the row (and its ExternalMessage history) is preserved.
      await db.externalSource.update({ where: { id: source.id }, data: { isActive: false } });
      logger.info(`${TAG} App disconnected from desk channel`, {
        channelId, installedAppId, sourceId: source.id,
      });
      res.json({ success: true, message: 'App disconnected from channel' });
    } catch (error) {
      logger.error(`${TAG} Error disconnecting app from channel`, { error });
      res.status(500).json({ success: false, error: 'Failed to disconnect app from channel' });
    }
  },
);

/**
 * @deprecated Superseded by the per-app `/channels/:channelId/apps` endpoints.
 *
 * These two address a *channel*, not an (app, channel) pair, so they cannot express
 * "disconnect app B, keep app A" — they pick a row with an unordered findFirst.
 *
 * Current source no longer calls them. They remain for clients still running a
 * pre-deploy dashboard bundle: a browser tab that has not reloaded, and an Electron
 * window, which wraps the deployed dashboard (config.useBundledUI is false in every
 * profile) but can stay open for days — and would serve a frozen bundle outright if
 * anyone runs USE_BUNDLED_UI=true.
 *
 * Do not delete on a release schedule; both handlers log a warn on every call, so
 * remove them only once that log line has been silent across a full desktop-restart
 * cycle.
 *
 * assertLegacySingleAppDesk keeps them honest in the meantime: they refuse any
 * channel whose app binding they cannot resolve unambiguously.
 */
async function assertLegacySingleAppDesk(
  channel: { id: string; type: string },
  res: Response,
): Promise<boolean> {
  if (channel.type !== ChannelType.APP) {
    res.status(400).json({
      error: 'This channel is not an App desk. Manage its connected apps per app instead.',
    });
    return false;
  }
  const appSourceCount = await db.externalSource.count({
    where: { channelId: channel.id, sourceType: 'app-desk' },
  });
  if (appSourceCount > 1) {
    res.status(409).json({
      error: 'This desk has multiple connected apps. Disconnect or reconnect a specific app instead.',
    });
    return false;
  }
  return true;
}

/** @deprecated Use DELETE /channels/:channelId/apps/:installedAppId — see note above. */
router.post(
  '/:channelId/disconnect',
  authV2Middleware.authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { channelId } = req.params;
      const authorized = await authorizeAppDeskManager(
        channelId, req.user!.id, req.user!.workspaceId!, res,
      );
      if (!authorized) return;
      if (!(await assertLegacySingleAppDesk(authorized, res))) return;

      const source = await db.externalSource.findFirst({
        where: { channelId, sourceType: 'app-desk', isActive: true },
        select: { id: true },
      });
      if (!source) {
        res.status(404).json({ error: 'No active integration found for this channel' });
        return;
      }

      await db.externalSource.update({ where: { id: source.id }, data: { isActive: false } });
      logger.warn(`${TAG} App desk disconnected via deprecated whole-channel route`, {
        channelId, sourceId: source.id,
      });
      res.json({ message: 'Xyne App desk disconnected' });
    } catch (error) {
      logger.error(`${TAG} Error disconnecting app desk`, { error });
      res.status(500).json({ error: 'Failed to disconnect app desk' });
    }
  },
);

/** @deprecated Use POST /channels/:channelId/apps — see note above. */
router.post(
  '/:channelId/reconnect',
  authV2Middleware.authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { channelId } = req.params;
      const authorized = await authorizeAppDeskManager(
        channelId, req.user!.id, req.user!.workspaceId!, res,
      );
      if (!authorized) return;
      if (!(await assertLegacySingleAppDesk(authorized, res))) return;

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
      const validation = await findDeskWritableInstall(installedAppId, req.user!.workspaceId!);
      if (!validation.ok) {
        res.status(400).json({
          error: 'The app backing this desk is no longer installed or has lost desk:write access',
        });
        return;
      }

      await db.externalSource.update({ where: { id: source.id }, data: { isActive: true } });
      logger.warn(`${TAG} App desk reconnected via deprecated whole-channel route`, {
        channelId, sourceId: source.id, installedAppId,
      });
      res.json({ message: 'Xyne App desk reconnected' });
    } catch (error) {
      logger.error(`${TAG} Error reconnecting app desk`, { error });
      res.status(500).json({ error: 'Failed to reconnect app desk' });
    }
  },
);

export default router;
