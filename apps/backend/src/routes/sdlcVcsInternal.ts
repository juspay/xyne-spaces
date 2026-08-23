import { Router, type NextFunction, type Request, type Response } from 'express';
import { bootstrapSdlcRuntimeCredentialSchema, createSdlcPullRequestSchema } from '@xyne/shared';
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
    const envelope = await sdlcVcs.bootstrapSandboxCredential(binding);
    res.status(200).json(
      envelope ? { success: true, envelope } : { success: true, anonymous: true }
    );
  }),
);

router.post(
  '/pull-requests',
  route(async (req, res) => {
    const input = createSdlcPullRequestSchema.parse(req.body);
    const pullRequest = await sdlcVcs.createDraftPullRequest(input);
    res.status(201).json({ success: true, pullRequest });
  }),
);

export default router;
