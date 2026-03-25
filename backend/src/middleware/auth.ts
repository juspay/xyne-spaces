import { Request, Response, NextFunction } from 'express';
// import { OAuth2Client } from 'google-auth-library';
import { logger } from '../utils/logger';
import { loggerContext, LogContext } from '@/utils/logger';
import { UserService } from '../services/userService';
import { UserSessionService } from '../services/userSessionService';
import { apiKeyService } from '../services/apiKeyService';
import { jwtService } from '../services/jwtService';
import '../types/express'; // Import the Express type extensions
import { config } from '@/config/env';

export class AuthMiddleware {
  // private googleClient?: OAuth2Client;
  private userService?: UserService;
  private userSessionService?: UserSessionService;
  private googleAuthEnabled: boolean;

  constructor() {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    // Only initialize Google OAuth if credentials are provided
    this.googleAuthEnabled = !!(clientId && clientSecret);

    if (this.googleAuthEnabled) {
      // this.googleClient = new OAuth2Client(clientId, clientSecret);
      this.userService = new UserService();
      this.userSessionService = new UserSessionService();
      logger.info('[AUTH] Google OAuth authentication enabled');
    } else {
      logger.info('[AUTH] Google OAuth authentication disabled - API key only mode');
    }
  }

  /**
   * Middleware to authenticate requests using Google JWT tokens
   */
  authenticate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authHeader = req.headers.authorization;
    const sessionIdHeader = req.headers['x-session-id'] as string;
    const sessionIdCookie = req.cookies?.user_session_id;
    const requestSessionId = sessionIdHeader || sessionIdCookie;

    logger.info(`[AUTH] Auth middleware called for ${req.method} ${req.path}`, {
      method: req.method,
      path: req.path,
      authHeaderPresent: !!authHeader,
      sessionIdHeader,
      sessionIdCookie,
      sessionId: requestSessionId,
      cookieTokenPresent: !!req.cookies?.google_access_token,
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
            };

            logger.info(`[AUTH] API key authenticated user: ${apiKeyUser.username} (${apiKeyUser.id})`, {
              userId: apiKeyUser.id,
              username: apiKeyUser.username,
              email: apiKeyUser.email,
              role: apiKeyUser.role,
              sessionId: requestSessionId,
            });
            next();
            return;
          }
        }
      }

      // If Google OAuth is not enabled and API key failed, return 401
      if (!this.googleAuthEnabled) {
        logger.warn('[AUTH] Authentication failed: API key invalid and Google OAuth not configured', {
          sessionId: requestSessionId,
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
          logger.warn('[AUTH] Dev mode headers incomplete', {
            sessionId: requestSessionId,
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

        const { user } = await this.userService!.findOrCreateUser(devUserData);

        // Attach user to request object
        req.user = {
          id: user.id,
          googleId: user.providerUserId,
          email: user.email,
          name: user.name,
          isApiKeyUser: false,
          scopes: [],
          role: 'user',
        };

        logger.info(`[AUTH] Dev mode authenticated user: ${user.email} (${user.id})`, {
          sessionId: requestSessionId,
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

      // Normal Google JWT authentication
      // Extract token from Authorization header OR HTTP-only cookie
      // Also get session ID from header or cookie
      const sessionId = requestSessionId;
      if (sessionId) {
        req.authenticatedSessionId = sessionId;
      }

      logger.info(
        `[AUTH] Auth header: ${authHeader ? 'Present' : 'Missing'}, Session ID: ${sessionId ? 'Present' : 'Missing'}`,
        {
          sessionId,
          sessionIdHeader,
          sessionIdCookie,
          authHeaderPresent: !!authHeader,
          cookieTokenPresent: !!req.cookies?.google_access_token,
        }
      );

      // Try to get token from Authorization header first, then from cookie
      let token: string | undefined;
      let tokenSource: 'authorization_header' | 'cookie' | 'session_refresh' | 'none' = 'none';
      let tokenPreview: string | undefined;

      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
        tokenSource = 'authorization_header';
        tokenPreview = token ? `${token.slice(0, 8)}...${token.slice(-6)}` : undefined;
        logger.info('[AUTH] Token extracted from Authorization header', {
          sessionId,
          tokenSource,
          tokenPresent: !!token,
          tokenPreview,
        });
      } else if (req.cookies?.google_access_token) {
        token = req.cookies.google_access_token;
        tokenSource = 'cookie';
        tokenPreview = token ? `${token.slice(0, 8)}...${token.slice(-6)}` : undefined;
        logger.info('[AUTH] Token extracted from HTTP-only cookie', {
          sessionId,
          tokenSource,
          tokenPresent: !!token,
          tokenPreview,
        });
      }

      // If no token but session ID exists, try to refresh instead of rejecting
      if (!token && sessionId) {
        logger.info('[AUTH] No token found but session ID exists, attempting refresh', {
          sessionId,
          tokenSource,
          tokenPresent: !!token,
        });
        try {
          logger.info('[AUTH] Calling refreshTokenBySession from authenticate: missing token with session fallback', {
            sessionId,
            method: req.method,
            path: req.path,
          });
          const refreshResult = await this.refreshTokenBySession(sessionId);

          if (refreshResult.success && refreshResult.customToken) {
            token = refreshResult.customToken;
            tokenSource = 'session_refresh';
            tokenPreview = token ? `${token.slice(0, 8)}...${token.slice(-6)}` : undefined;

            // Set new token in HTTP-only cookie
            const isProduction = process.env.NODE_ENV === 'production';
            res.cookie('google_access_token', refreshResult.customToken, {
              httpOnly: true,
              secure: isProduction,
              sameSite: 'strict',
              path: '/',
              maxAge: config.jwt.expirationSeconds * 1000,
            });

            // Update req.cookies for downstream handlers
            if (!req.cookies) {
              req.cookies = {};
            }
            req.cookies.google_access_token = refreshResult.customToken;

            logger.info('[AUTH] Token successfully created via session refresh', {
              sessionId,
              tokenSource,
              tokenPresent: !!token,
              tokenPreview,
            });
          } else {
            throw new Error('Session refresh failed');
          }
        } catch (refreshError) {
          logger.error('[AUTH] Failed to refresh via session:', {
            sessionId,
            tokenSource,
            error: refreshError instanceof Error ? refreshError.message : 'Unknown error',
            stack: refreshError instanceof Error ? refreshError.stack : undefined,
          });
          res.status(401).json({
            error: 'Invalid or expired session',
            message: 'Please re-authenticate',
          });
          return;
        }
      }

      // If still no token, reject
      if (!token) {
        logger.warn('[AUTH] Authentication failed: No token and no valid session', {
          sessionId,
          tokenSource,
          authHeaderPresent: !!authHeader,
          cookieTokenPresent: !!req.cookies?.google_access_token,
        });
        res.status(401).json({
          error: 'Authentication required',
          message: 'Please provide a valid Google authentication token',
        });
        return;
      }

      // Verify custom JWT token
      let payload: any;
      let isTokenExpired = false;
      try {
        payload = jwtService.verifyToken(token);

        // Check if token is about to expire (within 5 minutes for 15-min tokens)
        const now = Math.floor(Date.now() / 1000);
        const timeUntilExpiry = payload.exp - now;

        if (timeUntilExpiry < 5 * 60) {
          // Less than 5 minutes
          logger.info(`[AUTH] Token is about to expire in ${timeUntilExpiry}s, considering refresh`, {
            sessionId,
            tokenSource,
            tokenPreview,
            tokenSub: payload?.sub,
            tokenExp: payload?.exp,
          });
          isTokenExpired = true;
        }
      } catch (verifyError) {
        logger.info(
          '[AUTH] JWT token verification failed:',
          {
            sessionId,
            tokenSource,
            tokenPreview,
            error: verifyError instanceof Error ? verifyError.message : 'Unknown error',
          }
        );
        isTokenExpired = true;
      }

      // If token is expired or about to expire, try to refresh using session
      if (isTokenExpired && sessionId) {
        logger.info('[AUTH] Attempting to refresh token using session ID', {
          sessionId,
          tokenSource,
          tokenPreview,
          tokenSub: payload?.sub,
        });

        try {
          logger.info('[AUTH] Calling refreshTokenBySession from authenticate: expired token refresh path', {
            sessionId,
            method: req.method,
            path: req.path,
          });
          const refreshResult = await this.refreshTokenBySession(sessionId);

          if (refreshResult.success && refreshResult.customToken) {
            // Verify the new custom JWT token
            payload = jwtService.verifyToken(refreshResult.customToken);

            // Set new token in HTTP-only cookie
            const isProduction = process.env.NODE_ENV === 'production';
            res.cookie('google_access_token', refreshResult.customToken, {
              httpOnly: true,
              secure: isProduction,
              sameSite: 'strict',
              path: '/',
              maxAge: config.jwt.expirationSeconds * 1000,
            });

            // IMPORTANT: Update req.cookies so downstream handlers get the new token
            if (!req.cookies) {
              req.cookies = {};
            }
            req.cookies.google_access_token = refreshResult.customToken;

            logger.info('[AUTH] Token successfully refreshed via session and cookie updated', {
              sessionId,
              tokenSource: 'session_refresh',
              tokenPresent: true,
              tokenPreview: refreshResult.customToken
                ? `${refreshResult.customToken.slice(0, 8)}...${refreshResult.customToken.slice(-6)}`
                : undefined,
              tokenSub: payload?.sub,
            });
          } else {
            throw new Error('Token refresh failed');
          }
        } catch (refreshError) {
          logger.error('[AUTH] Failed to refresh token:', {
            sessionId,
            tokenSource,
            tokenPreview,
            error: refreshError instanceof Error ? refreshError.message : 'Unknown error',
            stack: refreshError instanceof Error ? refreshError.stack : undefined,
          });
          res.status(401).json({
            error: 'Invalid or expired session',
            message: 'Please re-authenticate',
          });
          return;
        }
      } else if (isTokenExpired) {
        // No session ID provided and token is expired
        res.status(401).json({
          error: 'Invalid or expired session',
          message: 'Token expired and no session provided for refresh',
        });
        return;
      }

      if (!payload) {
        logger.warn('[AUTH] JWT payload missing after verification', {
          sessionId,
          tokenSource,
          tokenPreview,
        });
        res.status(401).json({
          error: 'Invalid token',
          message: 'JWT token payload is invalid',
        });
        return;
      }

      // Extract user information from custom JWT token
      // Since we're using our own JWT, we can directly get user from database using the sub (user ID)
      logger.info('[AUTH] Looking up user from verified token payload', {
        sessionId,
        tokenSource,
        tokenPreview,
        tokenSub: payload.sub,
        tokenEmail: payload.email,
      });
      const user = await this.userService!.getUserById(payload.sub);

      if (!user) {
        logger.warn('[AUTH] User not found for verified token payload', {
          sessionId,
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

      // Attach user to request object
      req.user = {
        id: user.id,
        googleId: user.providerUserId,
        email: user.email,
        name: user.name,
        isApiKeyUser: false,
        scopes: [], // JWT users get scopes from database/session
        role: 'user', // Default role, can be enhanced with role management
      };

      logger.info(`[AUTH] Authenticated user: ${user.email} (${user.id})`, {
        sessionId,
        tokenSource,
        tokenPreview,
        tokenSub: payload.sub,
        userId: user.id,
        googleId: user.providerUserId,
        email: user.email,
      });
      next();
    } catch (error) {
      logger.error('[AUTH] Authentication error:', {
        sessionId: requestSessionId,
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
   * Helper method to refresh token using session ID
   */
  private async refreshTokenBySession(
    sessionId: string
  ): Promise<{ success: boolean; customToken?: string; error?: string }> {
    try {
      if (!this.userSessionService) {
        return { success: false, error: 'Session service not configured' };
      }

      // Find session by ID
      logger.info('[AUTH] refreshTokenBySession fetching session', { sessionId });
      const session = await this.userSessionService.getSessionById(sessionId);

      if (!session || !session.user) {
        logger.warn('[AUTH] refreshTokenBySession failed: session or session user not found', {
          sessionId,
          sessionFound: !!session,
          userFound: !!session?.user,
        });
        return { success: false, error: 'Invalid session' };
      }

      // Check if session is still active and not expired
      const now = new Date();
      const isSessionExpired = now > session.refreshTokenExpiry;
      logger.info('[AUTH] refreshTokenBySession validating session state', {
        sessionId,
        userId: session.user.id,
        sessionStatus: session.status,
        refreshTokenExpiry: session.refreshTokenExpiry.toISOString(),
        isSessionExpired,
      });

      if (session.status !== 'ACTIVE' || isSessionExpired) {
        logger.warn('[AUTH] refreshTokenBySession failed: session inactive or expired', {
          sessionId,
          userId: session.user.id,
          sessionStatus: session.status,
          refreshTokenExpiry: session.refreshTokenExpiry.toISOString(),
          now: now.toISOString(),
        });
        return { success: false, error: 'Session expired' };
      }

      // Generate a new custom JWT token for the user
      logger.info('[AUTH] refreshTokenBySession generating custom token', {
        sessionId,
        userId: session.user.id,
        email: session.user.email,
      });
      const customToken = jwtService.generateToken({
        sub: session.user.id,
        email: session.user.email,
        name: session.user.name,
        picture: session.user.picture,
      });

      // Update session activity
      logger.info('[AUTH] refreshTokenBySession updating session activity', {
        sessionId,
        userId: session.user.id,
      });
      await this.userSessionService.updateSession(session.id, {
        lastActivity: new Date(),
      });

      logger.info('[AUTH] refreshTokenBySession completed successfully', {
        sessionId,
        userId: session.user.id,
        email: session.user.email,
      });
      return { success: true, customToken };
    } catch (error) {
      logger.error('[AUTH] refreshTokenBySession failed with exception', {
        sessionId,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

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
   * Middleware for Zero endpoints - NO auto-refresh
   * Returns 401 if token is missing or expired, forcing frontend to refresh explicitly
   */
  authenticateZero = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    logger.info(`[AUTH] Zero auth middleware called for ${req.method} ${req.path}`);

    try {
      // Get JWT token from HTTP-only cookie
      let token = req.cookies?.google_access_token;

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
        logger.warn('[AUTH] Zero auth failed: No token provided');
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
        isApiKeyUser: false,
        scopes: [],
        role: 'user',
      };

      const existingContext = loggerContext.getStore();
      const context: LogContext = {
        ...existingContext,
        email: user.email,
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
