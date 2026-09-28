import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { AccessType } from '@xyne/shared';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';
import { logger } from '@/utils/logger';
import { backfillSdlcRepoCredentials as backfill } from '@/bypassAcl/sdlcServices';

const router = Router();
const adminAuth = authorize('TICKET-MIGRATION', AccessType.ADMIN);
const TAG = '[sdlc-repo-credential-backfill]';

function route(
  handler: (req: Request, res: Response) => Promise<void>
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => void handler(req, res).catch(next);
}

/** @route GET /api/admin/sdlc-repo-credential-backfill/status — `pending` is the work left. */
router.get(
  '/status',
  authMiddleware.authenticate,
  adminAuth,
  route(async (_req, res) => {
    const { pending, legacyCredentials } = await backfill(true);
    res.status(200).json({ success: true, pending, legacyCredentials });
  })
);

/** @route POST /api/admin/sdlc-repo-credential-backfill/run — body `{ dryRun?: true }`. */
router.post(
  '/run',
  authMiddleware.authenticate,
  adminAuth,
  route(async (req, res) => {
    const { dryRun } = z.object({ dryRun: z.boolean().default(true) }).parse(req.body ?? {});
    const result = await backfill(dryRun);
    logger.info(`${TAG} finished`, { dryRun, pending: result.pending, updated: result.updated });
    res.status(200).json({ success: true, ...result });
  })
);

export default router;
