import { Request, Response, NextFunction } from 'express';
import { logger as baseLogger } from '../utils/logger';
import '../types/express';
import { attachResolvedAuth, resolveRequest } from '@/auth/sessionResolver';

const logger = baseLogger.child({ module: 'AuthV2Middleware' });

/**
 * Cookie-only authentication for the dashboard routes. The workspace claim is `x-workspace-id`
 * (fallback `xyne_last_workspace`); the credential is the per-workspace access JWT cookie
 * `xw_<ws>`, verified statelessly (signature + Redis tombstone on `sid`). When that cookie is
 * missing, invalid or about to expire, the resolver falls back to the opaque session cookie `xs`
 * (legacy names still read), checks the membership row and mints a fresh `xw_<ws>` on this same
 * response. No Bearer: a token must not stand in for a session here.
 */
class AuthV2Middleware {
  authenticate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const logPrefix = `[Auth] [${req.method} ${req.path}]`;

    try {
      const resolved = await resolveRequest(req, { allowBearer: false, middleware: 'v2' });
      if (!resolved.ok) {
        logger.warn(`[AUTH] ${logPrefix} Authentication FAILED: ${resolved.reason}`, {
          method: req.method,
          path: req.path,
          reason: resolved.reason,
        });
        res.status(resolved.status).json(resolved.body);
        return;
      }

      attachResolvedAuth(req, res, resolved.auth);

      logger.info(`[AUTH] ${logPrefix} Authenticated user: ${resolved.auth.user.email}`, {
        path: resolved.auth.path,
        userId: resolved.auth.user.id,
        workspaceId: resolved.auth.workspaceId,
        sessionId: resolved.auth.session?.id,
      });
      next();
    } catch (error) {
      logger.error(`[AUTH] ${logPrefix} CRITICAL middleware error:`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
      res.status(500).json({
        error: 'Authentication failed',
        message: 'Internal server error during authentication',
      });
    }
  };
}

export const authV2Middleware = new AuthV2Middleware();
