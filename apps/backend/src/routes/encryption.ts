import { Router, type Request, type Response } from 'express';
import { SessionStatus } from '@xyne/shared';
import { config } from '@/config/env';
import { DatabaseClient } from '@/database/client';
import {
  backfillEncryptionEntityBatch,
  getEncryptionPublicKey,
  registerClientKey,
} from '@/services/internal/encryption-client';
import { logger } from '@/utils/logger';

const router = Router();
const prisma = DatabaseClient.getInstance();

router.get('/public-key', async (req: Request, res: Response) => {
  const sessionId = req.authenticatedSessionId ?? req.cookies?.user_session_id;
  if (!req.user || !sessionId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  if (!config.enc.clientEncryptionEnabled && !config.enc.apiClientEncryptionEnabled) {
    res.json({
      publicKey: '',
      sessionFingerprint: sessionId,
      encryptedFields: {},
      clientEncryptionEnabled: false,
      apiClientEncryptionEnabled: false,
    });
    return;
  }

  try {
    const data = await getEncryptionPublicKey();
    res.json({ ...data, sessionFingerprint: sessionId });
  } catch (err) {
    res.status(502).json({ error: 'Encryption service unavailable' });
  }
});

router.post('/register-client-key', async (req: Request, res: Response) => {
  const sessionId = req.authenticatedSessionId ?? req.cookies?.user_session_id;
  if (!req.user || !sessionId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { wrappedKey } = req.body as { wrappedKey?: string };
  if (!wrappedKey) {
    res.status(400).json({ error: 'Bad request', message: 'wrappedKey is required' });
    return;
  }

  if (!config.enc.clientEncryptionEnabled && !config.enc.apiClientEncryptionEnabled) {
    res.json({ ok: false, sessionFingerprint: sessionId });
    return;
  }

  let orgId: string;
  try {
    const [session, workspace] = await prisma.$transaction([
      prisma.userSession.findFirst({
        where: {
          id: sessionId,
          userId: req.user.id,
          status: SessionStatus.ACTIVE,
          refreshTokenExpiry: { gt: new Date() },
        },
        select: { id: true },
      }),
      prisma.workspace.findFirst({
        where: {
          id: req.user.workspaceId,
          users: { some: { id: req.user.id } },
        },
        select: { orgId: true },
      }),
    ]);

    if (!session) {
      res.status(401).json({ error: 'Unauthorized', message: 'Active session not found' });
      return;
    }
    if (!workspace) {
      res.status(403).json({ error: 'Forbidden', message: 'Workspace access not found' });
      return;
    }

    orgId = workspace.orgId;
  } catch (err) {
    logger.error('Failed to validate encryption key registration context', {
      userId: req.user.id,
      workspaceId: req.user.workspaceId,
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'Failed to validate encryption key registration' });
    return;
  }

  try {
    const result = await registerClientKey({
      wrappedKey,
      sessionId,
      userId: req.user.id,
      orgId,
    });
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: 'Encryption service unavailable' });
  }
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

    const results = await backfillEncryptionEntityBatch(workspaces.map((workspace) => ({
      entityId: workspace.id,
      orgId: workspace.orgId,
      entityType: 'WORKSPACE',
    })));

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
