import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { AppError } from '@/middleware/errorHandler';
import { ensureInstalled } from '@/bypassAcl/appInstallService';

const router = Router();

function route(
  handler: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => void handler(req, res).catch(next);
}

const ensureInstalledSchema = z.object({
  orgId: z.string().min(1),
  name: z.string().min(1).trim(),
  description: z.string().trim().optional(),
  webhookUrlTemplate: z.string().min(1).optional(),
  permissions: z.array(z.string()).optional(),
  preferredCreatedByUserId: z.string().optional(),
  workspaceId: z.string().min(1),
  addToGeneralChannel: z.boolean().optional(),
});

/**
 * Idempotently ensure an org app exists and is installed in the given workspace.
 * Creates or adopts the org app (oldest same-name app wins), installs into the workspace,
 * and returns credentials. Safe to call on every workspace sync.
 */
router.post(
  '/ensure-installed',
  route(async (req, res) => {
    const parsed = ensureInstalledSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);
    const result = await ensureInstalled(parsed.data).catch((err: unknown) => {
      const code = (err as { statusCode?: number }).statusCode;
      throw code ? new AppError((err as Error).message, code) : err;
    });
    res.status(200).json(result);
  }),
);

export default router;
