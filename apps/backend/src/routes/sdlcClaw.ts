import { Router, type NextFunction, type Request, type Response } from 'express';
import {
  UserStatus,
  UserType,
  createSdlcClawLinkSchema,
  listSdlcEntityLinksSchema,
  sdlcRepoIds,
  createSdlcClawDocumentSchema,
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

/**
 * Auth for /api/internal/sdlc/hub, mounted behind validateS2SKey: the key proves claw-auth sent it,
 * and claw-auth binds the acting user to the run, so the request acts as that person.
 */
export async function authenticateActingUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.headers['x-xyne-acting-user-id'];
    const id = typeof header === 'string' ? header.trim() : '';
    if (!id) throw new AppError('SDLC app requests require an initiating user', 403);
    // The run's bound workspace: a key holder cannot act as a user of another workspace.
    const workspaceHeader = req.headers['x-xyne-workspace-id'];
    const workspaceId = typeof workspaceHeader === 'string' ? workspaceHeader.trim() : '';
    if (!workspaceId) throw new AppError('SDLC app requests require the run workspace', 403);
    const user = await prisma.user.findFirst({
      where: { id, workspaceId, userType: { notIn: [UserType.APP, UserType.AGENT] }, status: { not: UserStatus.INACTIVE }, leftAt: null },
      select: {
        id: true,
        providerUserId: true,
        email: true,
        name: true,
        displayName: true,
        workspaceId: true,
        role: true,
        orgMemberId: true,
        orgMember: { select: { role: true, leftAt: true } },
      },
    });
    if (!user?.orgMember || user.orgMember.leftAt) throw new AppError('Initiating user is unavailable in this workspace', 403);
    // The table ACLs read req.user, so they check this person's rights.
    req.user = {
      id: user.id,
      googleId: user.providerUserId,
      email: user.email,
      name: user.name,
      displayName: user.displayName,
      workspaceId: user.workspaceId,
      role: user.role,
      orgRole: user.orgMember.role,
      memberId: user.orgMemberId,
    };
    next();
  } catch (error) {
    next(error);
  }
}

async function actorFromRequest(req: Request): Promise<SdlcActor> {
  const userId = req.user?.id;
  const workspaceId = req.user?.workspaceId;
  if (!userId || !workspaceId) throw new AppError('Unauthorized', 401);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { userType: true, workspaceId: true },
  });
  if (user?.userType !== UserType.APP && user?.userType !== UserType.AGENT) return { userId, workspaceId };

  const actingUserHeader = req.headers['x-xyne-acting-user-id'];
  const actingUserId = typeof actingUserHeader === 'string' ? actingUserHeader.trim() : '';
  if (!actingUserId) {
    throw new AppError('SDLC app requests require an initiating user', 403);
  }
  const actingUser = await prisma.user.findFirst({
    where: {
      id: actingUserId,
      workspaceId,
      userType: { notIn: [UserType.APP, UserType.AGENT] },
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
    const input = createSdlcClawDocumentSchema.parse(req.body);
    const actor = await actorFromRequest(req);
    const artifact =
      'artifactType' in input
        ? await sdlcHub.createWikiPage(actor, input)
        : await sdlcHub.createArtifactFromClaw(actor, input);
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
