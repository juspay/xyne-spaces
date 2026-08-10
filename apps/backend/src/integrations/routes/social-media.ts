import express, { type Request, type Response } from 'express';
import {
  ChannelRole,
  ChannelScopeType,
  ChannelType,
  ChannelVisibility,
  DeskType,
  EmailMergeMode,
  Prisma,
} from '@prisma/client';
import { z } from 'zod';
import { ANDROID_PACKAGE_NAME_PATTERN } from '@xyne/shared';
import { authV2Middleware } from '@/middleware/authV2Middleware';
import { db } from '@/database/client';
import { encrypt } from '@/services/encryptionService';
import { getBackendUrl, getFrontendUrl } from '@/utils/publicUrls';
import { logger } from '@/utils/logger';
import { buildSupportPath } from './urlHelpers';
import { SOCIAL_MEDIA_SOURCE_TYPES } from '../social-media/constants';
import { googlePlayClient } from '../adapters/social-media/google-play/client';
import { googlePlayOAuthStateService } from '../adapters/social-media/google-play/oauthStateService';
import { buildGooglePlaySourceRecords } from '../adapters/social-media/google-play/sourceRecords';
import { socialMediaService } from '../social-media/socialMediaService';

const TAG = '[SocialMediaRoutes]';
const router = express.Router();
router.use(express.json());

const startSchema = z.object({
  channelName: z.string().trim().min(1).max(120),
  applications: z
    .array(
      z.object({
        packageName: z.string().trim().regex(ANDROID_PACKAGE_NAME_PATTERN),
        displayName: z.string().trim().min(1).max(120),
      })
    )
    .min(1)
    .max(20)
    .refine(
      (applications) =>
        new Set(applications.map((application) => application.packageName)).size ===
        applications.length,
      { message: 'Google Play package names must be unique' }
    ),
  projectId: z.string().min(1),
  boardId: z.string().min(1),
  assigneeUserGroupId: z.string().min(1).optional(),
  visibility: z.enum(['PUBLIC', 'PRIVATE', 'public', 'private']).default('PUBLIC'),
  platform: z.enum(['web', 'electron']).default('web'),
});

function callbackUri(req: Request): string {
  return `${getBackendUrl(req)}/api/integrations/social-media/google-play/oauth/callback`;
}

function postOAuthRedirect(
  frontendUrl: string,
  path: string,
  platform: 'web' | 'electron'
): string {
  return platform === 'electron'
    ? `${frontendUrl}/launch?path=${encodeURIComponent(path)}`
    : `${frontendUrl}${path}`;
}

function redirectToDesk(
  req: Request,
  res: Response,
  params: {
    workspaceId?: string;
    channelId?: string;
    platform?: 'web' | 'electron';
    error?: string;
  }
): void {
  const query = new URLSearchParams(
    params.error ? { socialMediaError: params.error } : { socialMediaOAuth: 'success' }
  );
  const path = buildSupportPath(params.workspaceId, params.channelId, query);
  res.redirect(postOAuthRedirect(getFrontendUrl(req), path, params.platform ?? 'web'));
}

async function canAccessChannel(
  channelId: string,
  userId: string,
  workspaceId: string
): Promise<boolean> {
  const channel = await db.channel.findFirst({
    where: {
      id: channelId,
      workspaceId,
      type: ChannelType.SOCIAL_MEDIA,
      OR: [
        { visibility: ChannelVisibility.PUBLIC },
        { createdBy: userId },
        { participants: { some: { userId } } },
      ],
    },
    select: { id: true },
  });
  return Boolean(channel);
}

async function authorizeManager(
  channelId: string,
  userId: string,
  workspaceId: string,
  res: Response
): Promise<boolean> {
  const channel = await db.channel.findFirst({
    where: { id: channelId, workspaceId, type: ChannelType.SOCIAL_MEDIA },
    select: { createdBy: true },
  });
  if (!channel) {
    res.status(404).json({ error: 'Social media desk not found' });
    return false;
  }
  if (channel.createdBy === userId) return true;
  const preference = await db.emailChannelPreference.findUnique({
    where: { channelId },
    select: { ownerUserId: true },
  });
  if (preference?.ownerUserId === userId) return true;
  res.status(403).json({ error: 'Only the desk owner can manage this integration' });
  return false;
}

router.post(
  '/google-play/oauth/start',
  authV2Middleware.authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = startSchema.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: 'Valid applications, channel name, project and board are required' });
        return;
      }
      const userId = req.user!.id;
      const workspaceId = req.user!.workspaceId!;
      const input = parsed.data;

      const packageNames = input.applications.map((application) => application.packageName);
      const [project, board, group, existingSources, duplicateChannel] = await Promise.all([
        db.project.findFirst({
          where: { id: input.projectId, workspaceId },
          select: { id: true },
        }),
        db.board.findFirst({
          where: { id: input.boardId, projectId: input.projectId, workspaceId },
          select: { id: true },
        }),
        input.assigneeUserGroupId
          ? db.userGroup.findFirst({
              where: { id: input.assigneeUserGroupId, workspaceId, isActive: true },
              select: { id: true },
            })
          : null,
        db.externalSource.findMany({
          where: {
            workspaceId,
            sourceType: SOCIAL_MEDIA_SOURCE_TYPES.GOOGLE_PLAY,
            externalIdentifier: { in: packageNames },
          },
          select: { externalIdentifier: true, isActive: true },
        }),
        db.channel.findFirst({
          where: { workspaceId, name: input.channelName },
          select: { id: true },
        }),
      ]);
      if (!project || !board) {
        res.status(404).json({ error: 'Project or board not found' });
        return;
      }
      if (input.assigneeUserGroupId && !group) {
        res.status(404).json({ error: 'Assignee group not found' });
        return;
      }
      if (existingSources.length > 0) {
        const connectedPackages = existingSources
          .map((source) => source.externalIdentifier)
          .filter(Boolean)
          .join(', ');
        res.status(409).json({
          error: `Google Play app already connected or disconnected in this workspace: ${connectedPackages}`,
        });
        return;
      }
      if (duplicateChannel) {
        res.status(409).json({ error: 'A channel with this display name already exists' });
        return;
      }

      const { state, codeChallenge } = await googlePlayOAuthStateService.create({
        userId,
        workspaceId,
        channelName: input.channelName,
        applications: input.applications,
        projectId: input.projectId,
        boardId: input.boardId,
        assigneeUserGroupId: input.assigneeUserGroupId,
        visibility: input.visibility.toUpperCase() as 'PUBLIC' | 'PRIVATE',
        platform: input.platform,
      });
      const authorizationUrl = googlePlayClient.createAuthorizationUrl({
        redirectUri: callbackUri(req),
        state,
        codeChallenge,
      });
      res.json({ authorizationUrl });
    } catch (error) {
      logger.error(`${TAG} Failed to start Google Play OAuth`, { error });
      res.status(500).json({ error: 'Failed to start Google Play authorization' });
    }
  }
);

router.get('/google-play/oauth/callback', async (req: Request, res: Response): Promise<void> => {
  const stateToken = typeof req.query.state === 'string' ? req.query.state : '';
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const state = stateToken ? await googlePlayOAuthStateService.consume(stateToken) : null;
  if (!state || !code) {
    redirectToDesk(req, res, { error: 'invalid_or_expired_google_play_oauth_state' });
    return;
  }

  try {
    const user = await db.user.findFirst({
      where: { id: state.userId, workspaceId: state.workspaceId, leftAt: null },
      select: { id: true },
    });
    if (!user) throw new Error('The user who started authorization is no longer available');

    const authorization = await googlePlayClient.exchangeAuthorizationCode({
      code,
      codeVerifier: state.codeVerifier,
      redirectUri: callbackUri(req),
    });
    for (const application of state.applications) {
      await googlePlayClient.validatePackage(authorization.credentials, application.packageName);
    }

    const encryptedCredentials = encrypt(JSON.stringify(authorization.credentials));
    const now = new Date();
    const result = await db.$transaction(async (tx) => {
      const channel = await tx.channel.create({
        data: {
          name: state.channelName,
          description: `Google Play reviews for ${state.applications.length} application${
            state.applications.length === 1 ? '' : 's'
          }`,
          type: ChannelType.SOCIAL_MEDIA,
          scopeType: ChannelScopeType.DEFAULT,
          visibility: state.visibility as ChannelVisibility,
          createdBy: state.userId,
          projectId: state.projectId,
          workspaceId: state.workspaceId,
          participantCount: 1,
          lastActivityAt: now,
        },
      });
      await tx.channelParticipant.create({
        data: {
          workspaceId: state.workspaceId,
          channelId: channel.id,
          userId: state.userId,
          role: ChannelRole.ADMIN,
        },
      });
      await tx.channelUserStatus.create({
        data: {
          workspaceId: state.workspaceId,
          channelId: channel.id,
          userId: state.userId,
          updatedAt: now,
        },
      });
      await tx.channelStats.create({
        data: {
          workspaceId: state.workspaceId,
          channelId: channel.id,
          participantCount: 1,
          lastActivityAt: now,
        },
      });
      await tx.emailChannelPreference.create({
        data: {
          channelId: channel.id,
          workspaceId: state.workspaceId,
          ownerUserId: state.userId,
          assigneeUserGroupId: state.assigneeUserGroupId,
          boardId: state.boardId,
          deskType: DeskType.SOCIAL_MEDIA,
          emailMergeMode: EmailMergeMode.DISABLED,
        },
      });
      const sourceRecords = buildGooglePlaySourceRecords({
        workspaceId: state.workspaceId,
        channelId: channel.id,
        boardId: state.boardId,
        ownerUserId: state.userId,
        encryptedCredentials,
        applications: state.applications,
      });
      const sources = await Promise.all(
        sourceRecords.map((data) =>
          tx.externalSource.create({
            data,
            select: { id: true },
          }),
        ),
      );
      return { channelId: channel.id, sourceIds: sources.map((source) => source.id) };
    });

    void (async () => {
      for (const sourceId of result.sourceIds) {
        try {
          await socialMediaService.syncSource(sourceId);
        } catch (error) {
          logger.error(`${TAG} Initial Google Play sync failed`, { sourceId, error });
        }
      }
    })();
    redirectToDesk(req, res, {
      workspaceId: state.workspaceId,
      channelId: result.channelId,
      platform: state.platform,
    });
  } catch (error) {
    logger.error(`${TAG} Google Play OAuth callback failed`, { error });
    const duplicate =
      error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
    redirectToDesk(req, res, {
      workspaceId: state.workspaceId,
      platform: state.platform,
      error: duplicate ? 'google_play_app_already_connected' : 'google_play_connection_failed',
    });
  }
});

router.post(
  '/:conversationId/reply',
  authV2Middleware.authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const workspaceId = req.user!.workspaceId!;
      const conversation = await db.conversation.findFirst({
        where: { conversationId: req.params.conversationId, workspaceId },
        select: { channelId: true },
      });
      if (
        !conversation ||
        !(await canAccessChannel(conversation.channelId, req.user!.id, workspaceId))
      ) {
        res.status(404).json({ error: 'Review conversation not found' });
        return;
      }
      const body = typeof req.body?.body === 'string' ? req.body.body : '';
      const interaction = await socialMediaService.reply({
        conversationId: req.params.conversationId,
        workspaceId,
        userId: req.user!.id,
        body,
      });
      res.json({ interaction });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send review reply';
      res.status(/required|exceed/.test(message) ? 400 : 500).json({ error: message });
    }
  }
);

router.post(
  '/:channelId/sync',
  authV2Middleware.authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const workspaceId = req.user!.workspaceId!;
      if (!(await authorizeManager(req.params.channelId, req.user!.id, workspaceId, res))) return;
      const sources = await db.externalSource.findMany({
        where: {
          channelId: req.params.channelId,
          workspaceId,
          sourceType: { in: Object.values(SOCIAL_MEDIA_SOURCE_TYPES) },
          isActive: true,
        },
        select: { id: true },
      });
      if (sources.length === 0) {
        res.status(404).json({ error: 'Active social media source not found' });
        return;
      }
      let synced = 0;
      for (const source of sources) {
        const result = await socialMediaService.syncSource(source.id);
        synced += result.synced;
      }
      res.json({ synced, sourceCount: sources.length });
    } catch (error) {
      logger.error(`${TAG} Manual source sync failed`, { error });
      res.status(500).json({ error: 'Failed to synchronize review source' });
    }
  }
);

for (const action of ['disconnect', 'reconnect'] as const) {
  router.post(
    `/:channelId/${action}`,
    authV2Middleware.authenticate,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const workspaceId = req.user!.workspaceId!;
        if (!(await authorizeManager(req.params.channelId, req.user!.id, workspaceId, res))) return;
        const result = await db.externalSource.updateMany({
          where: {
            channelId: req.params.channelId,
            workspaceId,
            sourceType: { in: Object.values(SOCIAL_MEDIA_SOURCE_TYPES) },
          },
          data: { isActive: action === 'reconnect' },
        });
        if (result.count === 0) {
          res.status(404).json({ error: 'Social media source not found' });
          return;
        }
        res.json({
          message: `Social media desk ${action}ed`,
          sourceCount: result.count,
        });
      } catch (error) {
        logger.error(`${TAG} Failed to ${action} source`, { error });
        res.status(500).json({ error: `Failed to ${action} social media source` });
      }
    }
  );
}

export default router;
