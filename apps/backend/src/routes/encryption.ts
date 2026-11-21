import { Router, type Request, type Response } from 'express';
import { DatabaseClient } from '@/database/client';
import { getEncryptionProvider } from '@/services/encryption';
import { logger } from '@/utils/logger';

const router = Router();
const prisma = DatabaseClient.getInstance();

// Dashboard bundles that still bootstrap here (instead of `/api/transit/config`) register an
// RSA-wrapped session key only when a client encryption flag is on. The backend has no RSA
// key any more, so these bundles get both flags off and run plaintext.
router.get('/public-key', (req: Request, res: Response) => {
  const sessionId = req.user?.sid;
  if (!req.user || !sessionId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  res.json({
    publicKey: '',
    encryptedFields: {},
    clientEncryptionEnabled: false,
    apiClientEncryptionEnabled: false,
    sessionFingerprint: sessionId,
  });
});

router.post('/register-client-key', (_req: Request, res: Response) => {
  res.status(410).json({
    error: 'Gone',
    message: 'RSA session keys are no longer supported; reload to get a bundle that uses /api/transit',
  });
});

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
