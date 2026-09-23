import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  AccessType,
  addSdlcChannelRepositoriesSchema,
  attachSdlcRepositorySchema,
  createSdlcChannelSchema,
  checkSdlcRepositoryAccessSchema,
  createSdlcLinkSchema,
  createSdlcVcsCredentialSchema,
  resolveSdlcRepositoryLinkSchema,
  sdlcVcsProviderSchema,
  updateSdlcVcsCredentialSchema,
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
import { sdlcAgentContext } from '@/sdlc/SdlcAgentContextService';
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

const hubWorkflowScopeSchema = z.object({
  channelId: z.string().min(1).optional(),
  dryRun: z.boolean().default(true),
});

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
  '/repositories/resolve-link',
  route(async (req, res) => {
    const input = resolveSdlcRepositoryLinkSchema.parse(req.body);
    const link = await sdlcHub.resolveRepositoryLink(actorFromRequest(req), input);
    res.status(200).json({ success: true, link });
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
      ...(await backfillHubWorkflows(actorFromRequest(req), hubWorkflowScopeSchema.parse(req.body ?? {}))),
    });
  })
);

router.post(
  '/admin/reset-workflows',
  authorize('SDLC', AccessType.ADMIN),
  route(async (req, res) => {
    res.status(200).json({
      success: true,
      ...(await resetHubWorkflows(actorFromRequest(req), hubWorkflowScopeSchema.parse(req.body ?? {}))),
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

router.get(
  '/vcs/providers',
  route(async (req, res) => {
    const providers = await sdlcVcs.providerHosts(actorFromRequest(req).workspaceId);
    res.status(200).json({ success: true, providers });
  })
);

router.post(
  '/vcs/credentials',
  route(async (req, res) => {
    const input = createSdlcVcsCredentialSchema.parse(req.body);
    const credential = await sdlcVcs.createCredential(actorFromRequest(req), input);
    res.status(201).json({ success: true, credential });
  })
);

router.patch(
  '/vcs/credentials/:credentialId',
  route(async (req, res) => {
    const input = updateSdlcVcsCredentialSchema.parse(req.body);
    const credential = await sdlcVcs.updateCredential(
      actorFromRequest(req),
      req.params.credentialId,
      input
    );
    res.status(200).json({ success: true, credential });
  })
);

router.post(
  '/vcs/credentials/:credentialId/validate',
  route(async (req, res) => {
    const credential = await sdlcVcs.revalidateCredential(
      actorFromRequest(req),
      req.params.credentialId
    );
    res.status(200).json({ success: true, credential });
  })
);

router.delete(
  '/vcs/credentials/:credentialId',
  route(async (req, res) => {
    await sdlcVcs.deleteCredential(actorFromRequest(req), req.params.credentialId);
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
        vcsCredentialId: true,
      },
      orderBy: { name: 'asc' },
    });
    res.status(200).json({
      success: true,
      repositories: repositories.map((repository) => {
        let provider: string | null = null;
        try {
          provider = sdlcVcs.parseRepositoryUrl(repository.canonicalUrl || repository.url).provider;
        } catch {
          // A row whose link no Provider parses still lists, so an admin can remove it.
        }
        const access = deriveAccessStatus(repository.accessCapabilities);
        return {
          ...repository,
          accessJobStatus: access.status,
          accessJobErrorMessage: access.errorMessage,
          provider,
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

router.get(
  '/projects/:projectId/repositories/search',
  route(async (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q.slice(0, 120) : '';
    const scope = z
      .object({ provider: sdlcVcsProviderSchema, host: z.string().trim().toLowerCase().min(1) })
      .parse({ provider: req.query.provider, host: req.query.host });
    const repositories = await sdlcHub.searchProjectRepositories(
      actorFromRequest(req),
      req.params.projectId,
      scope,
      query
    );
    res.status(200).json({ success: true, repositories });
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
  '/channels/:channelId/context',
  route(async (req, res) => {
    const conversationId =
      typeof req.query.conversationId === 'string' ? req.query.conversationId.trim() : '';
    if (!conversationId) throw new AppError('conversationId is required', 400);
    try {
      const context = await sdlcAgentContext.buildForHub(
        actorFromRequest(req),
        req.params.channelId,
        { conversationId }
      );
      res.status(200).json({ success: true, context });
    } catch (error) {
      if (error instanceof AppError && [403, 404, 409].includes(error.statusCode)) {
        res.status(200).json({ success: true, context: null });
        return;
      }
      throw error;
    }
  })
);

router.get(
  '/channels/:channelId/nav-target',
  route(async (req, res) => {
    const ids = z
      .object({
        conversationId: z.string().min(1),
        messageId: z.string().min(1).optional(),
      })
      .parse(req.query);
    const target = await sdlcHub.navTarget(actorFromRequest(req), req.params.channelId, ids);
    res.status(200).json({ success: true, target });
  })
);

router.get(
  '/repositories/:repoId/context',
  route(async (req, res) => {
    const conversationId =
      typeof req.query.conversationId === 'string' ? req.query.conversationId.trim() : '';
    if (!conversationId) throw new AppError('conversationId is required', 400);
    const context = await sdlcHub.getRepositoryRunContext(
      actorFromRequest(req),
      req.params.repoId,
      conversationId
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
