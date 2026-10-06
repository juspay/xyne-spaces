import { Request, Response, NextFunction } from 'express';
import { logger as baseLogger } from '../utils/logger';
import '../types/express';
import { applyResolvedAuth, resolveRequest } from '@/auth/sessionResolver';
import { platformFromRequest } from '@/auth/platform';
import { recordAuth401, recordAuthResolve, routeGroupFromPath } from '@/services/otel/authMetrics';

const logger = baseLogger.child({ module: 'AuthV2Middleware' });

/**
 * Cookie-only authentication (no `Authorization: Bearer`): workspace JWT cookie first, then the
 * shared session path (`xyne_session` / `user_session_id` / `x-session-id`) which mints a fresh
 * JWT cookie. All decisions live in `src/auth/sessionResolver.ts`.
 */
class AuthV2Middleware {
  authenticate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const logPrefix = `[Auth] [${req.method} ${req.path}]`;
    const workspaceHint = (req.headers['x-workspace-id'] as string | undefined) || req.cookies?.xyne_last_workspace;

    try {
      const result = await resolveRequest(req, { allowBearer: false, allowAutoRefresh: true });

      if (!result.ok) {
        logger.warn(`[AUTH] ${logPrefix} Authentication FAILED. ${result.reason}`, {
          method: req.method,
          path: req.path,
          reason: result.reason,
          status: result.status,
          workspaceId: workspaceHint,
          workspaceTokenPresent: workspaceHint ? !!req.cookies?.[`xyne_ws_${workspaceHint}_token`] : false,
          sessionCookiePresent: !!req.cookies?.xyne_session,
          legacySessionPresent: !!(req.cookies?.user_session_id || req.headers['x-session-id']),
        });
        recordAuthResolve({ path: 'none', outcome: 'fail', reason: result.reason, refreshed: false, middleware: 'v2' });
        if (result.status === 401) {
          recordAuth401({
            reason: result.reason,
            platform: platformFromRequest(req),
            routeGroup: routeGroupFromPath(`${req.baseUrl || ''}${req.path || ''}`),
          });
        }
        res.status(result.status).json(result.body);
        return;
      }

      applyResolvedAuth(req, res, result.auth);
      recordAuthResolve({ path: result.auth.path, outcome: 'ok', refreshed: !!result.auth.refreshed, middleware: 'v2' });

      logger.info(`[AUTH] ${logPrefix} Authenticated user: ${result.auth.user.email}`, {
        path: result.auth.path,
        refreshed: !!result.auth.refreshed,
        lazyGranted: !!result.auth.lazyGranted,
        userId: result.auth.user.id,
        googleId: result.auth.user.googleId,
        email: result.auth.user.email,
        workspaceId: result.auth.workspaceId,
        sessionId: result.auth.session?.id ?? null,
        legacySessionId: result.auth.legacySessionId,
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
