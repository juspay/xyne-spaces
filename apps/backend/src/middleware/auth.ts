import { Request, Response, NextFunction } from 'express';
import { OrgRole, WorkspaceRole } from '@xyne/shared';
import { createHash } from 'crypto';
// import { OAuth2Client } from 'google-auth-library';
import { logger } from '../utils/logger';
import { loggerContext, LogContext } from '@/utils/logger';
import { UserService } from '../services/userService';
import { apiKeyService } from '../services/apiKeyService';
import { jwtService } from '../services/jwtService';
import '../types/express'; // Import the Express type extensions
import { config } from '@/config/env';
import { applyResolvedAuth, resolveRequest } from '@/auth/sessionResolver';
import { platformFromRequest } from '@/auth/platform';
import { recordAuth401, recordAuthResolve, routeGroupFromPath } from '@/services/otel/authMetrics';

export class AuthMiddleware {
  // private googleClient?: OAuth2Client;
  private userService?: UserService;
  private googleAuthEnabled: boolean;

  constructor() {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    // Only initialize Google OAuth if credentials are provided
    this.googleAuthEnabled = !!(clientId && clientSecret);

    if (this.googleAuthEnabled) {
      // this.googleClient = new OAuth2Client(clientId, clientSecret);
      this.userService = new UserService();
      logger.info('[AUTH] Google OAuth authentication enabled');
    } else {
      logger.info('[AUTH] Google OAuth authentication disabled - API key only mode');
    }
  }

  /**
   * Middleware to authenticate requests using Google JWT tokens
   * Supports multi-workspace cookies (workspace-specific tokens)
   */
  authenticate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authHeader = req.headers.authorization;
    
    // Get workspace ID from header or last_workspace cookie
    const workspaceId = (req.headers['x-workspace-id'] as string) || req.cookies?.xyne_last_workspace;
    const workspaceToken = workspaceId ? req.cookies?.[`xyne_ws_${workspaceId}_token`] : undefined;
    const workspaceSession = req.cookies?.['user_session_id'];
    
    logger.info(`[AUTH] Auth middleware called for ${req.method} ${req.path}`, {
      method: req.method,
      path: req.path,
      authHeaderPresent: !!authHeader,
      workspaceId,
      workspaceTokenPresent: !!workspaceToken,
      clientIp: req.ip,
    });

    try {
      // Try API Key authentication first
      if (authHeader) {
        let apiKey: string | null = null;

        // Check for Bearer token format
        if (authHeader.startsWith('Bearer ')) {
          apiKey = apiKeyService.extractApiKey(authHeader);
        }
        // Check for Basic authentication format (curl -u)
        else if (authHeader.startsWith('Basic ')) {
          const base64Credentials = authHeader.split(' ')[1];
          const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
          const [username] = credentials.split(':');
          // Use username as API key (password is ignored)
          apiKey = username;
        }

        if (apiKey) {
          // Extract user details from headers
          const userHeaders = {
            name: req.headers['x-user-name'] as string,
            email: req.headers['x-user-email'] as string,
            workspaceId: req.headers['x-workspace-id'] as string,
          };

          const apiKeyUser = await apiKeyService.validateApiKey(apiKey, userHeaders);
          if (apiKeyUser) {
            // Attach API key user to request object
            req.user = {
              id: apiKeyUser.id,
              googleId: '', // API key users don't have Google ID
              email: apiKeyUser.email,
              name: apiKeyUser.username,
              isApiKeyUser: true,
              scopes: apiKeyUser.scopes,
              role: apiKeyUser.role,
              workspaceId: apiKeyUser.workspaceId,
              orgRole: apiKeyUser.orgRole,
              memberId: apiKeyUser.memberId,
            };

            logger.info(
              `[AUTH] API key authenticated user: ${apiKeyUser.username} (${apiKeyUser.id})`,
              {
                userId: apiKeyUser.id,
                username: apiKeyUser.username,
                email: apiKeyUser.email,
                role: apiKeyUser.role,
              }
            );
            next();
            return;
          }
        }
      }

      // If Google OAuth is not enabled and API key failed, return 401
      if (!this.googleAuthEnabled) {
        logger.warn(`[AUTH] Authentication failed: API key invalid and Google OAuth not configured`, {
          authHeaderPresent: !!authHeader,
        });
        res.status(401).json({
          error: 'Authentication required',
          message: 'Please provide a valid API key. Google OAuth is not configured.',
        });
        return;
      }

      // Continue with Google OAuth authentication if API key failed
      // Secure dev mode check - only allow in development environment
      const isDevEnvironment =
        process.env.NODE_ENV === 'development' && process.env.ENABLE_DEV_AUTH === 'true';
      const clientDevMode = req.headers['x-dev-mode'] === 'true';

      // Additional security: check if request is from localhost
      const isLocalhost =
        req.ip === '127.0.0.1' ||
        req.ip === '::1' ||
        req.ip === '::ffff:127.0.0.1' ||
        req.hostname === 'localhost' ||
        req.get('host')?.startsWith('localhost');

      if (isDevEnvironment && isLocalhost && clientDevMode) {
        logger.info('[AUTH] Secure dev mode detected, using mock user authentication', {
          nodeEnv: process.env.NODE_ENV,
          enableDevAuth: process.env.ENABLE_DEV_AUTH,
          clientIp: req.ip,
          hostname: req.hostname,
          host: req.get('host'),
        });

        const devUserId = req.headers['x-dev-user-id'] as string;
        const devUserEmail = req.headers['x-dev-user-email'] as string;
        const devUserName = req.headers['x-dev-user-name'] as string;

        if (!devUserId || !devUserEmail || !devUserName) {
          logger.warn(`[AUTH] Dev mode headers incomplete`, {
            devUserId,
            devUserEmail,
            devUserNamePresent: !!devUserName,
          });
          res.status(401).json({
            error: 'Authentication required',
            message: 'Dev mode headers incomplete',
          });
          return;
        }

        // Create or find dev user in database
        const devUserData = {
          googleId: devUserId,
          email: devUserEmail,
          name: devUserName,
          emailVerified: true,
        };

        const devWorkspaceId = req.headers['x-workspace-id'] as string;
        const { user } = await this.userService!.findOrCreateUser(devUserData, devWorkspaceId);

      // Attach user to request object
      req.user = {
        id: user.id,
        googleId: user.providerUserId,
        email: user.email,
        name: user.name,
        displayName: user.displayName,
        workspaceId: user.workspaceId,
        isApiKeyUser: false,
        scopes: [],
        role: user.role,
        orgRole: user.orgRole,
        memberId: user.orgMemberId,
      };

        logger.info(`[AUTH] Dev mode authenticated user: ${user.email} (${user.id})`, {
          userId: user.id,
          googleId: user.providerUserId,
          email: user.email,
        });
        next();
        return;
      }

      // Log dev mode rejection for security awareness
      if (clientDevMode && !isDevEnvironment) {
        logger.warn('[AUTH] Dev mode headers detected but rejected - not in development environment', {
          nodeEnv: process.env.NODE_ENV,
          clientIp: req.ip,
          hostname: req.hostname,
        });
      }

      if (clientDevMode && !isLocalhost) {
        logger.warn('[AUTH] Dev mode headers detected but rejected - not from localhost', {
          clientIp: req.ip,
          hostname: req.hostname,
          host: req.get('host'),
        });
      }

      // Normal JWT / session authentication: the shared resolver (Bearer JWT, workspace cookie
      // JWT, then the session path when the token is missing, expired, revoked or about to expire).
      const result = await resolveRequest(req, {
        allowBearer: true,
        allowAutoRefresh: true,
        refreshAheadSeconds: Math.min(300, Math.floor(config.jwt.expirationSeconds / 4)),
      });

      if (!result.ok) {
        logger.warn(`[AUTH] Authentication failed: ${result.reason}`, {
          reason: result.reason,
          authHeaderPresent: !!authHeader,
          workspaceId,
          workspaceTokenPresent: !!workspaceToken,
          workspaceSessionPresent: !!workspaceSession,
        });
        recordAuthResolve({ path: 'none', outcome: 'fail', reason: result.reason, refreshed: false, middleware: 'v1' });
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
      recordAuthResolve({ path: result.auth.path, outcome: 'ok', refreshed: !!result.auth.refreshed, middleware: 'v1' });
      const user = result.auth.user;

      logger.info(`[AUTH] Authenticated user: ${user.email} (${user.id})`, {
        path: result.auth.path,
        refreshed: !!result.auth.refreshed,
        userId: user.id,
        googleId: user.googleId,
        email: user.email,
        workspaceId: user.workspaceId,
      });

      const cohort = String(
        createHash('sha256').update(user.id).digest().readUInt32BE(0) % 100
      );
      if (req.cookies?.u_cohort !== cohort) {
        const isProduction = process.env.NODE_ENV === 'production';
        res.cookie('u_cohort', cohort, {
          httpOnly: true,
          secure: isProduction,
          sameSite: 'lax',
          path: '/',
          maxAge: config.session.expiryDays * 24 * 60 * 60 * 1000,
        });
        if (!req.cookies) {
          req.cookies = {};
        }
        req.cookies.u_cohort = cohort;
      }

      next();
    } catch (error) {
      logger.error(`[AUTH] Authentication error:`, {
        authHeaderPresent: !!authHeader,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });

      res.status(401).json({
        error: 'Authentication failed',
        message: 'Unable to verify authentication token',
      });
    }
  };

  /**
   * Optional middleware - allows authenticated or unauthenticated requests
   * If token is provided and valid, user will be attached to request
   */
  optionalAuthenticate = async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Check for secure dev mode (same security checks as authenticate)
      const isDevEnvironment =
        process.env.NODE_ENV === 'development' && process.env.ENABLE_DEV_AUTH === 'true';
      const clientDevMode = req.headers['x-dev-mode'] === 'true';
      const isLocalhost =
        req.ip === '127.0.0.1' ||
        req.ip === '::1' ||
        req.ip === '::ffff:127.0.0.1' ||
        req.hostname === 'localhost' ||
        req.get('host')?.startsWith('localhost');

      if (isDevEnvironment && isLocalhost && clientDevMode) {
        // Use the full authenticate method for dev mode
        await this.authenticate(req, res, next);
        return;
      }

      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        // No token provided, continue without authentication
        return next();
      }

      // If token is provided, validate it
      await this.authenticate(req, res, next);
    } catch (error) {
      // If optional auth fails, log but continue
      logger.warn('[AUTH] Optional authentication failed:', error);
      next();
    }
  };

  /**
   * Middleware to check if user has required scope (for API key users)
   */
  requireScope = (requiredScope: string) => {
    return (req: Request, res: Response, next: NextFunction): void => {
      if (!req.user) {
        res.status(401).json({
          error: 'Authentication required',
          message: 'Please authenticate to access this resource',
        });
        return;
      }

      // For API key users, check scopes
      if (req.user.isApiKeyUser) {
        if (req.user.role === 'admin') {
          // Admin users have access to everything
          next();
          return;
        }

        if (!req.user.scopes || !req.user.scopes.includes(requiredScope)) {
          res.status(403).json({
            error: 'Insufficient permissions',
            message: `Required scope: ${requiredScope}`,
            userScopes: req.user.scopes,
          });
          return;
        }
      }

      // For Google OAuth users, allow access (existing behavior)
      next();
    };
  };

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

  /**
   * Middleware for Zero endpoints - NO auto-refresh
   * Returns 401 if token is missing or expired, forcing frontend to refresh explicitly
   */
  authenticateZero = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    logger.info(`[AUTH] Zero auth middleware called for ${req.method} ${req.path}`);

    try {
      // Get workspace ID from header or cookie
      const workspaceId = (req.headers['x-workspace-id'] as string) || req.cookies?.xyne_last_workspace;
      
      // Get JWT token from workspace-specific cookie
      let token = workspaceId ? req.cookies?.[`xyne_ws_${workspaceId}_token`] : undefined;

      // Try API Key authentication first
      const authHeader = req.headers.authorization;

      if (!token && authHeader) {
        // Check for Bearer token format
        if (authHeader.startsWith('Bearer ')) {
          token = authHeader.split(' ')[1];
        }
      }

      // If no token, return 401 immediately (NO auto-refresh for Zero endpoints)
      if (!token) {
        logger.warn('[AUTH] Zero auth failed: No token provided', {
          workspaceId,
          workspaceTokenPresent: !!req.cookies?.[`xyne_ws_${workspaceId}_token`],
        });
        res.status(401).json({
          error: 'Authentication required',
          message: 'No token provided',
        });
        return;
      }

      // Verify custom JWT token (will throw if expired/invalid)
      let payload: any;
      try {
        payload = jwtService.verifyToken(token);
        logger.info(
          `[AUTH] Zero auth: Token valid, expires at ${new Date(payload.exp * 1000).toISOString()}`
        );
      } catch (verifyError) {
        logger.warn('[AUTH] Zero auth failed: JWT token expired/invalid - returning 401');
        logger.info(
          '[AUTH] Error details:',
          verifyError instanceof Error ? verifyError.message : 'Unknown error'
        );
        res.status(401).json({
          error: 'Invalid or expired token',
          message: 'Token verification failed',
        });
        return;
      }

      if (!payload) {
        res.status(401).json({
          error: 'Invalid token',
          message: 'JWT token payload is invalid',
        });
        return;
      }

      // Get user from database
      const user = await this.userService!.getUserById(payload.sub);

      if (!user) {
        res.status(401).json({
          error: 'User not found',
          message: 'User associated with this token no longer exists',
        });
        return;
      }

      // Attach user to request object
      req.user = {
        id: user.id,
        googleId: user.providerUserId,
        email: user.email,
        name: user.name,
        displayName: user.displayName,
        workspaceId: user.workspaceId,
        isApiKeyUser: false,
        scopes: [],
        role: user.role,
        orgRole: user.orgMember!.role,
        memberId: payload.memberId,
      };

      const existingContext = loggerContext.getStore();
      const context: LogContext = {
        ...existingContext,
        emailId: user.email,
      };
      loggerContext.run(context, () => {
        logger.info(`[AUTH] Zero authenticated user: ${user.email} (${user.id})`);
        next();
      });
    } catch (error) {
      logger.error('[AUTH] Zero authentication error:', error);

      res.status(401).json({
        error: 'Authentication failed',
        message: 'Unable to verify authentication token',
      });
    }
  };
}

// Export singleton instance
export const authMiddleware = new AuthMiddleware();
