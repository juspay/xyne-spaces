import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { logger } from '@/utils/logger';
import { decrypt } from '@/services/encryptionService';
import { repositories } from '@/database/repositories';
import jwt from 'jsonwebtoken';

const TokenPayloadSchema = z.object({
  appId: z.string().min(1, 'appId is required').trim(),
  userId: z.string().min(1, 'userId is required').trim(),
});

// Generic error message — don't leak internal details to attackers
const AUTH_ERROR_MSG = 'Authentication failed';

/**
 * Middleware to authenticate external app requests using JWT token from Authorization header.
 *
 * Security flow:
 * 1. Extract JWT from Authorization header
 * 2. Decode header only to get appId (from unverified payload — only used for DB lookup)
 * 3. Look up signing secret from DB
 * 4. Verify JWT signature using the secret — this is where trust is established
 * 5. Validate verified payload structure
 */
export async function authenticateApp(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // 1. Extract JWT token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      sendError(res, 401);
      return;
    }

    const jwtToken = authHeader.substring(7);
    if (!jwtToken.trim()) {
      sendError(res, 401);
      return;
    }

    // 2. Decode WITHOUT verification — only to extract appId/userId for DB lookup.
    // We don't trust this data yet. It's only used to find the signing secret.
    const decoded = jwt.decode(jwtToken);
    const tokenResult = TokenPayloadSchema.safeParse(decoded);
    if (!tokenResult.success) {
      logger.warn('[APP-AUTH] Token payload structure invalid');
      sendError(res, 401);
      return;
    }

    const { appId, userId } = tokenResult.data;

    // 3. Look up installed app to get signing secret
    const installedApp = await repositories.installedApps.findFirst({
      where: { appId, userId },
    });

    if (!installedApp) {
      // Don't log appId/userId — attacker could be probing
      logger.warn('[APP-AUTH] Installed app not found');
      sendError(res, 401);
      return;
    }

    // 4. Decrypt the APP-LEVEL signing secret and VERIFY the JWT — this is the actual auth check
    const app = await repositories.apps.findById(appId);
    if (!app?.signingSecret) {
      logger.warn('[APP-AUTH] App signing secret missing');
      sendError(res, 401);
      return;
    }
    const signingSecret = decrypt(app.signingSecret);

    let verified: unknown;
    try {
      verified = jwt.verify(jwtToken, signingSecret, {
        algorithms: ['HS256'],  // Restrict to expected algorithm — prevents algorithm confusion attacks
      });
    } catch (error) {
      logger.warn('[APP-AUTH] JWT verification failed');
      sendError(res, 401);
      return;
    }

    // 5. Validate the VERIFIED payload — now we trust this data
    const verifiedResult = TokenPayloadSchema.safeParse(verified);
    if (!verifiedResult.success) {
      logger.warn('[APP-AUTH] Verified token payload invalid');
      sendError(res, 401);
      return;
    }

    // Load permissions by status.
    // approved + delete = currently effective (active).
    // hasPendingChanges = true when any permission is 'new' or 'delete',
    // meaning a reinstall is needed to fully apply the changes.
    const { effectiveNames, hasPendingChanges } =
      await repositories.appPermissions.getGrantedPermissionsWithMeta(installedApp.id);

    if (hasPendingChanges) {
      logger.warn(
        `[APP-AUTH] Permission changes pending reinstall for installedApp ${installedApp.id}`,
      );
    }

    (req as any).auth = {
      appId: verifiedResult.data.appId,
      permissions: effectiveNames,
      installedAppId: installedApp.id,
      permissionsStale: hasPendingChanges,
      installedAppCreatedAt: installedApp.createdAt,
    };

    // Fetch user to get workspaceId for downstream controllers that expect req.user.
    // Use the userId from the verified token, not the unverified decode.
    const user = await repositories.users.findById(verifiedResult.data.userId);
    if (!user) {
      logger.warn('[APP-AUTH] User not found for app token');
      sendError(res, 401);
      return;
    }

    // Fetch orgMember to get orgRole
    const orgMember = await repositories.orgMembers.findById(user.orgMemberId);

    // Set req.user for compatibility with controllers that expect workspaceId
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

    next();
  } catch (error) {
    logger.error('[APP-AUTH] Unexpected error:', error);
    sendError(res, 500);
  }
}

function sendError(res: Response, status: number): void {
  res.status(status).json({
    error: status === 500 ? 'Internal server error' : 'Unauthorized',
    message: AUTH_ERROR_MSG,
  });
}
