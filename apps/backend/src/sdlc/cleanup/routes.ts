import { Router, type NextFunction, type Request, type Response } from 'express';
import { AppError } from '@/middleware/errorHandler';
import { sdlcHubTeardownSchema, teardownSdlcHub } from './hubTeardown';
import type { SdlcActor } from '../types';

/**
 * One-off cleanup for SDLC hubs created by the code BEFORE ca3b73606
 * ("fix: XYNE-56726 SDLC channel naming ..."), which is what production ran.
 * Those channels are `name: '<Repo> · SDLC'`, `type: 'DEFAULT'`,
 * `metadata: { surface, hiddenFromChat: true, repoId }` — un-renameable and
 * hidden from the chat directory. Hubs created at or after that commit are
 * `type: 'SDLC'` with no `hiddenFromChat`; this endpoint converts those too, but
 * they are not what it exists for.
 *
 * Mounted at /api/sdlc/cleanup, inheriting that router's auth. Delete this
 * directory and its two lines in routes/sdlc.ts once production has no
 * `metadata->>'surface' = 'SDLC'` channels left.
 */
const router = Router();

function actorFromRequest(req: Request): SdlcActor {
  const userId = req.user?.id;
  const workspaceId = req.user?.workspaceId;
  if (!userId || !workspaceId) {
    throw new AppError('Unauthorized', 401);
  }
  return { userId, workspaceId };
}

function route(
  handler: (req: Request, res: Response) => Promise<void>
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    void handler(req, res).catch(next);
  };
}

/** Preview by default; send { "dryRun": false } to apply. One channel per call. */
router.post(
  '/channels/:channelId/teardown',
  route(async (req, res) => {
    const input = sdlcHubTeardownSchema.parse(req.body ?? {});
    const plan = await teardownSdlcHub(actorFromRequest(req), req.params.channelId, input);
    res.status(200).json({ success: true, ...plan });
  })
);

export default router;
