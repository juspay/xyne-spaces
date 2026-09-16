import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  AccessType,
  addSdlcChannelRepositoriesSchema,
  attachSdlcRepositorySchema,
  createSdlcChannelSchema,
  checkSdlcRepositoryAccessSchema,
  createSdlcLinkSchema,
  configureSdlcVcsCredentialSchema,
  sdlcVcsProviderSchema,
} from '@xyne/shared';
import { authorize } from '@/middleware/authorize';
import { AppError } from '@/middleware/errorHandler';
import { logger } from '@/utils/logger';
import {
  backfillHubWorkflows,
  resetHubWorkflows,
  seedHubWorkflow,
} from '@/sdlc/seedHubWorkflow';
import { cleanupLegacySdlc } from '@/sdlc/cleanupLegacy';
import { SdlcHubService, type SdlcActor } from '@/sdlc';
import { requireSdlcProjectAccess } from '@/sdlc/sdlcProjectAccess';
import { sdlcVcs } from '@/sdlc/vcs';
import { deriveAccessStatus } from '@/sdlc/vcs/accessStatus';
import { DatabaseClient } from '@/database/client';

const router = Router();
const sdlcHub = new SdlcHubService();
const prisma = DatabaseClient.getInstance();

function actorFromRequest(req: Request): SdlcActor {
  const userId = req.user?.id;
  const workspaceId = req.user?.workspaceId;
  if (!userId || !workspaceId) {
    throw new AppError('Unauthorized', 401);
  }
  return { userId, workspaceId };
}

const hubWorkflowScopeSchema = z.object({ channelId: z.string().min(1).optional() });

function channelIdFromBody(req: Request): string | undefined {
  return hubWorkflowScopeSchema.parse(req.body ?? {}).channelId;
}

function route(
  handler: (req: Request, res: Response) => Promise<void>
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    void handler(req, res).catch(next);
  };
}

router.post(
  '/repositories',
  route(async (req, res) => {
    const input = attachSdlcRepositorySchema.parse(req.body);
    const repository = await sdlcHub.createRepository(actorFromRequest(req), input);
    res.status(201).json({ success: true, repository });
  })
);

router.post(
  '/channels',
  route(async (req, res) => {
    const input = createSdlcChannelSchema.parse(req.body);
    const actor = actorFromRequest(req);
    const channel = await sdlcHub.createChannel(actor, input);
    try {
      await seedHubWorkflow(actor, channel.id);
    } catch (error) {
      logger.error(`[SDLC] failed to seed workflow for hub ${channel.id}`, error);
    }
    res.status(201).json({ success: true, channel });
  })
);

router.post(
  '/admin/backfill-workflows',
  authorize('SDLC', AccessType.ADMIN),
  route(async (req, res) => {
    res.status(200).json({
      success: true,
      ...(await backfillHubWorkflows(actorFromRequest(req), channelIdFromBody(req))),
    });
  })
);

router.post(
  '/admin/reset-workflows',
  authorize('SDLC', AccessType.ADMIN),
  route(async (req, res) => {
    res.status(200).json({
      success: true,
      ...(await resetHubWorkflows(actorFromRequest(req), channelIdFromBody(req))),
    });
  })
);

const legacyCleanupSchema = z.object({
  dryRun: z.boolean().default(true),
  redis: z.boolean().default(false),
});

/** Spans every workspace, so it needs the migration admin role. */
router.post(
  '/admin/cleanup-legacy',
  authorize('TICKET-MIGRATION', AccessType.ADMIN),
  route(async (req, res) => {
    const input = legacyCleanupSchema.parse(req.body ?? {});
    res.status(200).json({ success: true, ...(await cleanupLegacySdlc(input)) });
  })
);

router.get(
  '/channels/:channelId',
  route(async (req, res) => {
    const channel = await sdlcHub.getChannel(actorFromRequest(req), req.params.channelId);
    res.status(200).json({ success: true, channel });
  })
);

router.post(
  '/channels/:channelId/repositories',
  route(async (req, res) => {
    const input = addSdlcChannelRepositoriesSchema.parse(req.body);
    const result = await sdlcHub.addChannelRepositories(
      actorFromRequest(req),
      req.params.channelId,
      input.repoIds
    );
    res.status(200).json({ success: true, ...result });
  })
);

router.delete(
  '/channels/:channelId/repositories/:repoId',
  route(async (req, res) => {
    await sdlcHub.removeChannelRepository(
      actorFromRequest(req),
      req.params.channelId,
      req.params.repoId
    );
    res.status(204).send();
  })
);

router.get(
  '/vcs/credentials',
  route(async (req, res) => {
    const credentials = await sdlcVcs.listCredentials(actorFromRequest(req));
    res.status(200).json({ success: true, credentials });
  })
);

router.put(
  '/vcs/credentials/:provider',
  route(async (req, res) => {
    const provider = sdlcVcsProviderSchema.parse(req.params.provider.toUpperCase());
    const input = configureSdlcVcsCredentialSchema.parse(req.body);
    const credential = await sdlcVcs.configureCredential(actorFromRequest(req), provider, input);
    res.status(200).json({ success: true, credential });
  })
);

router.post(
  '/vcs/credentials/:provider/validate',
  route(async (req, res) => {
    const provider = sdlcVcsProviderSchema.parse(req.params.provider.toUpperCase());
    const credential = await sdlcVcs.revalidateCredential(actorFromRequest(req), provider);
    res.status(200).json({ success: true, credential });
  })
);

router.delete(
  '/vcs/credentials/:provider',
  route(async (req, res) => {
    const provider = sdlcVcsProviderSchema.parse(req.params.provider.toUpperCase());
    await sdlcVcs.disconnectCredential(actorFromRequest(req), provider);
    res.status(204).send();
  })
);

router.get(
  '/projects/:projectId/repositories',
  route(async (req, res) => {
    const actor = actorFromRequest(req);
    const project = await prisma.project.findFirst({
      where: { id: req.params.projectId, workspaceId: actor.workspaceId },
      select: { id: true },
    });
    if (!project) throw new AppError('Project not found', 404);
    // Project access is the gate, not hub membership.
    await requireSdlcProjectAccess(prisma, actor, project.id);
    const repositories = await prisma.repo.findMany({
      where: { projectId: project.id, workspaceId: actor.workspaceId },
      select: {
        id: true,
        name: true,
        url: true,
        canonicalUrl: true,
        baseBranch: true,
        accessCapabilities: true,
      },
      orderBy: { name: 'asc' },
    });
    res.status(200).json({
      success: true,
      repositories: repositories.map((repository) => {
        const parsed = sdlcVcs.parseRepository('GITHUB', repository.canonicalUrl || repository.url);
        const access = deriveAccessStatus(repository.accessCapabilities);
        return {
          ...repository,
          accessJobStatus: access.status,
          accessJobErrorMessage: access.errorMessage,
          provider: parsed.provider,
          visibility: access.visibility,
          configuredBaseBranch:
            Array.isArray(repository.baseBranch) && typeof repository.baseBranch[0] === 'string'
              ? repository.baseBranch[0]
              : null,
        };
      }),
    });
  })
);

router.post(
  '/repositories/:repoId/access-check',
  route(async (req, res) => {
    const input = checkSdlcRepositoryAccessSchema.parse(req.body ?? {});
    const result = await sdlcVcs.checkRepositoryAccess(
      actorFromRequest(req),
      req.params.repoId,
      input
    );
    res.status(200).json({ success: true, ...result });
  })
);

router.get(
  '/repositories/context',
  route(async (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q : '';
    const requestedLimit = Number(req.query.limit);
    const limit = Number.isFinite(requestedLimit) ? requestedLimit : 20;
    const contexts = await sdlcHub.listRepositoryRunContexts(actorFromRequest(req), query, limit);
    res.status(200).json({ success: true, contexts });
  })
);

router.get(
  '/repositories/:repoId/context',
  route(async (req, res) => {
    const conversationId =
      typeof req.query.conversationId === 'string' ? req.query.conversationId.trim() : '';
    if (!conversationId) throw new AppError('conversationId is required', 400);
    const channelId =
      typeof req.query.channelId === 'string' ? req.query.channelId.trim() : '';
    const context = await sdlcHub.getRepositoryRunContext(
      actorFromRequest(req),
      req.params.repoId,
      conversationId,
      channelId || undefined
    );
    res.status(200).json({ success: true, context });
  })
);

router.post(
  '/repositories/:repoId/links',
  route(async (req, res) => {
    const input = createSdlcLinkSchema.parse(req.body);
    const channelId = typeof req.body?.channelId === 'string' ? req.body.channelId : undefined;
    const link = await sdlcHub.linkContext(
      actorFromRequest(req),
      req.params.repoId,
      input,
      channelId
    );
    res.status(201).json({ success: true, link });
  })
);

router.delete(
  '/repositories/:repoId/links/:linkId',
  route(async (req, res) => {
    await sdlcHub.unlinkContext(actorFromRequest(req), req.params.repoId, req.params.linkId);
    res.status(204).send();
  })
);

// router.use('/cleanup', sdlcCleanupRoutes);

export default router;
