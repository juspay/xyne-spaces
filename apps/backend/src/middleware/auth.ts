import { Request, Response, NextFunction } from 'express';
import { OrgRole, UserStatus, WorkspaceRole } from '@xyne/shared';
import { createHash } from 'crypto';
import { logger as baseLogger, loggerContext, type LogContext } from '@/utils/logger';
import { readWorkspaceJwt } from '../services/accessTokenService';
import { decryptRequestBodyMiddleware } from './decryptionMiddleware';
import { db } from '@/database/client';
import '../types/express';
import { config } from '@/config/env';
import {
  EMAIL_DOMAIN_NOT_ALLOWED_ERROR,
  EMAIL_DOMAIN_NOT_ALLOWED_MESSAGE,
  isEmailDomainAllowed,
} from '@/services/emailDomainPolicy';

const logger = baseLogger.child({ module: 'AuthMiddleware' });

/**
 * Why a request was rejected (401 body `code`). The dashboard decides from this whether to call
 * `GET /auth/refresh-session` and retry, or to go straight to the login page; the middleware
 * itself never refreshes.
 *
 * Refreshable (the session may still be alive, only the JWT is gone):
 * - TOKEN_MISSING — no JWT cookie. The cookie's maxAge equals the JWT lifetime, so a browser
 *   drops it at expiry; this is the usual form an expired token arrives in.
 * - TOKEN_EXPIRED — the JWT arrived but is past `exp` (clock skew, non-browser clients).
 *
 * Final (a refresh cannot help, the client should log out):
 * - TOKEN_INVALID — bad signature, malformed, no `sid`, or claims that do not match the request.
 * - SESSION_REVOKED — the auth session behind the token is no longer ACTIVE in Postgres: logged
 *   out, password changed/reset, superseded by a newer login on the device, revoked by an admin,
 *   or past its expiry.
 * - USER_REMOVED — the user left or was deactivated in the workspace or organisation.
 * - EMAIL_DOMAIN_NOT_ALLOWED — the user's email domain is blocked by policy.
 */
export type AuthFailureCode =
  | 'TOKEN_MISSING'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_INVALID'
  | 'SESSION_REVOKED'
  | 'USER_REMOVED'
  | 'EMAIL_DOMAIN_NOT_ALLOWED';

/** Codes the client may answer with a `/auth/refresh-session` call; every other code is final. */
export const REFRESHABLE_AUTH_FAILURE_CODES: ReadonlySet<AuthFailureCode> = new Set<AuthFailureCode>([
  'TOKEN_MISSING',
  'TOKEN_EXPIRED',
]);

/**
 * RFC 6750 `WWW-Authenticate` challenge for a 401. The bearer vocabulary has no "expired" value:
 * a missing credential is a bare challenge, everything else is `invalid_token`.
 */
const wwwAuthenticateFor = (code: AuthFailureCode, message: string): string => {
  const description = message.replace(/["\\]/g, '');
  return code === 'TOKEN_MISSING'
    ? 'Bearer realm="xyne"'
    : `Bearer realm="xyne", error="invalid_token", error_description="${description}"`;
};

/** 401 code and message for each way readWorkspaceJwt can reject a presented token. */
const TOKEN_REJECTIONS: Record<'expired' | 'invalid' | 'revoked', [AuthFailureCode, string]> = {
  expired: ['TOKEN_EXPIRED', 'Token expired; refresh the session'],
  invalid: ['TOKEN_INVALID', 'Token verification failed'],
  revoked: ['SESSION_REVOKED', 'Session has been logged out'],
};

export class AuthMiddleware {
  private reject(res: Response, code: AuthFailureCode, message: string, error = 'Authentication required'): void {
    res.setHeader('WWW-Authenticate', wwwAuthenticateFor(code, message));
    res.status(401).json({ error, code, message });
  }

  /**
   * The only authentication for user routes. Reads the JWT from the `xyne_ws_<workspaceId>_token`
   * cookie (workspace from `x-workspace-id`, else `xyne_last_workspace`); an Authorization header
   * is never read. The auth session (`sid`), the user and the org member are re-checked in
   * Postgres on every request.
   */
  authenticate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const logPrefix = `[AUTH] [${req.method} ${req.path}]`;

    try {
      // Signature, claims and the auth session (Postgres) in one place; see readWorkspaceJwt.
      const read = await readWorkspaceJwt(req);
      if (read.status === 'missing') {
        logger.info(`${logPrefix} No token`, { workspaceId: read.workspaceId });
        this.reject(res, 'TOKEN_MISSING', 'Session token is missing');
        return;
      }
      const tokenPreview = `${read.token.slice(0, 8)}...${read.token.slice(-6)}`;
      if (read.status !== 'valid') {
        const [code, message] = TOKEN_REJECTIONS[read.status];
        const log = read.status === 'expired' ? logger.info.bind(logger) : logger.warn.bind(logger);
        log(`${logPrefix} Token rejected: ${code}`, { tokenPreview, workspaceId: read.workspaceId, reason: read.reason });
        this.reject(res, code, message);
        return;
      }
      const { token, payload } = read;

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
        this.reject(res, 'USER_REMOVED', 'You have been removed from this workspace', 'User removed from workspace');
        return;
      }

      if (orgMember.leftAt) {
        logger.warn(`${logPrefix} User removed from organization: ${user.email}`, {
          userId: user.id,
          orgMemberLeftAt: orgMember.leftAt,
        });
        this.reject(res, 'USER_REMOVED', 'You have been removed from this organization', 'User removed from organization');
        return;
      }

      if (!isEmailDomainAllowed(user.email)) {
        logger.warn(`${logPrefix} Request rejected (reason=email_domain_not_allowed)`, { userId: user.id });
        this.reject(res, 'EMAIL_DOMAIN_NOT_ALLOWED', EMAIL_DOMAIN_NOT_ALLOWED_MESSAGE, EMAIL_DOMAIN_NOT_ALLOWED_ERROR);
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
      req.authToken = token;

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
