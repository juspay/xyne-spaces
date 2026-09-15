import { Router, type NextFunction, type Request, type Response } from 'express';
import {
  UserType,
  createSdlcLinkSchema,
  createSdlcClawArtifactSchema,
  createSdlcTrackSchema,
  createSdlcArtifactTypeSchema,
  renameSdlcArtifactTypeSchema,
  updateSdlcBaselineDraftSchema,
  updateSdlcClawArtifactSchema,
} from '@xyne/shared';
import { DatabaseClient } from '@/database/client';
import { AppError } from '@/middleware/errorHandler';
import { SdlcHubService, type SdlcActor } from '@/sdlc';

const router = Router();
const prisma = DatabaseClient.getInstance();
const sdlcHub = new SdlcHubService();

function route(
  handler: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => void handler(req, res).catch(next);
}

function channelIdFromBody(req: Request): string | undefined {
  const value = req.body?.channelId;
  return typeof value === 'string' && value ? value : undefined;
}

async function actorFromRequest(req: Request): Promise<SdlcActor> {
  const userId = req.user?.id;
  const workspaceId = req.user?.workspaceId;
  if (!userId || !workspaceId) throw new AppError('Unauthorized', 401);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { userType: true, workspaceId: true },
  });
  if (user?.userType !== UserType.APP) return { userId, workspaceId };

  const actingUserHeader = req.headers['x-xyne-acting-user-id'];
  const actingUserId = typeof actingUserHeader === 'string' ? actingUserHeader.trim() : '';
  if (!actingUserId) {
    throw new AppError('SDLC app requests require an initiating user', 403);
  }
  const actingUser = await prisma.user.findFirst({
    where: {
      id: actingUserId,
      workspaceId,
      userType: { not: UserType.APP },
    },
    select: { id: true },
  });
  if (!actingUser) {
    throw new AppError('Initiating user is unavailable in this workspace', 403);
  }
  return { userId: actingUser.id, workspaceId, isApp: true };
}

router.post(
  '/links',
  route(async (req, res) => {
    // Optional: a hub covering no repository is addressed by channelId instead.
    const input = createSdlcLinkSchema
      .extend({ repoId: createSdlcLinkSchema.shape.sourceId.optional() })
      .parse(req.body);
    const { repoId, ...linkInput } = input;
    const link = await sdlcHub.linkContext(
      await actorFromRequest(req),
      repoId,
      linkInput,
      channelIdFromBody(req)
    );
    res.status(201).json({ success: true, link });
  }),
);

router.post(
  '/tracks/list',
  route(async (req, res) => {
    const repoId = typeof req.body?.repoId === 'string' ? req.body.repoId : undefined;
    const channelId = channelIdFromBody(req);
    // Tracks belong to the hub, so the claw tool sends only its channelId; a repoId
    // is accepted as the older way of naming the same hub.
    if (!repoId && !channelId) throw new AppError('repoId or channelId is required', 400);
    const tracks = await sdlcHub.listTracks(await actorFromRequest(req), repoId, channelId);
    res.status(200).json({ success: true, tracks });
  }),
);

router.post(
  '/tracks',
  route(async (req, res) => {
    const input = createSdlcTrackSchema.parse(req.body);
    const track = await sdlcHub.createTrack(await actorFromRequest(req), input);
    res.status(201).json({ success: true, track });
  }),
);

router.post(
  '/artifact-types/list',
  route(async (req, res) => {
    const repoId = typeof req.body?.repoId === 'string' ? req.body.repoId : undefined;
    const channelId = channelIdFromBody(req);
    // A hub covering no repository is addressed by channel; one of the two is required.
    if (!repoId && !channelId) throw new AppError('repoId or channelId is required', 400);
    const artifactTypes = await sdlcHub.listArtifactTypes(
      await actorFromRequest(req),
      repoId,
      channelId
    );
    res.status(200).json({ success: true, artifactTypes });
  }),
);

router.post(
  '/artifact-types',
  route(async (req, res) => {
    const input = createSdlcArtifactTypeSchema.parse(req.body);
    const artifactType = await sdlcHub.createArtifactType(
      await actorFromRequest(req),
      input.repoId,
      input.name,
      input.channelId
    );
    res.status(201).json({ success: true, artifactType });
  }),
);

router.patch(
  '/artifact-types/:folderId',
  route(async (req, res) => {
    const input = renameSdlcArtifactTypeSchema.parse({
      ...req.body,
      folderId: req.params.folderId,
    });
    const artifactType = await sdlcHub.renameArtifactType(
      await actorFromRequest(req),
      input.repoId,
      input.folderId,
      input.name
    );
    res.status(200).json({ success: true, artifactType });
  }),
);

router.post(
  '/artifacts',
  route(async (req, res) => {
    // The claw tool narrows a hub with `repoIds`; exactly one names the repository
    // the artifact belongs to, the older `repoId` still wins when present.
    const repoIds = Array.isArray(req.body?.repoIds) ? req.body.repoIds : [];
    const input = createSdlcClawArtifactSchema.parse({
      ...req.body,
      ...(!req.body?.repoId && repoIds.length === 1 && typeof repoIds[0] === 'string'
        ? { repoId: repoIds[0] }
        : {}),
    });
    const artifact = await sdlcHub.createArtifactFromClaw(await actorFromRequest(req), input);
    res.status(201).json({ success: true, artifact });
  }),
);

router.post(
  '/artifacts/update',
  route(async (req, res) => {
    const input = updateSdlcClawArtifactSchema.parse(req.body);
    const artifact = await sdlcHub.updateArtifactFromClaw(await actorFromRequest(req), input);
    res.status(200).json({ success: true, artifact });
  }),
);

router.post(
  '/baseline-drafts',
  route(async (req, res) => {
    const input = updateSdlcBaselineDraftSchema.parse(req.body);
    const artifact = await sdlcHub.updateBaselineDraftFromClaw(
      await actorFromRequest(req),
      input
    );
    res.status(200).json({ success: true, artifact });
  }),
);

export default router;
