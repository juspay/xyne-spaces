import { Request, Response, NextFunction } from 'express';
import { OrgRole, UserStatus, WorkspaceRole } from '@xyne/shared';
import { createHash } from 'crypto';
import { logger as baseLogger, loggerContext, type LogContext } from '@/utils/logger';
import { jwtService, type JwtPayload } from '../services/jwtService';
import { workspaceTokenCookieName, LAST_WORKSPACE_COOKIE } from '../services/accessTokenService';
import { decryptRequestBodyMiddleware } from './decryptionMiddleware';
import { db } from '@/database/client';
import '../types/express';
import { config } from '@/config/env';

const logger = baseLogger.child({ module: 'AuthMiddleware' });

/**
 * Why a request was rejected. The dashboard calls `GET /auth/refresh-session` on any of these and
 * retries; the middleware itself never refreshes.
 */
export type AuthFailureCode = 'TOKEN_MISSING' | 'TOKEN_EXPIRED' | 'TOKEN_INVALID';

/** Classify a jwtService.verifyToken failure. */
export const classifyTokenError = (error: unknown): Exclude<AuthFailureCode, 'TOKEN_MISSING'> =>
  error instanceof Error && error.message === 'JWT token has expired' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID';

export class AuthMiddleware {
  private reject(res: Response, code: AuthFailureCode, message: string): void {
    res.status(401).json({ error: 'Authentication required', code, message });
  }

  /**
   * The only authentication for user routes. Reads the JWT from the `xyne_ws_<workspaceId>_token`
   * cookie (workspace from `x-workspace-id`, else `xyne_last_workspace`); an Authorization header
   * is never read. The user and org member are re-checked on every request.
   */
  authenticate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const logPrefix = `[AUTH] [${req.method} ${req.path}]`;
    const workspaceId = (req.headers['x-workspace-id'] as string) || req.cookies?.[LAST_WORKSPACE_COOKIE];

    try {
      const token = workspaceId ? req.cookies?.[workspaceTokenCookieName(workspaceId)] : undefined;
      if (typeof token !== 'string' || !token) {
        logger.info(`${logPrefix} No token`, { workspaceId });
        this.reject(res, 'TOKEN_MISSING', 'Session token is missing');
        return;
      }
      const tokenPreview = `${token.slice(0, 8)}...${token.slice(-6)}`;

      let payload: JwtPayload;
      try {
        payload = jwtService.verifyToken(token);
      } catch (err) {
        const code = classifyTokenError(err);
        logger.info(`${logPrefix} Token rejected: ${code}`, {
          tokenPreview,
          error: err instanceof Error ? err.message : String(err),
        });
        this.reject(res, code, code === 'TOKEN_EXPIRED' ? 'Token expired; refresh the session' : 'Token verification failed');
        return;
      }

      if (!payload.sub || !payload.workspaceId || !payload.memberId || payload.workspaceId !== workspaceId) {
        logger.warn(`${logPrefix} Token claims do not match the request`, {
          tokenPreview,
          tokenWorkspaceId: payload.workspaceId,
          workspaceId,
        });
        this.reject(res, 'TOKEN_INVALID', 'Token payload is invalid');
        return;
      }

      const [user, orgMember] = await Promise.all([
        db.user.findUnique({
          where: { id: payload.sub },
          select: {
            id: true,
            role: true,
            email: true,
            name: true,
            displayName: true,
            status: true,
            leftAt: true,
            workspaceId: true,
            orgMemberId: true,
            providerUserId: true,
            authProvider: true,
          },
        }),
        db.orgMember.findUnique({
          where: { memberId: payload.memberId },
          select: { role: true, leftAt: true },
        }),
      ]);

      if (!user || !orgMember || user.workspaceId !== payload.workspaceId || user.orgMemberId !== payload.memberId) {
        logger.warn(`${logPrefix} Token valid, but user or org member not found`, { tokenPreview, tokenSub: payload.sub });
        this.reject(res, 'TOKEN_INVALID', 'User associated with this token no longer exists');
        return;
      }

      if (user.leftAt || user.status === UserStatus.INACTIVE) {
        logger.warn(`${logPrefix} User removed from or deactivated in workspace: ${user.email}`, {
          userId: user.id,
          leftAt: user.leftAt,
          status: user.status,
        });
        res.status(401).json({
          error: 'User removed from workspace',
          message: 'You have been removed from this workspace',
        });
        return;
      }

      if (orgMember.leftAt) {
        logger.warn(`${logPrefix} User removed from organization: ${user.email}`, {
          userId: user.id,
          orgMemberLeftAt: orgMember.leftAt,
        });
        res.status(401).json({
          error: 'User removed from organization',
          message: 'You have been removed from this organization',
        });
        return;
      }

      req.user = {
        id: user.id,
        googleId: user.providerUserId,
        email: user.email,
        name: user.name,
        displayName: user.displayName,
        workspaceId: payload.workspaceId,
        role: user.role,
        orgRole: orgMember.role,
        memberId: payload.memberId,
        authProvider: user.authProvider,
        sid: payload.sid,
        tokenExpiresAt: payload.exp ? payload.exp * 1000 : undefined,
      };

      this.setCohortCookie(req, res, user.id);

      const context: LogContext = { ...loggerContext.getStore(), emailId: user.email };
      await loggerContext.run(context, async () => {
        logger.info(`${logPrefix} Authenticated user: ${user.email} (${user.id})`, { tokenPreview });
        // Session-key decryption of the body runs here, after req.user.sid is known.
        await decryptRequestBodyMiddleware(req, res, next);
      });
    } catch (error) {
      logger.error(`${logPrefix} Authentication error`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
      res.status(500).json({
        error: 'Authentication failed',
        message: 'Internal server error during authentication',
      });
    }
  };

  private setCohortCookie(req: Request, res: Response, userId: string): void {
    const cohort = String(createHash('sha256').update(userId).digest().readUInt32BE(0) % 100);
    if (req.cookies?.u_cohort === cohort) return;
    res.cookie('u_cohort', cohort, {
      httpOnly: true,
      secure: config.env === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: config.session.expiryDays * 24 * 60 * 60 * 1000,
    });
    if (!req.cookies) req.cookies = {};
    req.cookies.u_cohort = cohort;
  }

  /**
   * Middleware to require admin role
   */
  requireAdmin = (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        error: 'Authentication required',
        message: 'Please authenticate to access this resource',
      });
      return;
    }

    if (req.user.role !== 'admin') {
      res.status(403).json({
        error: 'Admin access required',
        message: 'This endpoint requires admin privileges',
      });
      return;
    }

    next();
  };

  /**
   * Middleware to require workspace or organization admin/owner access.
   */
  requireAdminOrOwner = (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        error: 'Authentication required',
        message: 'Please authenticate to access this resource',
      });
      return;
    }

    const isPrivileged =
      req.user.orgRole === OrgRole.OWNER ||
      req.user.orgRole === OrgRole.ADMIN ||
      req.user.role === WorkspaceRole.OWNER ||
      req.user.role === WorkspaceRole.ADMIN;

    if (!isPrivileged) {
      res.status(403).json({
        error: 'Admin or owner access required',
        message: 'This endpoint requires administrator or owner privileges',
      });
      return;
    }

    next();
  };
}

export const authMiddleware = new AuthMiddleware();
