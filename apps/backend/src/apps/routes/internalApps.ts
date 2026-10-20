import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { logger } from '@/utils/logger';
import { ensureInstalled } from '@/bypassAcl/appInstallService';

const router = Router();

const EnsureInstalledBodySchema = z.object({
  orgId: z.string().min(1),
  name: z.string().min(1).trim(),
  workspaceId: z.string().min(1),
  preferredCreatedByUserId: z.string().min(1).optional(),
  description: z.string().optional(),
  webhookUrlTemplate: z.string().url().optional(),
  permissions: z.array(z.string().min(1)).optional(),
  addToGeneralChannel: z.boolean().optional(),
});

/**
 * POST /api/internal/apps/ensure-installed
 *
 * Service-to-service endpoint (x-s2s-key auth, see app.ts mount). Called by claw-auth
 * during workspace sync to idempotently ensure a named org app exists and is installed in
 * the given workspace.
 *
 * Returns { appId, signingSecret, jwtToken, appCreated }.
 */
router.post('/ensure-installed', async (req: Request, res: Response): Promise<void> => {
  const bodyResult = EnsureInstalledBodySchema.safeParse(req.body);
  if (!bodyResult.success) {
    res.status(400).json({ error: 'Validation error', details: bodyResult.error.errors });
    return;
  }

  const {
    orgId,
    name,
    workspaceId,
    preferredCreatedByUserId,
    description,
    webhookUrlTemplate,
    permissions,
    addToGeneralChannel,
  } = bodyResult.data;

  try {
    const result = await ensureInstalled({
      orgId,
      name,
      targetWorkspaceId: workspaceId,
      preferredCreatedByUserId,
      description,
      webhookUrlTemplate,
      permissions,
      addToGeneralChannel,
    });
    res.status(200).json(result);
  } catch (error) {
    logger.error('[ensure-installed] failed', {
      orgId,
      name,
      workspaceId,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
