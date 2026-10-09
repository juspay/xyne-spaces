import { Router, type NextFunction, type Request, type Response } from 'express';
import { bootstrapSdlcRuntimeCredentialSchema, createSdlcPullRequestSchema } from '@xyne/shared';
import { AppError } from '@/middleware/errorHandler';
import { sdlcVcs } from '@/sdlc/vcs';

const router = Router();

function route(
  handler: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => void handler(req, res).catch(next);
}

router.post(
  '/runtime-credentials/bootstrap',
  route(async (req, res) => {
    const binding = bootstrapSdlcRuntimeCredentialSchema.parse(req.body);
    const { envelope, repository } = await sdlcVcs.bootstrapSandboxCredential(binding);
    res.status(200).json(
      envelope
        ? { success: true, envelope, repository }
        : { success: true, anonymous: true, repository }
    );
  }),
);

router.post(
  '/pull-requests',
  route(async (req, res) => {
    const input = createSdlcPullRequestSchema.parse(req.body);
    // Without hub context the model fills actorUserId, so the signed session's user decides.
    if (input.actorUserId && String(req.headers['x-xyne-acting-user-id'] ?? '').trim() !== input.actorUserId) {
      throw new AppError('SDLC pull request binding mismatch', 403);
    }
    const pullRequest = await sdlcVcs.createPullRequest(input);
    res.status(201).json({ success: true, pullRequest });
  }),
);

export default router;
