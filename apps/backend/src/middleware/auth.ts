import { Request, Response, NextFunction } from 'express';
import { OrgRole, WorkspaceRole } from '@xyne/shared';
import { createHash } from 'crypto';
// import { OAuth2Client } from 'google-auth-library';
import { logger } from '../utils/logger';
import { loggerContext, LogContext } from '@/utils/logger';
import { UserService } from '../services/userService';
import { apiKeyService } from '../services/apiKeyService';
import { jwtService, type JwtPayload } from '../services/jwtService';
import { workspaceTokenCookieName, LAST_WORKSPACE_COOKIE } from '../services/accessTokenService';
import { decryptRequestBodyMiddleware } from './decryptionMiddleware';
import '../types/express'; // Import the Express type extensions
import { config } from '@/config/env';

/**
 * Why a JWT was rejected. The dashboard calls `GET /auth/refresh-session` on any of these and
 * retries; the middleware itself never refreshes.
 */
export type AuthFailureCode = 'TOKEN_MISSING' | 'TOKEN_EXPIRED' | 'TOKEN_INVALID';

/** Classify a jwtService.verifyToken failure. */
export const classifyTokenError = (error: unknown): Exclude<AuthFailureCode, 'TOKEN_MISSING'> =>
  error instanceof Error && error.message === 'JWT token has expired' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID';

export class AuthMiddleware {
  // private googleClient?: OAuth2Client;
  private userService?: UserService;
  private googleAuthEnabled: boolean;

  constructor() {
    const clientId = config.email.clientId;
    const clientSecret = config.email.clientSecret;

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
   * Supports multi-workspace cookies (workspace-specific tokens).
   * Never refreshes: an expired or missing JWT is a 401 with a code the client acts on.
   */
  authenticate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authHeader = req.headers.authorization;

    // Get workspace ID from header or last_workspace cookie
    const workspaceId = (req.headers['x-workspace-id'] as string) || req.cookies?.[LAST_WORKSPACE_COOKIE];
    const workspaceToken = workspaceId ? req.cookies?.[workspaceTokenCookieName(workspaceId)] : undefined;

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
            // No session key for API-key callers: an encrypted body is rejected (400) here.
            await decryptRequestBodyMiddleware(req, res, next);
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
        config.env === 'development' && config.enableDevAuth;
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
          nodeEnv: config.env,
          enableDevAuth: config.enableDevAuth,
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
          nodeEnv: config.env,
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

      // Normal Google JWT authentication
      // Extract token from Authorization header OR HTTP-only cookie
      logger.info(
        `[AUTH] Auth header: ${authHeader ? 'Present' : 'Missing'}, Workspace: ${workspaceId ? 'Present' : 'Missing'}`,
        {
          workspaceId,
          workspaceTokenPresent: !!workspaceToken,
          authHeaderPresent: !!authHeader,
        }
      );

      // Try to get token from Authorization header first, then from workspace-specific cookie
      let token: string | undefined;
      let tokenSource: 'authorization_header' | 'workspace_cookie' | 'none' = 'none';
      let tokenPreview: string | undefined;

      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
        tokenSource = 'authorization_header';
        tokenPreview = token ? `${token.slice(0, 8)}...${token.slice(-6)}` : undefined;
        logger.info(`[AUTH] Token extracted from Authorization header`, {
          tokenSource,
          tokenPresent: !!token,
          tokenPreview,
        });
      } else if (workspaceToken) {
        token = workspaceToken;
        tokenSource = 'workspace_cookie';
        tokenPreview = token ? `${token.slice(0, 8)}...${token.slice(-6)}` : undefined;
        logger.info(`[AUTH] Token extracted from workspace cookie [workspaceId=${workspaceId}]`, {
          tokenSource,
          workspaceId,
          tokenPresent: !!token,
          tokenPreview,
        });
      }

      // No token: 401. The client refreshes via /auth/refresh-session and retries.
      if (!token) {
        logger.warn(`[AUTH] Authentication failed: No token`, {
          tokenSource,
          authHeaderPresent: !!authHeader,
          workspaceId,
        });
        res.status(401).json({
          error: 'Authentication required',
          code: 'TOKEN_MISSING' satisfies AuthFailureCode,
          message: 'Please provide a valid authentication token',
        });
        return;
      }

      // Verify custom JWT token. Expired → 401 TOKEN_EXPIRED; no refresh here.
      let payload: JwtPayload;
      try {
        payload = jwtService.verifyToken(token);
      } catch (verifyError) {
        const code = classifyTokenError(verifyError);
        logger.info(`[AUTH] JWT token verification failed`, {
          tokenSource,
          tokenPreview,
          code,
          error: verifyError instanceof Error ? verifyError.message : 'Unknown error',
        });
        res.status(401).json({
          error: 'Invalid or expired session',
          code,
          message: code === 'TOKEN_EXPIRED' ? 'Token expired; refresh the session' : 'Token verification failed',
        });
        return;
      }

      // Extract user information from custom JWT token
      // Since we're using our own JWT, we can directly get user from database using the sub (user ID)
      logger.info(`[AUTH] Looking up user from verified token payload`, {
        tokenSource,
        tokenPreview,
        tokenSub: payload.sub,
        tokenEmail: payload.email,
      });
      const user = await this.userService!.getUserById(payload.sub);

      if (!user) {
        logger.warn(`[AUTH] User not found for verified token payload`, {
          tokenSource,
          tokenPreview,
          tokenSub: payload.sub,
        });
        res.status(401).json({
          error: 'User not found',
          message: 'User associated with this token no longer exists',
        });
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
      const hasWorkspaceClaims = payload.memberId && payload.workspaceId;

      let effectiveWorkspaceId: string | undefined = payload.workspaceId;
      let effectiveMemberId: string | undefined = payload.memberId;
      let effectiveOrgRole: string = user.orgMember.role;

      if (!hasWorkspaceClaims) {
        logger.info(`[AUTH] LEGACY JWT FORMAT - User ${payload.sub} using pre-workspace client`, {
          userId: payload.sub,
          tokenSource,
          tokenPreview,
        });

        // Use user's workspace and orgMember from DB (already fetched at line 456)
        effectiveWorkspaceId = user.workspaceId ?? undefined;
        effectiveMemberId = user.orgMemberId ?? undefined;
        effectiveOrgRole = user.orgMember.role;
      }

      if (!effectiveWorkspaceId || !effectiveMemberId) {
        logger.warn(`[AUTH] No workspace context resolved for user ${payload.sub}`, {
          tokenSource,
          tokenPreview,
          effectiveWorkspaceId,
          effectiveMemberId,
        });
        res.status(401).json({
          error: 'Workspace context missing',
          message: 'Unable to determine workspace for this session. Please log in again.',
        });
        return;
      }
      // END BACKWARD COMPAT

      // Attach user to request object
      req.user = {
        id: user.id,
        googleId: user.providerUserId,
        email: user.email,
        name: user.name,
        displayName: user.displayName,
        workspaceId: effectiveWorkspaceId,
        isApiKeyUser: false,
        scopes: [],
        role: user.role,
        orgRole: effectiveOrgRole,
        memberId: effectiveMemberId,
        sid: payload.sid,
      };

      logger.info(`[AUTH] Authenticated user: ${user.email} (${user.id})`, {
        tokenSource,
        tokenPreview,
        tokenSub: payload.sub,
        userId: user.id,
        googleId: user.providerUserId,
        email: user.email,
      });

      const cohort = String(
        createHash('sha256').update(user.id).digest().readUInt32BE(0) % 100
      );
      if (req.cookies?.u_cohort !== cohort) {
        const isProduction = config.env === 'production';
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

      // Session-key decryption of the body runs here, after req.user.sid is known.
      await decryptRequestBodyMiddleware(req, res, next);
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
        config.env === 'development' && config.enableDevAuth;
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
      const workspaceId = (req.headers['x-workspace-id'] as string) || req.cookies?.[LAST_WORKSPACE_COOKIE];

      // Get JWT token from workspace-specific cookie
      let token = workspaceId ? req.cookies?.[workspaceTokenCookieName(workspaceId)] : undefined;

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
        logger.warn('[AUTH] Zero auth failed: No token provided', { workspaceId });
        res.status(401).json({
          error: 'Authentication required',
          code: 'TOKEN_MISSING' satisfies AuthFailureCode,
          message: 'No token provided',
        });
        return;
      }

      // Verify custom JWT token (will throw if expired/invalid)
      let payload: JwtPayload;
      try {
        payload = jwtService.verifyToken(token);
        logger.info(
          `[AUTH] Zero auth: Token valid, expires at ${new Date((payload.exp ?? 0) * 1000).toISOString()}`
        );
      } catch (verifyError) {
        const code = classifyTokenError(verifyError);
        logger.warn('[AUTH] Zero auth failed: JWT token expired/invalid - returning 401', {
          code,
          error: verifyError instanceof Error ? verifyError.message : 'Unknown error',
        });
        res.status(401).json({
          error: 'Invalid or expired token',
          code,
          message: 'Token verification failed',
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
        sid: payload.sid,
      };

      const existingContext = loggerContext.getStore();
      const context: LogContext = {
        ...existingContext,
        emailId: user.email,
      };
      loggerContext.run(context, () => {
        logger.info(`[AUTH] Zero authenticated user: ${user.email} (${user.id})`);
        void decryptRequestBodyMiddleware(req, res, next);
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
