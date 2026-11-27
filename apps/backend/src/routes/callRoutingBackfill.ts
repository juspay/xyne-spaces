import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { AccessType } from '@xyne/shared';
import { db } from '@/database/client';
import { workspaceScopedRoute } from '@/database/tenant/context';
import { WORKSPACE_LEVEL } from '@/integrations/core/sourceScope';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';
import { callConnectionService } from '@/services/telephony/callConnectionService';
import { CALL_PROVIDER_IDS } from '@/services/telephony/callProviderIds';
import { logger } from '@/utils/logger';

// TODO: one-off. Delete after it has run in prod, with the legacy-routing move code in callConnectionService.
const router = Router();
const adminAuth = authorize('TICKET-MIGRATION', AccessType.ADMIN);
const TAG = '[call-routing-backfill]';

type ConnectionStatus = { connectionId: string; status: 'pending' | 'moved' | 'failed' };

function route(
  handler: (req: Request, res: Response) => Promise<void>
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => void handler(req, res).catch(next);
}

/** Moves the caller's workspace's legacy connection routing onto its desks. Safe to repeat. */
async function backfill(workspaceId: string, dryRun: boolean): Promise<{
  dryRun: boolean;
  pending: number;
  moved: number;
  failed: number;
  connections: ConnectionStatus[];
}> {
  const sources = await db.externalSource.findMany({
    where: { ...WORKSPACE_LEVEL, workspaceId, isActive: true, sourceType: { in: [...CALL_PROVIDER_IDS] } },
    orderBy: { createdAt: 'asc' },
  });
  const legacy = sources.filter(source => callConnectionService.hasLegacyRouting(source));

  const connections: ConnectionStatus[] = [];
  for (const source of legacy) {
    if (dryRun) {
      connections.push({ connectionId: source.id, status: 'pending' });
      continue;
    }
    try {
      // Re-read so an edit made since the listing isn't overwritten.
      const fresh = await db.externalSource.findUnique({ where: { id: source.id } });
      if (fresh) await callConnectionService.migrateLegacyRouting(fresh);
      connections.push({ connectionId: source.id, status: 'moved' });
    } catch (error) {
      connections.push({ connectionId: source.id, status: 'failed' });
      logger.error(`${TAG} failed`, {
        connectionId: source.id,
        workspaceId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const moved = connections.filter(connection => connection.status === 'moved').length;
  const failed = connections.filter(connection => connection.status === 'failed').length;
  return { dryRun, pending: legacy.length - moved, moved, failed, connections };
}

function callerWorkspaceId(req: Request, res: Response): string | null {
  const workspaceId = req.user?.workspaceId;
  if (!workspaceId) {
    res.status(401).json({ success: false, error: 'Workspace not found for user' });
    return null;
  }
  return workspaceId;
}

/** @route GET /api/admin/call-routing-backfill/status — `pending` is the caller's workspace's connections left to move. */
router.get(
  '/status',
  authMiddleware.authenticate,
  adminAuth,
  // Workspace scope, not the admin's own channels, so private desks are moved too.
  workspaceScopedRoute,
  route(async (req, res) => {
    const workspaceId = callerWorkspaceId(req, res);
    if (!workspaceId) return;
    const { pending, connections } = await backfill(workspaceId, true);
    res.status(200).json({ success: true, workspaceId, pending, connections });
  })
);

/** @route POST /api/admin/call-routing-backfill/run — body `{ dryRun?: true }`; runs on the caller's workspace. */
router.post(
  '/run',
  authMiddleware.authenticate,
  adminAuth,
  workspaceScopedRoute,
  route(async (req, res) => {
    const workspaceId = callerWorkspaceId(req, res);
    if (!workspaceId) return;
    const { dryRun } = z.object({ dryRun: z.boolean().default(true) }).parse(req.body ?? {});
    const result = await backfill(workspaceId, dryRun);
    logger.info(`${TAG} finished`, {
      workspaceId,
      dryRun,
      pending: result.pending,
      moved: result.moved,
      failed: result.failed,
    });
    res.status(200).json({ success: true, workspaceId, ...result });
  })
);

export default router;
