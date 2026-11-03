import { Request, Response, NextFunction } from 'express';
import { jwtService } from '../services/jwtService';
import { logger as baseLogger } from '../utils/logger';
import '../types/express';
import { LAST_WORKSPACE_COOKIE, workspaceTokenCookieName } from '../services/accessTokenService';
import { classifyTokenError, type AuthFailureCode } from './auth';
import { decryptRequestBodyMiddleware } from './decryptionMiddleware';
import { db } from '@/database/client';

const logger = baseLogger.child({ module: 'AuthV2Middleware' });

/**
 * Auth for the /auth routes: verifies the workspace JWT cookie and loads fresh roles.
 * Never refreshes — an expired/missing token is a 401 carrying a code; the client calls
 * GET /auth/refresh-session (the only place a JWT is re-minted) and retries.
 */
class AuthV2Middleware {
  /**
   * Helper to extract token from workspace-specific cookie
   * Uses X-Workspace-Id header or xyne_last_workspace cookie
   */
  private extractToken(req: Request): string | null {
    const workspaceId = (req.headers['x-workspace-id'] as string) || req.cookies?.[LAST_WORKSPACE_COOKIE];

    if (workspaceId) {
      return req.cookies?.[workspaceTokenCookieName(workspaceId)] || null;
    }

    return null;
  }

  private reject(res: Response, code: AuthFailureCode, message: string): void {
    res.status(401).json({ error: 'Authentication required', code, message });
  }

  authenticate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const logPrefix = `[Auth] [${req.method} ${req.path}]`;
    const workspaceId = (req.headers['x-workspace-id'] as string) || req.cookies?.[LAST_WORKSPACE_COOKIE];

    try {
      const token = this.extractToken(req);
      const tokenPreview = token ? `${token.slice(0, 8)}...${token.slice(-6)}` : undefined;
      logger.info(`[AUTH] ${logPrefix} Token extraction result: ${!!token}`, {
        method: req.method,
        path: req.path,
        workspaceId,
        tokenPresent: !!token,
        tokenPreview,
      });

      if (!token) {
        logger.info(`[AUTH] ${logPrefix} No token provided`);
        this.reject(res, 'TOKEN_MISSING', 'Session token is missing');
        return;
      }

      let decoded;
      try {
        decoded = jwtService.verifyToken(token);
      } catch (err) {
        const code = classifyTokenError(err);
        logger.info(`[AUTH] ${logPrefix} Token rejected: ${code}`, {
          tokenPreview,
          error: err instanceof Error ? err.message : String(err),
        });
        this.reject(res, code, code === 'TOKEN_EXPIRED' ? 'Token expired; refresh the session' : 'Token verification failed');
        return;
      }

      if (!decoded?.sub) {
        this.reject(res, 'TOKEN_INVALID', 'Token payload is invalid');
        return;
      }

      /**
       * BACKWARD COMPATIBILITY SUPPORT
       *
       * Old JWTs contain only { sub: userId }. New JWTs include
       * { workspaceId, memberId, role, orgRole }.
       *
       * For old tokens: look up workspace context from DB so the request
       * can proceed without requiring re-login.
       */
      const hasWorkspaceClaims = decoded.memberId && decoded.workspaceId;

      let effectiveWorkspaceId: string | undefined = decoded.workspaceId;
      let effectiveMemberId: string | undefined = decoded.memberId;

      if (!hasWorkspaceClaims) {
        logger.info(`[AUTH] ${logPrefix} LEGACY JWT FORMAT - User ${decoded.sub} using pre-workspace client`, {
          userId: decoded.sub,
          tokenPreview,
        });

        const legacyUser = await db.user.findUnique({
          where: { id: decoded.sub },
          select: { workspaceId: true, orgMemberId: true },
        });

        effectiveWorkspaceId = legacyUser?.workspaceId ?? undefined;
        effectiveMemberId = legacyUser?.orgMemberId ?? undefined;
      }
      // END BACKWARD COMPAT

      if (!effectiveWorkspaceId || !effectiveMemberId) {
        logger.warn(`[AUTH] ${logPrefix} No workspace context resolved for user ${decoded.sub}`, {
          tokenPreview,
          effectiveWorkspaceId,
          effectiveMemberId,
        });
        res.status(401).json({
          error: 'Workspace context missing',
          code: 'TOKEN_INVALID' satisfies AuthFailureCode,
          message: 'Unable to determine workspace for this session. Please log in again.',
        });
        return;
      }

      // Fetch fresh roles from database using parallel queries
      const [user, orgMember] = await Promise.all([
        db.user.findUnique({
          where: { id: decoded.sub },
          select: {
            id: true,
            role: true,
            email: true,
            name: true,
            displayName: true,
            leftAt: true,
            providerUserId: true,
            authProvider: true,
          }
        }),
        db.orgMember.findUnique({
          where: { memberId: effectiveMemberId },
          select: { role: true, leftAt: true }
        })
      ]);

      if (!user) {
        logger.warn(`[AUTH] ${logPrefix} Token valid, but user not found in DB: ${decoded.sub}`, {
          tokenPreview,
          tokenSub: decoded.sub,
        });
        this.reject(res, 'TOKEN_INVALID', 'User associated with this token no longer exists');
        return;
      }

      if (user.leftAt) {
        logger.warn(`[AUTH] ${logPrefix} User has been removed from workspace: ${user.email}`, {
          tokenPreview,
          userId: user.id,
          leftAt: user.leftAt,
        });
        res.status(401).json({
          error: 'User removed from workspace',
          message: 'You have been removed from this workspace',
        });
        return;
      }

      if (orgMember?.leftAt) {
        logger.warn(`[AUTH] ${logPrefix} User has been removed from organization: ${user.email}`, {
          tokenPreview,
          userId: user.id,
          orgMemberLeftAt: orgMember.leftAt,
        });
        res.status(401).json({
          error: 'User removed from organization',
          message: 'You have been removed from this organization',
        });
        return;
      }

      // Use fresh roles from database
      const workspaceRole = user.role;
      const orgRole = orgMember!.role;

      req.user = {
        id: user.id,
        googleId: user.providerUserId,
        email: user.email,
        name: user.name,
        displayName: user.displayName,
        workspaceId: effectiveWorkspaceId,
        role: workspaceRole,
        orgRole: orgRole,
        memberId: effectiveMemberId,
        authProvider: user.authProvider,
        sid: decoded.sid,
      };
      logger.info(`[AUTH] ${logPrefix} Token verified successfully for user: ${user.email}`, {
        tokenPreview,
        tokenSub: decoded.sub,
        userId: user.id,
        googleId: user.providerUserId,
        email: user.email,
        workspaceRole,
        orgRole,
      });
      // Session-key decryption of the body runs here, after req.user.sid is known.
      await decryptRequestBodyMiddleware(req, res, next);
    } catch (error) {
      logger.error(`[AUTH] ${logPrefix} CRITICAL middleware error:`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
      res.status(500).json({
        error: 'Authentication failed',
        message: 'Internal server error during authentication'
      });
    }
  };
}

export const authV2Middleware = new AuthV2Middleware();
