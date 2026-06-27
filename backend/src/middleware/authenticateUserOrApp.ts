import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { authMiddleware } from './auth';
import { decrypt } from '@/services/encryptionService';
import { repositories } from '@/database/repositories';
import { logger } from '@/utils/logger';

/**
 * Dual-auth middleware: accepts both regular user auth and app auth.
 *
 * Peeks at the Bearer token (decoded without verification) to check for an
 * `appId` claim. If present, performs app JWT verification and sets req.user
 * without mutating req.body. Otherwise falls through to authMiddleware.authenticate.
 */

const TokenPayloadSchema = z.object({
  appId: z.string().min(1).trim(),
  userId: z.string().min(1).trim(),
});

export async function authenticateUserOrApp(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    if (token) {
      try {
        const decoded = jwt.decode(token);
        if (decoded && typeof decoded === 'object' && 'appId' in decoded) {
          logger.info('[AUTH] App token detected, routing to app auth', {
            method: req.method,
            path: req.path,
          });
          return handleAppAuth(token, decoded, req, res, next);
        }
      } catch {
        // Decode failed — fall through to user auth
      }
    }
  }

  return authMiddleware.authenticate(req, res, next);
}

/**
 * Inline app auth that mirrors authenticateApp logic but does NOT mutate req.body.
 */
async function handleAppAuth(
  token: string,
  decoded: unknown,
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parseResult = TokenPayloadSchema.safeParse(decoded);
    if (!parseResult.success) {
      logger.warn('[AUTH] App token payload structure invalid');
      res.status(401).json({ error: 'Unauthorized', message: 'Authentication failed' });
      return;
    }

    const { appId, userId } = parseResult.data;

    const installedApp = await repositories.installedApps.findFirst({
      where: { appId, userId },
    });

    if (!installedApp) {
      logger.warn('[AUTH] Installed app not found');
      res.status(401).json({ error: 'Unauthorized', message: 'Authentication failed' });
      return;
    }

    const app = await repositories.apps.findById(appId);
    if (!app?.signingSecret) {
      logger.warn('[AUTH] App signing secret missing');
      res.status(401).json({ error: 'Unauthorized', message: 'Authentication failed' });
      return;
    }
    const signingSecret = decrypt(app.signingSecret);

    let verified: unknown;
    try {
      verified = jwt.verify(token, signingSecret, { algorithms: ['HS256'] });
    } catch {
      logger.warn('[AUTH] App JWT verification failed');
      res.status(401).json({ error: 'Unauthorized', message: 'Authentication failed' });
      return;
    }

    const verifiedResult = TokenPayloadSchema.safeParse(verified);
    if (!verifiedResult.success) {
      logger.warn('[AUTH] Verified app token payload invalid');
      res.status(401).json({ error: 'Unauthorized', message: 'Authentication failed' });
      return;
    }

    const user = await repositories.users.findById(verifiedResult.data.userId);
    if (!user) {
      logger.warn('[AUTH] User not found for app token');
      res.status(401).json({ error: 'Unauthorized', message: 'Authentication failed' });
      return;
    }

    const orgMember = await repositories.orgMembers.findById(user.orgMemberId);

    req.user = {
      id: user.id,
      googleId: user.providerUserId,
      email: user.email,
      name: user.name,
      workspaceId: user.workspaceId,
      memberId: user.orgMemberId,
      role: user.role,
      orgRole: orgMember?.role ?? 'MEMBER',
    };

    logger.info(`[AUTH] App-authenticated user: ${user.email} (${user.id})`, {
      appId: verifiedResult.data.appId,
      method: req.method,
      path: req.path,
    });

    next();
  } catch (error) {
    logger.error('[AUTH] App auth unexpected error:', error);
    res.status(500).json({ error: 'Internal server error', message: 'Authentication failed' });
  }
}
