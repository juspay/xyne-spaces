import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { AccessType } from '@xyne/shared';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';
import { logger } from '@/utils/logger';
import { backfillLegacyCallRouting as backfill } from '@/bypassAcl/callRoutingBackfillServices';

// TODO: one-off. Delete after it has run in prod, with the legacy-routing move code in callConnectionService.
const router = Router();
const adminAuth = authorize('TICKET-MIGRATION', AccessType.ADMIN);
const TAG = '[call-routing-backfill]';

function route(
  handler: (req: Request, res: Response) => Promise<void>
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => void handler(req, res).catch(next);
}

/** @route GET /api/admin/call-routing-backfill/status — `pending` is the call connections left to move. */
router.get(
  '/status',
  authMiddleware.authenticate,
  adminAuth,
  route(async (_req, res) => {
    const { pending, connections } = await backfill(true);
    res.status(200).json({ success: true, pending, connections });
  })
);

/** @route POST /api/admin/call-routing-backfill/run — body `{ dryRun?: true }`. */
router.post(
  '/run',
  authMiddleware.authenticate,
  adminAuth,
  route(async (req, res) => {
    const { dryRun } = z.object({ dryRun: z.boolean().default(true) }).parse(req.body ?? {});
    const result = await backfill(dryRun);
    logger.info(`${TAG} finished`, {
      dryRun,
      pending: result.pending,
      moved: result.moved,
      failed: result.failed,
    });
    res.status(200).json({ success: true, ...result });
  })
);

export default router;
