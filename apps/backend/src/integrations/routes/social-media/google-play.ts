import express, { type Request, type Response } from 'express';
import { Prisma } from '@prisma/client';
import {
  ANDROID_PACKAGE_NAME_PATTERN,
  ChannelType,
} from '@xyne/shared';
import { z } from 'zod';
import { authV2Middleware } from '@/middleware/authV2Middleware';
import { db } from '@/database/client';
import { encrypt } from '@/services/encryptionService';
import { logger } from '@/utils/logger';
import { ExternalSourcePlatform } from '../../core/types';
import {
  googlePlayClient,
  parseServiceAccountKey,
  readSourceCredentials,
  toGooglePlayErrorResponse,
  type GooglePlayCredentials,
} from '../../adapters/social-media/google-play/client';
import { buildGooglePlaySourceRecords } from '../../adapters/social-media/google-play/sourceRecords';
import { authorizeSocialMediaManager } from './access';
import { postGooglePlayConnectTx } from '@/bypassAcl/transactions/googlePlay';

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

const serviceAccountKeySchema = z.object({
  serviceAccountKey: z.string().min(1),
});

const connectSchema = serviceAccountKeySchema.extend({
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
});

const addApplicationsSchema = z.object({
  applications: connectSchema.shape.applications,
});

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

function sendAccessError(
  res: Response,
  error: unknown,
  credentials: GooglePlayCredentials | undefined,
): boolean {
  const validationError = error instanceof GooglePlayPackageValidationError ? error : undefined;
  const mapped = toGooglePlayErrorResponse(validationError?.providerError ?? error, {
    clientEmail: credentials?.clientEmail,
    packageName: validationError?.packageName,
  });
  if (!mapped) return false;
  res.status(mapped.status).json({ error: mapped.error });
  return true;
}

router.post(
  '/google-play/connect',
  authV2Middleware.authenticate,
  async (req: Request, res: Response): Promise<void> => {
    let credentials: GooglePlayCredentials | undefined;
    try {
      const parsed = connectSchema.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(400)
          .json({
            error:
              'A service account key, valid applications, channel name, project and board are required',
          });
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

      credentials = parseServiceAccountKey(input.serviceAccountKey);
      await validatePackages(credentials, input.applications);
      const { channelId } = await postGooglePlayConnectTx(
        {
          userId,
          workspaceId,
          channelName: input.channelName,
          applications: input.applications,
          projectId: input.projectId,
          boardId: input.boardId,
          assigneeUserGroupId: input.assigneeUserGroupId,
          visibility: input.visibility.toUpperCase() as 'PUBLIC' | 'PRIVATE',
        },
        encrypt(JSON.stringify(credentials)),
        new Date(),
      );
      res.status(201).json({ channelId });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        res.status(409).json({ error: 'One or more Google Play apps are already connected' });
        return;
      }
      if (sendAccessError(res, error, credentials)) return;
      logger.error(`${TAG} Failed to connect Google Play desk`, { error });
      res.status(500).json({ error: 'Failed to connect Google Play desk' });
    }
  }
);

router.post(
  '/:channelId/google-play/apps',
  authV2Middleware.authenticate,
  async (req: Request, res: Response): Promise<void> => {
    let credentials: GooglePlayCredentials | undefined;
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

      credentials = readSourceCredentials(credentialSource);
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

      if (sendAccessError(res, error, credentials)) return;

      logger.error(`${TAG} Failed to add Google Play applications`, {
        channelId: req.params.channelId,
        error,
      });
      res.status(500).json({ error: 'Failed to add Google Play applications' });
    }
  }
);

router.post(
  '/:channelId/google-play/credentials',
  authV2Middleware.authenticate,
  async (req: Request, res: Response): Promise<void> => {
    let credentials: GooglePlayCredentials | undefined;
    try {
      const parsed = serviceAccountKeySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'A service account key is required' });
        return;
      }

      const workspaceId = req.user!.workspaceId!;
      if (
        !(await authorizeSocialMediaManager(req.params.channelId, req.user!.id, workspaceId, res))
      ) {
        return;
      }

      credentials = parseServiceAccountKey(parsed.data.serviceAccountKey);
      const sources = await db.externalSource.findMany({
        where: {
          channelId: req.params.channelId,
          workspaceId,
          sourceType: ExternalSourcePlatform.GOOGLE_PLAY,
        },
        select: { id: true, externalIdentifier: true, isActive: true },
      });
      if (sources.length === 0) {
        res.status(404).json({ error: 'Google Play desk not found' });
        return;
      }

      await validatePackages(
        credentials,
        sources.flatMap((source) =>
          source.externalIdentifier ? [{ packageName: source.externalIdentifier }] : []
        ),
      );
      const reactivateAll = sources.every((source) => !source.isActive);
      await db.externalSource.updateMany({
        where: { id: { in: sources.map((source) => source.id) } },
        data: {
          credentials: encrypt(JSON.stringify(credentials)),
          ...(reactivateAll && { isActive: true }),
        },
      });
      res.json({ updated: sources.length });
    } catch (error) {
      if (sendAccessError(res, error, credentials)) return;
      logger.error(`${TAG} Failed to replace Google Play credentials`, {
        channelId: req.params.channelId,
        error,
      });
      res.status(500).json({ error: 'Failed to replace Google Play credentials' });
    }
  }
);

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
    let credentials: GooglePlayCredentials | undefined;
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

      credentials = readSourceCredentials(source);
      await googlePlayClient.validatePackage(credentials, source.externalIdentifier);
      await db.externalSource.update({
        where: { id: source.id },
        data: { isActive: true },
      });
      res.json({ message: 'Google Play app reconnected' });
    } catch (error) {
      if (sendAccessError(res, error, credentials)) return;
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

