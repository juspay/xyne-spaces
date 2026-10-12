import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { AccessType } from '@xyne/shared';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';
import { logger } from '@/utils/logger';
import {
  getReleaseConfigHubBackfillStatus,
  runReleaseConfigHubBackfill,
} from '@/bypassAcl/releaseConfigHubBackfillServices';

const router = Router();
const adminAuth = authorize('TICKET-MIGRATION', AccessType.ADMIN);
const TAG = '[release-config-hub-backfill]';

const runSchema = z
  .object({
    dryRun: z.boolean().default(true),
    move: z
      .array(
        z.object({
          projectId: z.string().min(1),
          hubChannelId: z.string().min(1),
          mainBoardId: z.string().min(1).optional(),
          repoId: z.string().min(1).optional(),
          releaseChannelId: z.string().min(1).optional(),
        })
      )
      .default([]),
    remove: z.array(z.string().min(1)).default([]),
  })
  .superRefine((body, ctx) => {
    const moved = body.move.map((move) => move.projectId);
    if (
      new Set(body.remove).size !== body.remove.length ||
      body.remove.some((projectId) => moved.includes(projectId))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A removed project may appear once, and not in move',
      });
    }
    // A whole-project move is the project's only entry; per-board moves name each board once.
    const wholeProject = new Set(
      body.move.filter((move) => !move.mainBoardId).map((move) => move.projectId)
    );
    const boards = body.move.flatMap((move) => (move.mainBoardId ? [move.mainBoardId] : []));
    if (
      wholeProject.size !== moved.length - boards.length ||
      body.move.some((move) => move.mainBoardId && wholeProject.has(move.projectId)) ||
      new Set(boards).size !== boards.length
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Move a project once, or each of its main release boards once',
      });
    }
  });

function route(
  handler: (req: Request, res: Response) => Promise<void>
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => void handler(req, res).catch(next);
}

/**
 * @route GET /api/admin/release-config-hub-backfill/status
 * @desc Every project with a release config: its configs and services, the registered
 *       repositories they match, the project's SDLC hubs and which have that
 *       repository, and whether each config is on a hub yet. Writes nothing.
 * @access TICKET-MIGRATION Admin only
 */
router.get(
  '/status',
  authMiddleware.authenticate,
  adminAuth,
  route(async (_req, res) => {
    res.status(200).json(await getReleaseConfigHubBackfillStatus());
  })
);

/**
 * @route POST /api/admin/release-config-hub-backfill/run
 * @desc Deletes the `remove` projects' release configs (their services, hub edges and
 *       their boards' channel links; boards, tickets and canvases stay), then moves each
 *       `move` project's configs to its SDLC hub as a hub save would leave them.
 *       Body: { dryRun?: true,
 *               move?: [{ projectId, hubChannelId, mainBoardId?, repoId?, releaseChannelId? }],
 *               remove?: [projectId] }
 *       mainBoardId moves one config of the project instead of all of them.
 *       A dry run reports what each project would get, after every check. One
 *       transaction per project; a failed project writes nothing and reports why.
 *       Idempotent — safe to re-run.
 * @access TICKET-MIGRATION Admin only
 */
router.post(
  '/run',
  authMiddleware.authenticate,
  adminAuth,
  route(async (req, res) => {
    const options = runSchema.parse(req.body ?? {});
    logger.info(`${TAG} started`, options);
    res.status(200).json(await runReleaseConfigHubBackfill(options));
  })
);

export default router;
