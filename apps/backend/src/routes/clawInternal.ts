/**
 * Internal routes for the Claw services only (XYNE_CLAW_S2S_KEY), mounted at
 * /api/internal/claw.
 */
import { Router, type Request, type Response } from 'express';
import { DatabaseClient } from '@/database/client';
import { validateClawS2SKey } from '@/middleware/validateS2SKey';
import { logger } from '@/utils/logger';

const router = Router();

router.use(validateClawS2SKey);

/**
 * POST /user-profile { userId }: the Spaces profile xyne-claw-auth creates its own
 * user row from, the first time that user reaches it. claw-auth has no access to
 * the Spaces DB, so it asks here.
 */
router.post('/user-profile', async (req: Request, res: Response) => {
  try {
    const { userId } = (req.body ?? {}) as { userId?: unknown };
    if (typeof userId !== 'string' || !userId.trim()) {
      res.status(400).json({ error: 'userId is required' });
      return;
    }
    const prisma = DatabaseClient.getInstance();
    const user = await prisma.user.findUnique({
      where: { id: userId.trim() },
      select: {
        id: true,
        email: true,
        name: true,
        orgMemberId: true,
        workspaceId: true,
        workspace: { select: { orgId: true } },
      },
    });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      spacesOrgMemberId: user.orgMemberId || null,
      workspaceId: user.workspaceId || null,
      spacesOrgId: user.workspace?.orgId ?? null,
    });
  } catch (err) {
    logger.error('[claw-internal] user-profile failed', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

export default router;
