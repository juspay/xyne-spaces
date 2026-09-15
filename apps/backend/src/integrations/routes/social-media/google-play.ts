import express, { type Request, type Response } from 'express';
import { Prisma } from '@prisma/client';
import {
  ANDROID_PACKAGE_NAME_PATTERN,
  ChannelRole,
  ChannelScopeType,
  ChannelType,
  ChannelVisibility,
  DeskType,
  EmailMergeMode,
} from '@xyne/shared';
import { z } from 'zod';
import { authV2Middleware } from '@/middleware/authV2Middleware';
import { db } from '@/database/client';
import { decrypt, encrypt } from '@/services/encryptionService';
import { getBackendUrl, getFrontendUrl } from '@/utils/publicUrls';
import { logger } from '@/utils/logger';
import { buildSupportPath } from '../urlHelpers';
import { ExternalSourcePlatform } from '../../core/types';
import {
  googlePlayClient,
  type GooglePlayCredentials,
} from '../../adapters/social-media/google-play/client';
import { googlePlayOAuthStateService } from '../../adapters/social-media/google-play/oauthStateService';
import { buildGooglePlaySourceRecords } from '../../adapters/social-media/google-play/sourceRecords';
import { authorizeSocialMediaManager } from './access';

const TAG = '[GooglePlayRoutes]';
const router = express.Router();

class GooglePlayPackageValidationError extends Error {
  constructor(
    readonly packageName: string,
    readonly providerError: unknown,
  ) {
    super(`Google Play package validation failed for ${packageName}`);
  }
}

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

const addApplicationsSchema = z.object({
  applications: startSchema.shape.applications,
});

const reconnectSchema = z.object({
  platform: startSchema.shape.platform,
});

function callbackUri(req: Request): string {
  return `${getBackendUrl(req)}/api/integrations/social-media/google-play/oauth/callback`;
}

async function validatePackages(
  credentials: GooglePlayCredentials,
  applications: Array<{ packageName: string }>,
): Promise<void> {
  await Promise.all(
    applications.map(async (application) => {
      try {
        await googlePlayClient.validatePackage(credentials, application.packageName);
      } catch (error) {
        throw new GooglePlayPackageValidationError(application.packageName, error);
      }
    }),
  );
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
    packageName?: string;
  }
): void {
  const query = new URLSearchParams();
  if (params.error) {
    query.set('socialMediaError', params.error);
    if (params.packageName) query.set('socialMediaPackage', params.packageName);
  } else {
    query.set('socialMediaOAuth', 'success');
  }
  const path = buildSupportPath(params.workspaceId, params.channelId, query);
  res.redirect(postOAuthRedirect(getFrontendUrl(req), path, params.platform ?? 'web'));
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
            sourceType: ExternalSourcePlatform.GOOGLE_PLAY,
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

router.post(
  '/:channelId/google-play/apps',
  authV2Middleware.authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = addApplicationsSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Valid Google Play applications are required' });
        return;
      }

      const userId = req.user!.id;
      const workspaceId = req.user!.workspaceId!;
      if (
        !(await authorizeSocialMediaManager(req.params.channelId, userId, workspaceId, res))
      ) {
        return;
      }

      const [channel, preference, credentialSource] = await Promise.all([
        db.channel.findFirst({
          where: {
            id: req.params.channelId,
            workspaceId,
            type: ChannelType.SOCIAL_MEDIA,
          },
          select: {
            id: true,
          },
        }),
        db.emailChannelPreference.findUnique({
          where: { channelId: req.params.channelId },
          select: {
            boardId: true,
          },
        }),
        db.externalSource.findFirst({
          where: {
            channelId: req.params.channelId,
            workspaceId,
            sourceType: ExternalSourcePlatform.GOOGLE_PLAY,
          },
          select: {
            credentials: true,
            ownerUserId: true,
          },
          orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
        }),
      ]);
      if (!channel || !preference?.boardId || !credentialSource) {
        res.status(404).json({ error: 'Social media desk configuration not found' });
        return;
      }
      const mappedBoard = await db.board.findUnique({
        where: { id: preference.boardId },
        select: { projectId: true },
      });
      if (!mappedBoard?.projectId) {
        res.status(404).json({ error: 'Social media desk configuration not found' });
        return;
      }

      const packageNames = parsed.data.applications.map((application) => application.packageName);
      const existingSources = await db.externalSource.findMany({
        where: {
          workspaceId,
          sourceType: ExternalSourcePlatform.GOOGLE_PLAY,
          externalIdentifier: { in: packageNames },
        },
        select: { externalIdentifier: true },
      });
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

      const credentials = JSON.parse(
        decrypt(credentialSource.credentials)
      ) as GooglePlayCredentials;
      await validatePackages(credentials, parsed.data.applications);

      const sourceRecords = buildGooglePlaySourceRecords({
        workspaceId,
        channelId: channel.id,
        boardId: preference.boardId,
        ownerUserId: credentialSource.ownerUserId ?? userId,
        encryptedCredentials: credentialSource.credentials,
        applications: parsed.data.applications,
      });
      const sources = await db.$transaction(
        sourceRecords.map((data) =>
          db.externalSource.create({
            data,
            select: { id: true },
          })
        )
      );

      res.status(201).json({
        added: sources.length,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        res.status(409).json({ error: 'One or more Google Play apps are already connected' });
        return;
      }

      const providerError =
        error instanceof GooglePlayPackageValidationError ? error.providerError : error;
      const providerStatus =
        typeof providerError === 'object' &&
        providerError !== null &&
        'response' in providerError &&
        typeof providerError.response === 'object' &&
        providerError.response !== null &&
        'status' in providerError.response
          ? providerError.response.status
          : undefined;
      if (providerStatus === 401 || providerStatus === 403 || providerStatus === 404) {
        res.status(403).json({
          error: error instanceof GooglePlayPackageValidationError
            ? `The existing Google Play authorization cannot access ${error.packageName}. Check the package name and Play Console permissions.`
            : 'The existing Google Play authorization is expired or cannot access one or more packages. Check the package names and Play Console permissions.',
        });
        return;
      }

      logger.error(`${TAG} Failed to add Google Play applications`, {
        channelId: req.params.channelId,
        error,
      });
      res.status(500).json({ error: 'Failed to add Google Play applications' });
    }
  }
);

router.post(
  '/:channelId/reconnect',
  authV2Middleware.authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = reconnectSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid platform' });
        return;
      }

      const userId = req.user!.id;
      const workspaceId = req.user!.workspaceId!;
      if (
        !(await authorizeSocialMediaManager(req.params.channelId, userId, workspaceId, res))
      ) {
        return;
      }

      const [channel, preference, sources] = await Promise.all([
        db.channel.findFirst({
          where: {
            id: req.params.channelId,
            workspaceId,
            type: ChannelType.SOCIAL_MEDIA,
          },
          select: {
            id: true,
            name: true,
            visibility: true,
          },
        }),
        db.emailChannelPreference.findUnique({
          where: { channelId: req.params.channelId },
          select: {
            boardId: true,
            assigneeUserGroupId: true,
          },
        }),
        db.externalSource.findMany({
          where: {
            channelId: req.params.channelId,
            workspaceId,
            sourceType: ExternalSourcePlatform.GOOGLE_PLAY,
          },
          select: {
            externalIdentifier: true,
            displayName: true,
            isActive: true,
          },
          orderBy: { createdAt: 'asc' },
        }),
      ]);
      if (!channel || !preference?.boardId || sources.length === 0) {
        res.status(404).json({ error: 'Social media desk configuration not found' });
        return;
      }
      const stateBoard = await db.board.findUnique({
        where: { id: preference.boardId },
        select: { projectId: true },
      });
      if (!stateBoard?.projectId) {
        res.status(404).json({ error: 'Social media desk configuration not found' });
        return;
      }
      if (sources.some((source) => !source.externalIdentifier)) {
        res.status(409).json({ error: 'One or more Google Play sources are incomplete' });
        return;
      }
      const activeSources = sources.filter((source) => source.isActive);
      const reactivateAll = activeSources.length === 0;
      const sourcesToValidate = reactivateAll ? sources : activeSources;

      const { state, codeChallenge } = await googlePlayOAuthStateService.create({
        mode: 'reconnect',
        reactivateAll,
        userId,
        workspaceId,
        channelId: channel.id,
        channelName: channel.name,
        applications: sourcesToValidate.map((source) => ({
          packageName: source.externalIdentifier!,
          displayName: source.displayName,
        })),
        projectId: stateBoard.projectId,
        boardId: preference.boardId,
        assigneeUserGroupId: preference.assigneeUserGroupId ?? undefined,
        visibility: channel.visibility as 'PUBLIC' | 'PRIVATE',
        platform: parsed.data.platform,
      });
      const authorizationUrl = googlePlayClient.createAuthorizationUrl({
        redirectUri: callbackUri(req),
        state,
        codeChallenge,
      });
      res.json({ authorizationUrl });
    } catch (error) {
      logger.error(`${TAG} Failed to start Google Play reconnection`, {
        channelId: req.params.channelId,
        error,
      });
      res.status(500).json({ error: 'Failed to start Google Play reconnection' });
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
    await validatePackages(authorization.credentials, state.applications);

    const encryptedCredentials = encrypt(JSON.stringify(authorization.credentials));
    const now = new Date();
    const result = await db.$transaction(async (tx) => {
      if (state.mode === 'reconnect' && state.channelId) {
        const [channel, preference, sources] = await Promise.all([
          tx.channel.findFirst({
            where: {
              id: state.channelId,
              workspaceId: state.workspaceId,
              type: ChannelType.SOCIAL_MEDIA,
            },
            select: { id: true, createdBy: true },
          }),
          tx.emailChannelPreference.findUnique({
            where: { channelId: state.channelId },
            select: { ownerUserId: true },
          }),
          tx.externalSource.findMany({
            where: {
              channelId: state.channelId,
              workspaceId: state.workspaceId,
              sourceType: ExternalSourcePlatform.GOOGLE_PLAY,
            },
            select: { id: true, externalIdentifier: true, isActive: true },
          }),
        ]);
        if (
          !channel ||
          (channel.createdBy !== state.userId && preference?.ownerUserId !== state.userId)
        ) {
          throw new Error('The user can no longer manage this social media desk');
        }

        const expectedPackages = new Set(
          state.applications.map((application) => application.packageName)
        );
        const sourcesToValidate = state.reactivateAll
          ? sources
          : sources.filter((source) => source.isActive);
        if (
          sourcesToValidate.length !== expectedPackages.size ||
          sourcesToValidate.some(
            (source) =>
              !source.externalIdentifier || !expectedPackages.has(source.externalIdentifier)
          )
        ) {
          throw new Error('Google Play app configuration changed during reconnection');
        }

        await tx.externalSource.updateMany({
          where: { id: { in: sources.map((source) => source.id) } },
          data: {
            credentials: encryptedCredentials,
            ...(state.reactivateAll && { isActive: true }),
          },
        });
        return {
          channelId: channel.id,
          sourceIds: sources.map((source) => source.id),
        };
      }

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

      // Dual-write: mirror the channel→project board set into ChannelBoardMapping
      // so downstream consumers never need to read channel.projectId.
      const mappingBoards = await tx.board.findMany({
        where: { projectId: state.projectId },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (mappingBoards.length > 0) {
        await tx.channelBoardMapping.createMany({
          data: mappingBoards.map((b, index) => ({
            channelId: channel.id,
            boardId: b.id,
            workspaceId: state.workspaceId,
            isDefault: state.boardId ? b.id === state.boardId : index === 0,
            createdBy: state.userId,
            createdAt: now,
            updatedAt: now,
          })),
          skipDuplicates: true,
        });
      }

      const sourceRecords = buildGooglePlaySourceRecords({
        workspaceId: state.workspaceId,
        channelId: channel.id,
        boardId: state.boardId,
        ownerUserId: state.userId,
        encryptedCredentials,
        applications: state.applications,
      });
      await Promise.all(
        sourceRecords.map((data) =>
          tx.externalSource.create({
            data,
            select: { id: true },
          })
        )
      );
      return { channelId: channel.id };
    });

    redirectToDesk(req, res, {
      workspaceId: state.workspaceId,
      channelId: result.channelId,
      platform: state.platform,
    });
  } catch (error) {
    if (error instanceof GooglePlayPackageValidationError) {
      logger.error(`${TAG} Google Play package validation failed`, {
        packageName: error.packageName,
        error: error.providerError,
      });
      redirectToDesk(req, res, {
        workspaceId: state.workspaceId,
        channelId: state.channelId,
        platform: state.platform,
        error: 'google_play_package_validation_failed',
        packageName: error.packageName,
      });
      return;
    }
    logger.error(`${TAG} Google Play OAuth callback failed`, { error });
    const duplicate =
      error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
    redirectToDesk(req, res, {
      workspaceId: state.workspaceId,
      channelId: state.channelId,
      platform: state.platform,
      error: duplicate ? 'google_play_app_already_connected' : 'google_play_connection_failed',
    });
  }
});

router.post(
  '/:channelId/google-play/apps/:sourceId/disconnect',
  authV2Middleware.authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const workspaceId = req.user!.workspaceId!;
      if (
        !(await authorizeSocialMediaManager(
          req.params.channelId,
          req.user!.id,
          workspaceId,
          res
        ))
      ) {
        return;
      }

      const result = await db.externalSource.updateMany({
        where: {
          id: req.params.sourceId,
          channelId: req.params.channelId,
          workspaceId,
          sourceType: ExternalSourcePlatform.GOOGLE_PLAY,
        },
        data: { isActive: false },
      });
      if (result.count === 0) {
        res.status(404).json({ error: 'Google Play app not found' });
        return;
      }
      res.json({ message: 'Google Play app disconnected' });
    } catch (error) {
      logger.error(`${TAG} Failed to disconnect Google Play app`, {
        channelId: req.params.channelId,
        sourceId: req.params.sourceId,
        error,
      });
      res.status(500).json({ error: 'Failed to disconnect Google Play app' });
    }
  }
);

router.post(
  '/:channelId/google-play/apps/:sourceId/reconnect',
  authV2Middleware.authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const workspaceId = req.user!.workspaceId!;
      if (
        !(await authorizeSocialMediaManager(
          req.params.channelId,
          req.user!.id,
          workspaceId,
          res
        ))
      ) {
        return;
      }

      const source = await db.externalSource.findFirst({
        where: {
          id: req.params.sourceId,
          channelId: req.params.channelId,
          workspaceId,
          sourceType: ExternalSourcePlatform.GOOGLE_PLAY,
        },
        select: {
          id: true,
          credentials: true,
          externalIdentifier: true,
        },
      });
      if (!source?.externalIdentifier) {
        res.status(404).json({ error: 'Google Play app not found' });
        return;
      }

      const credentials = JSON.parse(decrypt(source.credentials)) as GooglePlayCredentials;
      await googlePlayClient.validatePackage(credentials, source.externalIdentifier);
      await db.externalSource.update({
        where: { id: source.id },
        data: { isActive: true },
      });
      res.json({ message: 'Google Play app reconnected' });
    } catch (error) {
      const providerStatus =
        typeof error === 'object' &&
        error !== null &&
        'response' in error &&
        typeof error.response === 'object' &&
        error.response !== null &&
        'status' in error.response
          ? error.response.status
          : undefined;
      if (providerStatus === 401 || providerStatus === 403 || providerStatus === 404) {
        res.status(403).json({
          error:
            'The existing Google authorization cannot access this app. Reauthorize Google and check Play Console permissions.',
        });
        return;
      }
      logger.error(`${TAG} Failed to reconnect Google Play app`, {
        channelId: req.params.channelId,
        sourceId: req.params.sourceId,
        error,
      });
      res.status(500).json({ error: 'Failed to reconnect Google Play app' });
    }
  }
);

export default router;
