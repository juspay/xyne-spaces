import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { AccessType } from '@xyne/shared';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';
import { logger } from '@/utils/logger';
import {
  getSdlcFolderEdgeBackfillStatus,
  runSdlcFolderEdgeBackfill,
} from '@/bypassAcl/sdlcFolderEdgeBackfillServices';

const router = Router();
const adminAuth = authorize('TICKET-MIGRATION', AccessType.ADMIN);
const TAG = '[sdlc-folder-edge-backfill]';

/**
 * 50 edges every 10 seconds by default. Nine batches keep one request near 90s, under
 * proxy timeouts; continue with `nextCursor` for the rest.
 */
const runSchema = z.object({
  dryRun: z.boolean().default(true),
  batchSize: z.number().int().min(1).max(500).default(50),
  delayMs: z.number().int().min(0).default(10_000),
  maxBatches: z.number().int().min(1).default(9),
  cursor: z.string().min(1).nullable().default(null),
});

function route(
  handler: (req: Request, res: Response) => Promise<void>
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => void handler(req, res).catch(next);
}

/**
 * @route GET /api/admin/sdlc-folder-edge-backfill/status
 * @desc What is left, without writing: folder edges to add and to remove, per hub.
 * @access TICKET-MIGRATION Admin only
 */
router.get(
  '/status',
  authMiddleware.authenticate,
  adminAuth,
  route(async (_req, res) => {
    res.status(200).json(await getSdlcFolderEdgeBackfillStatus());
  })
);

/**
 * @route POST /api/admin/sdlc-folder-edge-backfill/run
 * @desc Adds every item's missing folder edges and removes stale ones.
 *       Body: { dryRun?: true, batchSize?: 50, delayMs?: 10000, maxBatches?: 9,
 *               cursor?: string }
 *       A dry run reports the same as /status, from `cursor` on. A real run returns
 *       each batch, the totals, `done` and `nextCursor`; pass `nextCursor` back as
 *       `cursor` until `done`. Idempotent — safe to re-run.
 * @access TICKET-MIGRATION Admin only
 */
router.post(
  '/run',
  authMiddleware.authenticate,
  adminAuth,
  route(async (req, res) => {
    const options = runSchema.parse(req.body ?? {});
    logger.info(`${TAG} started`, options);
    res.status(200).json(await runSdlcFolderEdgeBackfill(options));
  })
);

export default router;
