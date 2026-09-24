import { Router, type NextFunction, type Request, type Response } from 'express';
import {
  UserType,
  createSdlcClawLinkSchema,
  listSdlcEntityLinksSchema,
  sdlcRepoIds,
  createSdlcClawArtifactSchema,
  createSdlcTrackSchema,
  createSdlcArtifactTypeSchema,
  renameSdlcArtifactTypeSchema,
  updateSdlcClawArtifactSchema,
  editSdlcClawArtifactSectionSchema,
  moveSdlcClawArtifactSchema,
  archiveSdlcClawArtifactSchema,
  createSdlcClawTrackFolderSchema,
} from '@xyne/shared';
import { ZodError } from 'zod';
import { DatabaseClient } from '@/database/client';
import { AppError, zodErrorToAppError } from '@/middleware/errorHandler';
import { SdlcHubService, type SdlcActor } from '@/sdlc';

const router = Router();
const prisma = DatabaseClient.getInstance();
const sdlcHub = new SdlcHubService();

function route(
  handler: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  // A bad agent input is the caller's mistake: a 400 the model can read, not a 500.
  return (req, res, next) =>
    void handler(req, res).catch(error => next(error instanceof ZodError ? zodErrorToAppError(error) : error));
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
    const { repoId, repoIds, channelId, ...linkInput } = createSdlcClawLinkSchema.parse(req.body);
    const namedRepoId = sdlcRepoIds({ repoId, repoIds })[0] ?? null;
    if (!channelId && !namedRepoId) {
      throw new AppError('channelId is required', 400);
    }
    const link = await sdlcHub.linkContext(
      await actorFromRequest(req),
      channelId ? null : namedRepoId,
      linkInput,
      channelId
    );
    res.status(201).json({ success: true, link });
  }),
);

router.post(
  '/entity-links/list',
  route(async (req, res) => {
    const input = listSdlcEntityLinksSchema.parse(req.body);
    const links = await sdlcHub.listEntityLinks(await actorFromRequest(req), input);
    res.status(200).json({ success: true, links });
  }),
);

router.post(
  '/repositories/list',
  route(async (req, res) => {
    const query = typeof req.body?.query === 'string' ? req.body.query : '';
    const requestedLimit = Number(req.body?.limit);
    const repositories = await sdlcHub.listRepositoryRunContexts(
      await actorFromRequest(req),
      query,
      Number.isFinite(requestedLimit) ? requestedLimit : 20,
      channelIdFromBody(req)
    );
    res.status(200).json({ success: true, repositories });
  }),
);

router.post(
  '/tracks/list',
  route(async (req, res) => {
    const channelId = channelIdFromBody(req);
    if (!channelId) throw new AppError('channelId is required', 400);
    const tracks = await sdlcHub.listTracks(await actorFromRequest(req), channelId);
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
  '/track-folders',
  route(async (req, res) => {
    const input = createSdlcClawTrackFolderSchema.parse(req.body);
    const folder = await sdlcHub.createTrackFolderFromClaw(await actorFromRequest(req), input);
    res.status(201).json({ success: true, folder });
  }),
);

router.post(
  '/artifact-types/list',
  route(async (req, res) => {
    const channelId = channelIdFromBody(req);
    if (!channelId) throw new AppError('channelId is required', 400);
    const artifactTypes = await sdlcHub.listArtifactTypes(await actorFromRequest(req), channelId);
    res.status(200).json({ success: true, artifactTypes });
  }),
);

router.post(
  '/artifact-types',
  route(async (req, res) => {
    const input = createSdlcArtifactTypeSchema.parse(req.body);
    const artifactType = await sdlcHub.createArtifactType(
      await actorFromRequest(req),
      input.channelId,
      input.name
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
      input.channelId,
      input.folderId,
      input.name
    );
    res.status(200).json({ success: true, artifactType });
  }),
);

router.post(
  '/artifacts',
  route(async (req, res) => {
    const input = createSdlcClawArtifactSchema.parse(req.body);
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
  '/artifacts/section',
  route(async (req, res) => {
    const input = editSdlcClawArtifactSectionSchema.parse(req.body);
    const artifact = await sdlcHub.editArtifactSectionFromClaw(await actorFromRequest(req), input);
    res.status(200).json({ success: true, artifact });
  }),
);

router.post(
  '/artifacts/move',
  route(async (req, res) => {
    const input = moveSdlcClawArtifactSchema.parse(req.body);
    const artifact = await sdlcHub.moveArtifactFromClaw(await actorFromRequest(req), input);
    res.status(200).json({ success: true, artifact });
  }),
);

router.post(
  '/artifacts/archive',
  route(async (req, res) => {
    const input = archiveSdlcClawArtifactSchema.parse(req.body);
    const artifact = await sdlcHub.archiveArtifactFromClaw(await actorFromRequest(req), input);
    res.status(200).json({ success: true, artifact });
  }),
);

export default router;
