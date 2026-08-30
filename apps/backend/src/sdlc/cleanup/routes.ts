import { Router, type NextFunction, type Request, type Response } from 'express';
import { AccessType } from '@xyne/shared';
import { authorize } from '@/middleware/authorize';
import { backfillSdlcMultirepo, sdlcMultirepoBackfillSchema } from './multirepoBackfill';

/**
 * One-off SDLC data migrations. Mounted at /api/sdlc/cleanup, inheriting that
 * router's auth. Delete this directory and its two lines in routes/sdlc.ts once
 * every environment has run them.
 */
const router = Router();

/** Spans every workspace, so it is admin-only rather than actor-scoped. */
const adminAuth = authorize('TICKET-MIGRATION', AccessType.ADMIN);

function route(
  handler: (req: Request, res: Response) => Promise<void>
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    void handler(req, res).catch(next);
  };
}

/**
 * Turn every existing SDLC hub into a CHANNEL -> REPOSITORY membership edge, each
 * of its tracks into a CHANNEL -> TRACK edge, and stamp the owning channel onto
 * the content links that until now inherited it through their repository.
 *
 * Preview by default; send { "dryRun": false } to apply. Idempotent — re-running
 * after a partial pass picks up only the stragglers, and a preview reporting all
 * zeros is what says the migration is complete.
 */
router.post(
  '/multirepo-backfill',
  adminAuth,
  route(async (req, res) => {
    const input = sdlcMultirepoBackfillSchema.parse(req.body ?? {});
    const result = await backfillSdlcMultirepo(input);
    res.status(200).json({ success: true, ...result });
  })
);

export default router;
