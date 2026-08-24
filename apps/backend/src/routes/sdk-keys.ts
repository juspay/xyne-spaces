/**
 * Self-service API keys for the public SDK.
 *
 * Session-authenticated, and scoped to the caller throughout: a key belongs to
 * the `User` row that minted it, which is itself workspace-scoped, so a key
 * always acts in exactly one workspace. Someone with access to two workspaces
 * mints separately from each.
 *
 * Distinct from `/api/admin/api-keys`, which is admin-only and manages a
 * different thing — `apiKeyService` service keys with their own scope model.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { API_KEY_TTL_CHOICES, apiKeyExpiryFrom, mintApiKey } from '@/api/sdk/auth';

const router = Router();

/** How many live keys one user may hold at a time. */
const MAX_LIVE_KEYS = 2;

const createBody = z.object({
  name: z.string().trim().min(1).max(80),
  ttlDays: z
    .number()
    .refine((d): d is (typeof API_KEY_TTL_CHOICES)[number] => (API_KEY_TTL_CHOICES as readonly number[]).includes(d), {
      message: `ttlDays must be one of: ${API_KEY_TTL_CHOICES.join(', ')}`,
    }),
});

interface KeySummary {
  id: string;
  name: string;
  createdAt: Date;
  expiresAt: Date;
  /** Last four characters, enough to tell two keys apart in a list. */
  hint: string;
  expired: boolean;
  revoked: boolean;
  revokedAt: Date | null;
}

function summarize(row: {
  id: string;
  name: string;
  token: string;
  status: string;
  revokedAt: Date | null;
  createdAt: Date;
  expiresAt: Date;
}): KeySummary {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    hint: row.token.slice(-4),
    expired: row.expiresAt.getTime() <= Date.now(),
    revoked: row.status === 'REVOKED',
    revokedAt: row.revokedAt,
  };
}

/**
 * List the caller's keys.
 *
 * Expired and revoked keys are returned rather than hidden, so the list
 * explains why a key stopped working instead of appearing to have lost it.
 */
router.get('/', async (req: Request, res: Response) => {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  try {
    const rows = await db.sdkApiKey.findMany({
      where: { userId: user.id, workspaceId: user.workspaceId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        token: true,
        status: true,
        revokedAt: true,
        createdAt: true,
        expiresAt: true,
      },
    });

    res.json({
      keys: rows.map(summarize),
      maxLiveKeys: MAX_LIVE_KEYS,
    });
  } catch (error) {
    logger.error('[sdk-keys] list failed', { userId: user.id, error });
    res.status(500).json({ error: 'Failed to list API keys' });
  }
});

/**
 * Mint a key and return it once.
 *
 * The plaintext value is in this response and nowhere else afterwards. It is
 * recoverable in principle — the column is reversibly encrypted — but the API
 * deliberately never returns it again, so a leaked key is replaced rather than
 * re-read.
 */
router.post('/', async (req: Request, res: Response) => {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const parsed = createBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: `A name (1-80 characters) and a ttlDays of ${API_KEY_TTL_CHOICES.join(', ')} are required.`,
    });
    return;
  }

  try {
    // Only live keys count against the limit: an expired or revoked one must
    // never block minting its replacement.
    const liveKeys = await db.sdkApiKey.count({
      where: {
        userId: user.id,
        workspaceId: user.workspaceId,
        status: 'ACTIVE',
        expiresAt: { gt: new Date() },
      },
    });
    if (liveKeys >= MAX_LIVE_KEYS) {
      res.status(409).json({
        error: `You already have ${MAX_LIVE_KEYS} active API keys. Delete one to create another.`,
      });
      return;
    }

    // `orgId` is not on the session principal, and the key has to carry it —
    // the Claw relay passes it through as `spacesOrgId`.
    const orgMember = await db.orgMember.findUnique({
      where: { memberId: user.memberId },
      select: { orgId: true },
    });
    if (!orgMember) {
      logger.error('[sdk-keys] no org membership for caller', {
        userId: user.id,
        memberId: user.memberId,
      });
      res.status(409).json({ error: 'Your account has no organization membership.' });
      return;
    }

    const token = mintApiKey({
      sub: user.id,
      email: user.email,
      name: user.name,
      workspaceId: user.workspaceId,
      orgId: orgMember.orgId,
      memberId: user.memberId,
    });

    const row = await db.sdkApiKey.create({
      data: {
        name: parsed.data.name,
        userId: user.id,
        workspaceId: user.workspaceId,
        token,
        expiresAt: apiKeyExpiryFrom(parsed.data.ttlDays),
      },
      select: {
        id: true,
        name: true,
        token: true,
        status: true,
        revokedAt: true,
        createdAt: true,
        expiresAt: true,
      },
    });

    logger.info('[sdk-keys] key created', { userId: user.id, keyId: row.id });
    res.status(201).json({ ...summarize(row), key: token });
  } catch (error) {
    logger.error('[sdk-keys] create failed', { userId: user.id, error });
    res.status(500).json({ error: 'Failed to create API key' });
  }
});

/**
 * Revoke one of the caller's keys. Takes effect on the next request.
 *
 * Soft: the row stays, `status` flips to `REVOKED`, `revokedAt` records when.
 * A hard delete would lose that — `GET /` couldn't tell "you deleted this" from
 * "this never existed," and there would be nothing left to audit.
 */
router.delete('/:id', async (req: Request, res: Response) => {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  try {
    // Scoped by userId, workspaceId, and current status: an id belonging to
    // someone else, or already revoked, is a no-op rather than a change.
    const { count } = await db.sdkApiKey.updateMany({
      where: {
        id: req.params['id'],
        userId: user.id,
        workspaceId: user.workspaceId,
        status: 'ACTIVE',
      },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });

    if (count === 0) {
      res.status(404).json({ error: 'No such API key' });
      return;
    }

    logger.info('[sdk-keys] key revoked', { userId: user.id, keyId: req.params['id'] });
    res.status(204).end();
  } catch (error) {
    logger.error('[sdk-keys] revoke failed', { userId: user.id, error });
    res.status(500).json({ error: 'Failed to delete API key' });
  }
});

export default router;
