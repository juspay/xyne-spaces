import { Router, type Request, type Response } from 'express';
import { DatabaseClient } from '@/database/client';
import { getEncryptionProvider } from '@/services/encryption';
import { logger } from '@/utils/logger';

const router = Router();
const prisma = DatabaseClient.getInstance();

router.post('/workspaces/backfill-provision', async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const canProvisionOrganization = req.user.orgRole === 'OWNER' || req.user.orgRole === 'ADMIN';
  if (!canProvisionOrganization) {
    res.status(403).json({ error: 'Forbidden', message: `Organization administrator access required` });
    return;
  }

  try {
    const currentWorkspaces = await prisma.workspace.findMany({
      where: {
        id: req.user.workspaceId,
        users: { some: { id: req.user.id } },
      },
      select: {
        id: true,
        orgId: true,
      },
    });
    if (currentWorkspaces.length === 0) {
      res.status(403).json({ error: 'Forbidden', message: 'Workspace access not found' });
      return;
    }

    const currentWorkspace = currentWorkspaces[0];
    const workspaces = await prisma.workspace.findMany({
      where: { orgId: currentWorkspace.orgId },
      select: { id: true, orgId: true },
    });

    const results = await getEncryptionProvider().backfillEntities(workspaces.flatMap((workspace) => (
      ['WORKSPACE', 'WORKSPACE_STORAGE'].map((entityType) => ({
        entityId: workspace.id,
        orgId: workspace.orgId,
        entityType,
      }))
    )));

    res.json({
      ok: results.every((result) => result.ok),
      results,
    });
  } catch (err) {
    logger.error('Failed to provision workspace encryption', {
      userId: req.user.id,
      workspaceId: req.user.workspaceId,
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(502).json({
      error: 'Encryption service unavailable',
      message: 'Failed to provision workspace encryption',
    });
  }
});

export default router;
