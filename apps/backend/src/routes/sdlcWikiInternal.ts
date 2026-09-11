import { Router, type NextFunction, type Request, type Response } from 'express';
import {
  beginSdlcWikiCheckpointSchema,
  finalizeSdlcWikiCommitSchema,
  moveSdlcWikiPageSchema,
  writeSdlcWikiPageSchema,
} from '@xyne/shared';
import { DatabaseClient } from '@/database/client';
import { AppError } from '@/middleware/errorHandler';
import { ZodError } from 'zod';
import { SdlcWikiPageStore } from '@/sdlc/wiki/SdlcWikiPageStore';
import { parseWikiExecutionContext } from '@/sdlc/wiki/wikiRunState';
import {
  resolveAssignedWikiCommitRef,
  wikiAgentCommitRef,
  wikiAssignmentView,
} from '@/sdlc/wiki/wikiCommitRefs';
import { sdlcVcs } from '@/sdlc/vcs';

const router = Router();
const prisma = DatabaseClient.getInstance();
const pageStore = SdlcWikiPageStore.withSourceVerifier((repoId, commitSha, paths) =>
  sdlcVcs.verifySourcePaths(repoId, commitSha, paths),
  (repoId, commitSha, references) => sdlcVcs.verifySourceRanges(repoId, commitSha, references)
);

function route(
  handler: (req: Request, res: Response) => Promise<void>
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => void handler(req, res).catch((error: unknown) => {
    if (!(error instanceof AppError) && error instanceof Error) {
      const statusCode = (error as Error & { statusCode?: unknown }).statusCode;
      if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
        next(new AppError(error.message, statusCode));
        return;
      }
    }
    next(error);
  });
}

function parseRequest<T>(parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    if (error instanceof ZodError) {
      const issue = error.issues[0];
      const location = issue?.path.length ? `${issue.path.join('.')}: ` : '';
      throw new AppError(`${location}${issue?.message ?? 'Invalid Wiki request'}`, 400);
    }
    throw error;
  }
}

async function requireBinding(body: Record<string, unknown>) {
  const executionId = String(body.executionId ?? '').trim();
  const sessionId = String(body.sessionId ?? '').trim();
  const repoId = String(body.repoId ?? '').trim();
  if (!executionId || !sessionId || !repoId)
    throw new AppError('Wiki run binding is required', 400);
  const execution = await prisma.workflowExecution.findFirst({
    where: {
      id: executionId,
      workflowType: 'SDLC_WIKI',
      status: { in: ['PENDING', 'RUNNING'] },
    },
    select: { context: true, createdBy: true, workspaceId: true },
  });
  if (!execution?.context || !execution.createdBy)
    throw new AppError('Active Wiki run not found', 404);
  const context = parseWikiExecutionContext(execution.context);
  if (context.repoId !== repoId || context.assignedChunk?.sessionId !== sessionId) {
    throw new AppError('Wiki run binding mismatch', 403);
  }
  return {
    executionId,
    sessionId,
    repoId,
    userId: execution.createdBy,
    workspaceId: execution.workspaceId,
    context,
  };
}

function canonicalCommitRef(
  body: Record<string, unknown>,
  context: ReturnType<typeof parseWikiExecutionContext>
): string {
  const canonical = resolveAssignedWikiCommitRef(
    String(body.commitSha ?? ''),
    context.assignedChunk?.commitShas ?? []
  );
  if (!canonical) {
    throw new AppError('[COMMIT_NOT_ASSIGNED] Commit is not assigned to this Wiki run', 409);
  }
  return canonical;
}

router.post(
  '/pages/list',
  route(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const binding = await requireBinding(body);
    const pages = await pageStore.listPages({
      ...binding,
      includeArchived: body.includeArchived === true,
      sourcePaths: Array.isArray(body.sourcePaths)
        ? body.sourcePaths.filter((value): value is string => typeof value === 'string')
        : [],
    });
    const wikiMap = await pageStore.wikiMap({
      ...binding,
      includeArchived: body.includeArchived === true,
    });
    res.status(200).json({
      success: true,
      assignment: wikiAssignmentView(binding.context),
      wikiMap: wikiMap.map(entry => ({
        ...entry,
        lastCommitSha: wikiAgentCommitRef(entry.lastCommitSha, binding.context),
      })),
      pages: pages.map((page) => ({
        ...page,
        lastCommitSha: wikiAgentCommitRef(page.lastCommitSha, binding.context),
      })),
    });
  })
);

router.post(
  '/pages/read',
  route(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const binding = await requireBinding(body);
    const page = await pageStore.readPage({
      ...binding,
      path: String(body.path ?? ''),
      includeArchived: body.includeArchived === true,
    });
    res.status(200).json({
      success: true,
      assignment: wikiAssignmentView(binding.context),
      page: {
        ...page,
        lastCommitSha: wikiAgentCommitRef(page.lastCommitSha, binding.context),
      },
    });
  })
);

router.post(
  '/sources/verify',
  route(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const binding = await requireBinding(body);
    const commitSha = canonicalCommitRef(body, binding.context);
    const paths = Array.isArray(body.paths)
      ? body.paths.filter((value): value is string => typeof value === 'string').slice(0, 500)
      : [];
    if (paths.length === 0) throw new AppError('At least one source path is required', 400);
    await sdlcVcs.verifySourcePaths(binding.repoId, commitSha, paths);
    res.status(200).json({ success: true, commitSha: wikiAgentCommitRef(commitSha, binding.context), validPaths: paths });
  })
);

router.post(
  '/checkpoints/begin',
  route(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const binding = await requireBinding(body);
    const request = beginSdlcWikiCheckpointSchema.parse({
      ...body,
      executionId: binding.executionId,
      commitSha: canonicalCommitRef(body, binding.context),
    });
    const result = await pageStore.beginCheckpoint({
      sessionId: binding.sessionId,
      request,
    });
    res.status(200).json({
      success: true,
      checkpointSha: wikiAgentCommitRef(result.checkpointSha, binding.context),
      endpointSha: wikiAgentCommitRef(result.endpointSha, binding.context),
    });
  })
);

router.post(
  '/pages/write',
  route(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const binding = await requireBinding(body);
    const request = parseRequest(() => writeSdlcWikiPageSchema.parse({
      ...body,
      executionId: binding.executionId,
      commitSha: canonicalCommitRef(body, binding.context),
    }));
    const result = await pageStore.writePage({ sessionId: binding.sessionId, request });
    res.status(200).json({
      success: true,
      ...result,
      revision: {
        ...result.revision,
        commitSha: wikiAgentCommitRef(result.revision.commitSha, binding.context),
      },
    });
  })
);

router.post(
  '/pages/move',
  route(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const binding = await requireBinding(body);
    const request = moveSdlcWikiPageSchema.parse({
      ...body,
      executionId: binding.executionId,
      commitSha: canonicalCommitRef(body, binding.context),
    });
    const result = await pageStore.movePage({ sessionId: binding.sessionId, request });
    res.status(200).json({
      success: true,
      ...result,
      revision: {
        ...result.revision,
        commitSha: wikiAgentCommitRef(result.revision.commitSha, binding.context),
      },
    });
  })
);

router.post(
  '/commits/finalize',
  route(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const binding = await requireBinding(body);
    const request = finalizeSdlcWikiCommitSchema.parse({
      ...body,
      executionId: binding.executionId,
      commitSha: canonicalCommitRef(body, binding.context),
    });
    const result = await pageStore.finalizeCommit({ sessionId: binding.sessionId, request });
    res.status(200).json({
      success: true,
      cursorSha: wikiAgentCommitRef(result.cursorSha, binding.context),
      revisions: result.revisions.map((revision) => ({
        ...revision,
        commitSha: wikiAgentCommitRef(revision.commitSha, binding.context),
      })),
    });
  })
);

export default router;
