import { Router, type Request, type Response } from 'express';
import { DatabaseClient } from '@/database/client';
import { getEncryptionProvider } from '@/services/encryption';
import { logger } from '@/utils/logger';
import { getClientSessionFingerprint } from '@/auth/sessionTokens';
import { findById as findAuthSessionById } from '@/bypassAcl/authSessionServices';

const router = Router();
const prisma = DatabaseClient.getInstance();

/*
 * The encryption key store is keyed by the client's session FINGERPRINT (sha256 of the opaque
 * `xs` token, or the legacy `user_sessions.id` for sessions converted from it), never the raw
 * token. The dashboard receives it as `sessionFingerprint` and echoes it back in `x-session-id`
 * on encrypted bodies; `getClientSessionFingerprint` accepts both forms.
 */

router.get('/public-key', async (req: Request, res: Response) => {
  const fingerprint = getClientSessionFingerprint(req);
  if (!req.user || !fingerprint) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const data = await getEncryptionProvider().getPublicConfig();
    res.json({ ...data, sessionFingerprint: fingerprint });
  } catch (err) {
    res.status(502).json({ error: 'Encryption service unavailable' });
  }
});

router.post('/register-client-key', async (req: Request, res: Response) => {
  const fingerprint = getClientSessionFingerprint(req);
  if (!req.user || !req.authSession || !fingerprint) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { wrappedKey } = req.body as { wrappedKey?: string };
  if (!wrappedKey) {
    res.status(400).json({ error: 'Bad request', message: 'wrappedKey is required' });
    return;
  }

  let orgId: string;
  try {
    // Liveness: the session the request resolved through must still be ACTIVE and unexpired
    // (it may have been revoked between the middleware read and this write).
    const [session, workspace] = await Promise.all([
      findAuthSessionById(req.authSession.sessionId),
      prisma.workspace.findFirst({
        where: {
          id: req.user.workspaceId,
          users: { some: { id: req.user.id } },
        },
        select: { orgId: true },
      }),
    ]);

    const sessionLive =
      !!session &&
      session.accountId === req.authSession.accountId &&
      session.status === 'ACTIVE' &&
      session.absoluteExpiry.getTime() > Date.now();
    if (!sessionLive) {
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
    const result = await getEncryptionProvider().registerSessionKey({
      wrappedKey,
      sessionId: fingerprint,
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

    const results = await getEncryptionProvider().backfillEntities(workspaces.map((workspace) => ({
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
