import express, { type Request, type Response } from 'express';
import {
  ChannelRole,
  ChannelScopeType,
  ChannelType,
  ChannelVisibility,
  DeskType,
  EmailMergeMode,
  IOS_BUNDLE_ID_PATTERN,
} from '@xyne/shared';
import { z } from 'zod';
import { authV2Middleware } from '@/middleware/authV2Middleware';
import { db } from '@/database/client';
import { config as appConfig } from '@/config/env';
import { encrypt } from '@/services/encryptionService';
import { logger } from '@/utils/logger';
import { ExternalSourcePlatform } from '../../core/types';
import {
  appStoreClient,
  AppStoreApiError,
  type AppStoreCredentials,
} from '../../adapters/social-media/app-store/client';
import { buildAppStoreSourceRecords } from '../../adapters/social-media/app-store/sourceRecords';
import { authorizeSocialMediaManager } from './access';

const TAG = '[AppStoreRoutes]';
const router = express.Router();

const credentialsSchema = z.object({
  issuerId: z.string().trim().uuid(),
  keyId: z
    .string()
    .trim()
    .regex(/^[A-Z0-9]{10}$/),
  privateKey: z.string().trim().min(1),
});

const applicationsSchema = z
  .array(
    z.object({
      bundleId: z.string().trim().regex(IOS_BUNDLE_ID_PATTERN),
    }),
  )
  .min(1)
  .max(20)
  .refine(
    (applications) =>
      new Set(applications.map((application) => application.bundleId)).size === applications.length,
    { message: 'Bundle ids must be unique' },
  );

const connectSchema = credentialsSchema.extend({
  channelName: z.string().trim().min(1).max(120),
  applications: applicationsSchema,
  projectId: z.string().min(1),
  boardId: z.string().min(1),
  assigneeUserGroupId: z.string().min(1).optional(),
  visibility: z.enum(['PUBLIC', 'PRIVATE', 'public', 'private']).default('PUBLIC'),
});

class AppStoreConnectError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Nothing ever syncs without the polling worker, and this connect flow is synchronous — so without
 * this check a desk would look fully connected and silently ingest nothing forever.
 */
function assertSyncWorkerEnabled(): void {
  if (!appConfig.enableSocialMediaSyncWorker) {
    throw new AppStoreConnectError(
      503,
      'Review syncing is disabled on this deployment (ENABLE_SOCIAL_MEDIA_SYNC_WORKER). ' +
        'Enable it before connecting an App Store desk, or reviews will never arrive.',
    );
  }
}

async function resolveApplications(
  credentials: AppStoreCredentials,
  applications: Array<{ bundleId: string }>,
): Promise<Array<{ appId: string; bundleId: string; displayName: string }>> {
  return Promise.all(
    applications.map(async ({ bundleId }) => {
      let resolved: { appId: string; name: string } | null;
      try {
        resolved = await appStoreClient.resolveApp(credentials, bundleId);
      } catch (error) {
        if (error instanceof AppStoreApiError && error.status === 401) {
          throw new AppStoreConnectError(
            401,
            'Invalid App Store Connect credentials. Check the Issuer ID, Key ID and .p8 key.',
          );
        }
        throw error;
      }
      if (!resolved) {
        throw new AppStoreConnectError(
          404,
          `The key cannot see ${bundleId}. Check the app exists and the key's role allows it.`,
        );
      }
      return { appId: resolved.appId, bundleId, displayName: resolved.name };
    }),
  );
}

/**
 * ExternalSource.name is globally unique and derived deterministically, and disconnect only flips
 * isActive — so a plain create() would hit P2002 for any app that was ever connected before.
 * Reactivating in place is what lets a disconnected app be re-added, possibly to a different desk.
 */
async function reactivateOrCreateSources(
  tx: Pick<typeof db, 'externalSource'>,
  params: {
    workspaceId: string;
    channelId: string;
    boardId: string;
    ownerUserId: string;
    encryptedCredentials: string;
    applications: Array<{ appId: string; bundleId: string; displayName: string }>;
  },
): Promise<{ created: number; reactivated: number }> {
  const records = buildAppStoreSourceRecords(params);
  let created = 0;
  let reactivated = 0;

  for (const record of records) {
    const existing = await tx.externalSource.findUnique({
      where: { name: record.name },
      select: { id: true, isActive: true },
    });

    if (!existing) {
      await tx.externalSource.create({ data: record, select: { id: true } });
      created += 1;
      continue;
    }
    if (existing.isActive) {
      throw new AppStoreConnectError(
        409,
        `${record.displayName} is already connected in this workspace.`,
      );
    }
    await tx.externalSource.update({
      where: { id: existing.id },
      data: {
        isActive: true,
        credentials: record.credentials,
        channelId: record.channelId,
        boardId: record.boardId,
        externalMetadata: record.externalMetadata,
        // Reset, or the first sync after a long dormancy re-scans the whole gap.
        lastSyncCursor: record.lastSyncCursor,
      },
    });
    reactivated += 1;
  }

  return { created, reactivated };
}

function handleRouteError(res: Response, error: unknown, fallback: string): void {
  if (error instanceof AppStoreConnectError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  if (error instanceof AppStoreApiError) {
    res.status(error.status >= 400 && error.status < 500 ? error.status : 502).json({
      error: error.detail,
    });
    return;
  }
  logger.error(`${TAG} ${fallback}`, { error });
  res.status(500).json({ error: fallback });
}

router.post(
  '/app-store/connect',
  authV2Middleware.authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      assertSyncWorkerEnabled();
      const workspaceId = req.user!.workspaceId!;
      const userId = req.user!.id;
      const input = connectSchema.parse(req.body);

      const [project, board, duplicateName] = await Promise.all([
        db.project.findFirst({
          where: { id: input.projectId, workspaceId },
          select: { id: true },
        }),
        db.board.findFirst({
          where: { id: input.boardId, projectId: input.projectId },
          select: { id: true },
        }),
        db.channel.findFirst({
          where: { name: input.channelName, workspaceId },
          select: { id: true },
        }),
      ]);
      if (!project) throw new AppStoreConnectError(404, 'Project not found');
      if (!board) throw new AppStoreConnectError(404, 'Board not found in this project');
      if (duplicateName) throw new AppStoreConnectError(409, 'A channel with that name exists');

      const credentials: AppStoreCredentials = {
        issuerId: input.issuerId,
        keyId: input.keyId,
        privateKey: input.privateKey,
      };
      const applications = await resolveApplications(credentials, input.applications);
      const encryptedCredentials = encrypt(JSON.stringify(credentials));
      const now = new Date();

      const channelId = await db.$transaction(async (tx) => {
        const channel = await tx.channel.create({
          data: {
            name: input.channelName,
            description: `App Store reviews for ${applications.length} application${
              applications.length === 1 ? '' : 's'
            }`,
            type: ChannelType.SOCIAL_MEDIA,
            scopeType: ChannelScopeType.DEFAULT,
            visibility: input.visibility.toUpperCase() as ChannelVisibility,
            createdBy: userId,
            projectId: input.projectId,
            workspaceId,
            participantCount: 1,
            lastActivityAt: now,
          },
        });
        await tx.channelParticipant.create({
          data: { workspaceId, channelId: channel.id, userId, role: ChannelRole.ADMIN },
        });
        await tx.channelUserStatus.create({
          data: { workspaceId, channelId: channel.id, userId, updatedAt: now },
        });
        await tx.channelStats.create({
          data: { workspaceId, channelId: channel.id, participantCount: 1, lastActivityAt: now },
        });
        await tx.emailChannelPreference.create({
          data: {
            channelId: channel.id,
            workspaceId,
            ownerUserId: userId,
            assigneeUserGroupId: input.assigneeUserGroupId,
            boardId: input.boardId,
            deskType: DeskType.SOCIAL_MEDIA,
            emailMergeMode: EmailMergeMode.DISABLED,
          },
        });

        const mappingBoards = await tx.board.findMany({
          where: { projectId: input.projectId },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        });
        if (mappingBoards.length > 0) {
          await tx.channelBoardMapping.createMany({
            data: mappingBoards.map((b, index) => ({
              channelId: channel.id,
              boardId: b.id,
              workspaceId,
              isDefault: input.boardId ? b.id === input.boardId : index === 0,
              createdBy: userId,
              createdAt: now,
              updatedAt: now,
            })),
            skipDuplicates: true,
          });
        }
        // Inside the transaction on purpose: a source that is already connected elsewhere throws
        // 409 here, and outside it that would leave an orphan channel holding the requested name,
        // so the user's retry would fail with "a channel with that name exists".
        await reactivateOrCreateSources(tx, {
          workspaceId,
          channelId: channel.id,
          boardId: input.boardId,
          ownerUserId: userId,
          encryptedCredentials,
          applications,
        });
        return channel.id;
      });

      res.status(201).json({ channelId });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors[0]?.message ?? 'Invalid request' });
        return;
      }
      handleRouteError(res, error, 'Failed to connect App Store desk');
    }
  },
);

router.post(
  '/:channelId/app-store/apps',
  authV2Middleware.authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const workspaceId = req.user!.workspaceId!;
      if (!(await authorizeSocialMediaManager(req.params.channelId, req.user!.id, workspaceId, res)))
        return;

      const input = z.object({ applications: applicationsSchema }).parse(req.body);
      const existing = await db.externalSource.findFirst({
        where: {
          channelId: req.params.channelId,
          workspaceId,
          sourceType: ExternalSourcePlatform.APP_STORE,
        },
        select: { credentials: true, boardId: true, ownerUserId: true },
      });
      if (!existing) throw new AppStoreConnectError(404, 'App Store desk not found');

      const credentials = appStoreClient.decryptCredentials(existing.credentials);
      const applications = await resolveApplications(credentials, input.applications);
      const result = await reactivateOrCreateSources(db, {
        workspaceId,
        channelId: req.params.channelId,
        boardId: existing.boardId ?? '',
        ownerUserId: existing.ownerUserId ?? req.user!.id,
        encryptedCredentials: existing.credentials,
        applications,
      });

      res.json({ added: result.created + result.reactivated, ...result });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors[0]?.message ?? 'Invalid request' });
        return;
      }
      handleRouteError(res, error, 'Failed to add App Store apps');
    }
  },
);

async function setAppConnection(req: Request, res: Response, isActive: boolean): Promise<void> {
  try {
    const workspaceId = req.user!.workspaceId!;
    if (!(await authorizeSocialMediaManager(req.params.channelId, req.user!.id, workspaceId, res)))
      return;

    const result = await db.externalSource.updateMany({
      where: {
        id: req.params.sourceId,
        channelId: req.params.channelId,
        workspaceId,
        sourceType: ExternalSourcePlatform.APP_STORE,
      },
      // Re-enabling after dormancy must not replay the whole gap as "new" reviews.
      data: isActive ? { isActive, lastSyncCursor: new Date().toISOString() } : { isActive },
    });
    if (result.count === 0) throw new AppStoreConnectError(404, 'App Store app not found');

    res.json({ isActive });
  } catch (error) {
    handleRouteError(res, error, 'Failed to update App Store app');
  }
}

router.post(
  '/:channelId/app-store/apps/:sourceId/disconnect',
  authV2Middleware.authenticate,
  (req: Request, res: Response) => setAppConnection(req, res, false),
);

router.post(
  '/:channelId/app-store/apps/:sourceId/reconnect',
  authV2Middleware.authenticate,
  (req: Request, res: Response) => setAppConnection(req, res, true),
);

/** Replaces Play's "Reauthorize" redirect: Apple keys are rotated by pasting a new one. */
router.post(
  '/:channelId/app-store/credentials',
  authV2Middleware.authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const workspaceId = req.user!.workspaceId!;
      if (!(await authorizeSocialMediaManager(req.params.channelId, req.user!.id, workspaceId, res)))
        return;

      const credentials = credentialsSchema.parse(req.body);
      const sources = await db.externalSource.findMany({
        where: {
          channelId: req.params.channelId,
          workspaceId,
          sourceType: ExternalSourcePlatform.APP_STORE,
        },
        select: { id: true, externalMetadata: true },
      });
      if (sources.length === 0) throw new AppStoreConnectError(404, 'App Store desk not found');

      // Prove the new key can still see every app before storing it.
      const bundleIds = sources
        .map((source) => (source.externalMetadata as { bundleId?: string } | null)?.bundleId)
        .filter((bundleId): bundleId is string => Boolean(bundleId));
      await resolveApplications(credentials, bundleIds.map((bundleId) => ({ bundleId })));

      await db.externalSource.updateMany({
        where: { id: { in: sources.map((source) => source.id) } },
        data: { credentials: encrypt(JSON.stringify(credentials)) },
      });
      sources.forEach((source) => appStoreClient.forgetToken(source.id));

      res.json({ updated: sources.length });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors[0]?.message ?? 'Invalid request' });
        return;
      }
      handleRouteError(res, error, 'Failed to rotate App Store credentials');
    }
  },
);

export default router;
