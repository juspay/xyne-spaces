import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { DatabaseClient } from '@/database/client';
import { authMiddleware } from '@/middleware/auth';
import {
  ENTERPRISE_RAG_SOURCE_TYPES,
  getEnterpriseRagDocumentCounts,
  ingestEnterpriseRagDocument,
  type EnterpriseRagContext,
} from '@/services/enterpriseRagBenchmarkAdapter';
import { logger } from '@/utils/logger';

const router = Router();

const isLoopbackRequest = (req: Request): boolean => {
  const address = req.ip || req.socket.remoteAddress || '';
  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    address === '::ffff:127.0.0.1'
  );
};

const usesLocalBenchmarkIdentity = (req: Request): boolean =>
  process.env.NODE_ENV === 'development' &&
  process.env.ENABLE_ENTERPRISE_RAG_BENCHMARK_ROUTES === 'true' &&
  isLoopbackRequest(req);

const authenticateAdmin = [
  (req: Request, res: Response, next: NextFunction) => {
    if (usesLocalBenchmarkIdentity(req)) return next();
    return authMiddleware.authenticate(req, res, next);
  },
  (req: Request, res: Response, next: NextFunction) => {
    if (usesLocalBenchmarkIdentity(req)) return next();
    return authMiddleware.requireAdmin(req, res, next);
  },
];

const ingestSchema = z.object({
  rowIndex: z.number().int().nonnegative(),
  docId: z.string().trim().min(1).max(256),
  sourceType: z.enum(ENTERPRISE_RAG_SOURCE_TYPES),
  title: z.string().trim().min(1).max(20_000),
  content: z.string().trim().min(1).max(20_000_000),
}).strict();

const resolveContext = async (req: Request): Promise<EnterpriseRagContext> => {
  if (usesLocalBenchmarkIdentity(req)) {
    const requestedWorkspaceId = req.get('x-workspace-id')?.trim();
    const requestedUserId = req.get('x-benchmark-user-id')?.trim();
    const database = DatabaseClient.getInstance();
    const requestedUser = requestedUserId
      ? await database.user.findUnique({
          where: { id: requestedUserId },
          include: { workspace: { select: { id: true, orgId: true } } },
        })
      : null;
    const user = requestedUser?.workspace.id === requestedWorkspaceId
      ? requestedUser
      : await database.user.findFirst({
          where: { leftAt: null, workspace: { status: 'ACTIVE' } },
          orderBy: { createdAt: 'asc' },
          include: { workspace: { select: { id: true, orgId: true } } },
        });
    if (user) {
      return {
        orgId: user.workspace.orgId,
        workspaceId: user.workspace.id,
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
      };
    }

    // Development-only identity scaffolding. These are ordinary backend tenant
    // records required by the normal ingestion services; they are not Vespa docs.
    const workspaceId = requestedWorkspaceId || 'enterprise-rag-local';
    const userId = requestedUserId || `${workspaceId}-user`;
    const orgId = req.get('x-benchmark-org-id')?.trim() || `${workspaceId}-org`;
    const userName = req.get('x-user-name')?.trim() || 'EnterpriseRAG Local User';
    const userEmail = `enterprise-rag-${workspaceId.replace(/[^a-zA-Z0-9]/g, '-')}@localhost.invalid`;
    await database.organization.upsert({
      where: { orgId },
      update: {},
      create: {
        orgId,
        name: `EnterpriseRAG Local ${workspaceId}`,
        description: 'Local EnterpriseRAG-Bench development tenant',
        createdBy: userId,
      },
    });
    const orgMember = await database.orgMember.upsert({
      where: { email: userEmail },
      update: { orgId, leftAt: null },
      create: { orgId, email: userEmail, role: 'OWNER' },
    });
    await database.workspace.upsert({
      where: { id: workspaceId },
      update: {},
      create: {
        id: workspaceId,
        orgId,
        name: `EnterpriseRAG Local ${workspaceId}`,
        description: 'Local EnterpriseRAG-Bench workspace',
        createdBy: userId,
      },
    });
    await database.user.upsert({
      where: { id: userId },
      update: { name: userName, status: 'ACTIVE', leftAt: null },
      create: {
        id: userId,
        name: userName,
        email: userEmail,
        authProvider: 'EMAIL',
        providerUserId: `enterprise-rag:${userId}`,
        workspaceId,
        role: 'OWNER',
        orgMemberId: orgMember.memberId,
      },
    });
    return {
      orgId,
      workspaceId,
      userId,
      userName,
      userEmail,
    };
  }

  const user = req.user!;
  const workspace = await DatabaseClient.getInstance().workspace.findUnique({
    where: { id: user.workspaceId },
    select: { orgId: true },
  });
  if (!workspace) throw new Error(`Workspace ${user.workspaceId} was not found`);
  return {
    orgId: workspace.orgId,
    workspaceId: user.workspaceId,
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
  };
};

router.post('/ingest', ...authenticateAdmin, async (req: Request, res: Response): Promise<void> => {
  const parsed = ingestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: 'Invalid EnterpriseRAG document',
      details: parsed.error.flatten(),
    });
    return;
  }

  try {
    const context = await resolveContext(req);
    const result = await ingestEnterpriseRagDocument(parsed.data, context);
    res.status(result.status === 'queued' ? 202 : 200).json(result);
  } catch (error) {
    logger.error('[EnterpriseRAG] Failed to ingest document', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown ingestion error',
    });
  }
});

router.get('/stats', ...authenticateAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const context = await resolveContext(req);
    const counts = await getEnterpriseRagDocumentCounts(context.workspaceId);
    res.status(200).json({ success: true, ...counts });
  } catch (error) {
    logger.error('[EnterpriseRAG] Failed to read ingestion stats', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown stats error',
    });
  }
});

router.get('/context', ...authenticateAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const context = await resolveContext(req);
    res.status(200).json({ success: true, ...context });
  } catch (error) {
    logger.error('[EnterpriseRAG] Failed to resolve ingestion context', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown context error',
    });
  }
});

export default router;
