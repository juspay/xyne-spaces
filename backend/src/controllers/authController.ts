import { Request, Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { logger } from '../utils/logger';
import { UserService } from '../services/userService';
import { UserSessionService } from '../services/userSessionService';
import { jwtService } from '../services/jwtService';
import '../middleware/auth'; // Import to get extended Express types
import { config } from '@/config/env';

export class AuthController {
  private googleClient: OAuth2Client;
  private userService: UserService;
  private userSessionService: UserSessionService;
  private usedOAuthCodes: Set<string> = new Set(); // Track used OAuth codes
  private codeCleanupInterval: NodeJS.Timeout;

  constructor() {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    
    if (!clientId || !clientSecret) {
      throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables are required');
    }
    
    this.googleClient = new OAuth2Client(clientId, clientSecret);
    this.userService = new UserService();
    this.userSessionService = new UserSessionService();
    
    // Clean up used OAuth codes every 10 minutes (codes expire in ~10 minutes anyway)
    this.codeCleanupInterval = setInterval(() => {
      const before = this.usedOAuthCodes.size;
      this.usedOAuthCodes.clear();
      logger.info(`🧹 Cleaned up ${before} used OAuth codes from memory`);
    }, 10 * 60 * 1000);
  }

  /**
   * Get the frontend URL for redirects, handling production and development environments
   */
  private getFrontendUrl(): string {
    logger.info('🔍 [OAUTH DEBUG] getFrontendUrl() called');
    logger.info('🔍 [OAUTH DEBUG] Environment variables:');
    logger.info('  - NODE_ENV:', process.env.NODE_ENV);
    logger.info('  - FRONTEND_URL:', process.env.FRONTEND_URL);
    logger.info('  - CORS_ORIGIN:', process.env.CORS_ORIGIN);
    
    // First priority: explicit FRONTEND_URL environment variable
    if (process.env.FRONTEND_URL && process.env.FRONTEND_URL.trim()) {
      const frontendUrl = process.env.FRONTEND_URL.trim();
      logger.info('✅ [OAUTH DEBUG] Using FRONTEND_URL:', frontendUrl);
      return frontendUrl;
    }
    
    // Second priority: if CORS_ORIGIN contains an HTTPS URL, use that
    if (process.env.CORS_ORIGIN) {
      const corsOrigins = process.env.CORS_ORIGIN.split(',').map(url => url.trim());
      logger.info('🔍 [OAUTH DEBUG] CORS_ORIGIN parsed:', corsOrigins);
      
      // Find the first HTTPS URL (external/production URL)
      const httpsUrl = corsOrigins.find(url => url.startsWith('https://'));
      if (httpsUrl) {
        logger.info('✅ [OAUTH DEBUG] Using HTTPS URL from CORS_ORIGIN:', httpsUrl);
        return httpsUrl;
      }
      
      // If no HTTPS URL found, use the first one
      logger.info('⚠️ [OAUTH DEBUG] No HTTPS URL in CORS_ORIGIN, using first:', corsOrigins[0]);
      return corsOrigins[0];
    }
    
    // Development fallback
    logger.info('🔄 [OAUTH DEBUG] Using development fallback: http://localhost:5173');
    return 'http://localhost:5173';
  }

  /**
   * Get the backend URL for OAuth redirects, handling production and development environments
   */
  private getBackendUrl(req: Request): string {
    logger.info('🔍 [OAUTH DEBUG] getBackendUrl() called');
    logger.info('🔍 [OAUTH DEBUG] Request details:');
    logger.info('  - req.protocol:', req.protocol);
    logger.info('  - req.get("host"):', req.get('host'));
    logger.info('  - req.headers.host:', req.headers.host);
    logger.info('  - req.headers["x-forwarded-host"]:', req.headers['x-forwarded-host']);
    logger.info('  - req.headers["x-forwarded-proto"]:', req.headers['x-forwarded-proto']);
    
    // First priority: if FRONTEND_URL is set, use same domain
    if (process.env.FRONTEND_URL && process.env.FRONTEND_URL.trim()) {
      try {
        const frontendUrl = new URL(process.env.FRONTEND_URL.trim());
        const backendUrl = `${frontendUrl.protocol}//${frontendUrl.host}`;
        logger.info('✅ [OAUTH DEBUG] Using backend URL from FRONTEND_URL:', backendUrl);
        return backendUrl;
      } catch (error) {
        logger.info('❌ [OAUTH DEBUG] Failed to parse FRONTEND_URL:', error);
        // If URL parsing fails, fall back to request-based URL
      }
    }
    
    // Second priority: if CORS_ORIGIN contains HTTPS URL, use that domain
    if (process.env.CORS_ORIGIN) {
      const corsOrigins = process.env.CORS_ORIGIN.split(',').map(url => url.trim());
      const httpsUrl = corsOrigins.find(url => url.startsWith('https://'));
      if (httpsUrl) {
        try {
          const url = new URL(httpsUrl);
          const backendUrl = `${url.protocol}//${url.host}`;
          logger.info('✅ [OAUTH DEBUG] Using backend URL from CORS_ORIGIN HTTPS:', backendUrl);
          return backendUrl;
        } catch (error) {
          logger.info('❌ [OAUTH DEBUG] Failed to parse CORS_ORIGIN HTTPS URL:', error);
          // If URL parsing fails, continue to fallback
        }
      }
    }
    
    // Fallback to request URL (development)
    const fallbackUrl = `${req.protocol}://${req.get('host')}`;
    logger.info('🔄 [OAUTH DEBUG] Using request-based fallback URL:', fallbackUrl);
    return fallbackUrl;
  }

  /**
   * Exchange authorization code for tokens (including refresh token)
   */
  exchangeCodeForTokens = async (req: Request, res: Response): Promise<void> => {
    // Generate unique request ID for tracking race conditions
    const requestId = `REQ_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const timestamp = new Date().toISOString();
    
    logger.info('🚀 [OAUTH DEBUG] exchangeCodeForTokens() called');
    logger.info(`🔍 [${requestId}] === OAuth Exchange Started ===`);
    logger.info(`🔍 [${requestId}] Timestamp: ${timestamp}`);
    logger.info(`🔍 [${requestId}] Request method: ${req.method}`);
    logger.info(`🔍 [${requestId}] Request URL: ${req.url}`);
    logger.info(`🔍 [${requestId}] Request body:`, req.body);
    logger.info(`🔍 [${requestId}] Request query:`, req.query);
    logger.info(`🔍 [${requestId}] User-Agent: ${req.headers['user-agent']?.substring(0, 100)}...`);
    logger.info(`🔍 [${requestId}] IP Address: ${req.ip}`);
    
    try {
      // Support both POST body and GET query parameters
      const code = req.body.code || req.query.code;
      const redirectUri = req.body.redirectUri || req.query.redirect_uri;
      const isOAuthCallback = req.method === 'GET' && req.query.code; // Detect OAuth redirect
      logger.info(`🔍 [${requestId}] Extracted parameters:`);
      logger.info(`🔍 [${requestId}]   - code: ${code ? `${code.substring(0, 20)}...` : 'NOT PROVIDED'}`);
      logger.info(`🔍 [${requestId}]   - redirectUri: ${redirectUri}`);
      logger.info(`🔍 [${requestId}]   - isOAuthCallback: ${isOAuthCallback}`);

      if (!code) {
        logger.info(`❌ [${requestId}] No authorization code provided`);
        if (isOAuthCallback) {
          // Redirect to frontend with error
          const frontendUrl = this.getFrontendUrl();
          logger.info(`🔄 [${requestId}] Redirecting to frontend with error: ${frontendUrl}?error=missing_code`);
          res.redirect(`${frontendUrl}?error=missing_code`);
          return;
        }
        res.status(400).json({
          error: 'Authorization code is required'
        });
        return;
      }
      // Calculate the redirect URI for Google
      const calculatedRedirectUri = redirectUri || `${this.getBackendUrl(req)}/api/auth/exchange`;
      logger.info(`🔍 [${requestId}] Using redirect URI for Google: ${calculatedRedirectUri}`);

      // RACE CONDITION FIX: Check if OAuth code has already been used
      if (this.usedOAuthCodes.has(code)) {
        logger.info(`❌ [${requestId}] OAuth code already used - preventing duplicate request`);
        if (isOAuthCallback) {
          const frontendUrl = this.getFrontendUrl();
          logger.info(`🔄 [${requestId}] Redirecting to frontend with error: code_already_used`);
          res.redirect(`${frontendUrl}?error=code_already_used&message=${encodeURIComponent('OAuth code was already processed')}`);
          return;
        }
        res.status(409).json({
          error: 'OAuth code already used',
          message: 'This authorization code has already been processed'
        });
        return;
      }

      // Mark code as used immediately to prevent other concurrent requests
      this.usedOAuthCodes.add(code);
      logger.info(`🔐 [${requestId}] Marked OAuth code as used (${this.usedOAuthCodes.size} codes in memory)`);

      // Exchange authorization code for tokens
      logger.info(`🔍 [${requestId}] 🚀 Calling Google getToken() API...`);
      const tokenStartTime = Date.now();
      const { tokens } = await this.googleClient.getToken({
        code,
        redirect_uri: calculatedRedirectUri
      });
      const tokenEndTime = Date.now();
      logger.info(`✅ [${requestId}] Google getToken() completed in ${tokenEndTime - tokenStartTime}ms`);
      logger.info(`✅ [${requestId}] Received tokens: id_token=${!!tokens.id_token}, refresh_token=${!!tokens.refresh_token}, access_token=${!!tokens.access_token}`);

      const { id_token, refresh_token, access_token } = tokens;

      if (!id_token) {
        logger.info(`❌ [${requestId}] No ID token received from Google`);
        if (isOAuthCallback) {
          // Redirect to frontend with error
          const frontendUrl = this.getFrontendUrl();
          logger.info(`🔄 [${requestId}] Redirecting to frontend with error: no_id_token`);
          res.redirect(`${frontendUrl}?error=no_id_token`);
          return;
        }
        res.status(400).json({
          error: 'No ID token received from Google'
        });
        return;
      }

      // Verify and decode the ID token
      logger.info(`🔍 [${requestId}] 🔐 Verifying ID token...`);
      const verifyStartTime = Date.now();
      const ticket = await this.googleClient.verifyIdToken({
        idToken: id_token,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      const verifyEndTime = Date.now();
      logger.info(`✅ [${requestId}] ID token verified in ${verifyEndTime - verifyStartTime}ms`);

      const payload = ticket.getPayload();
      if (!payload) {
        logger.info(`❌ [${requestId}] Invalid Google token payload`);
        if (isOAuthCallback) {
          // Redirect to frontend with error
          const frontendUrl = process.env.CORS_ORIGIN || 'http://localhost:5173';
          res.redirect(`${frontendUrl}?error=invalid_token`);
          return;
        }
        res.status(400).json({
          error: 'Invalid Google token payload'
        });
        return;
      }

      // Extract user information from Google token
      const googleUserData = {
        googleId: payload.sub,
        email: payload.email!,
        name: payload.name!,
        picture: payload.picture, // Google profile picture URL
      };
      logger.info(`🔍 [${requestId}] User data: ${googleUserData.email} (${googleUserData.googleId})`);

      // Find or create user in database
      logger.info(`🔍 [${requestId}] 👤 Finding/creating user in database...`);
      const userStartTime = Date.now();
      const { user } = await this.userService.findOrCreateUser(googleUserData);
      const userEndTime = Date.now();
      logger.info(`✅ [${requestId}] User resolved in ${userEndTime - userStartTime}ms: ${user.email} (DB ID: ${user.id})`);

      const customToken = jwtService.generateToken({
        sub: user.id,
        email: user.email,
        name: user.name,
        picture: googleUserData.picture,
      });

      let sessionId = null;

      // Create user session if refresh token is provided
      if (refresh_token) {
        try {
          logger.info(`🔍 [${requestId}] 💾 Creating user session with refresh token...`);
          const sessionStartTime = Date.now();
          
          // Google refresh tokens don't expire, but we'll set a far future date
          const refreshTokenExpiry = new Date();
          refreshTokenExpiry.setDate(refreshTokenExpiry.getDate() + config.session.expiryDays);
          
          const accessTokenExpiry = payload.exp ? new Date(payload.exp * 1000) : undefined;

          // Extract device info from request headers
          const deviceInfo = JSON.stringify({
            userAgent: req.headers['user-agent'],
            acceptLanguage: req.headers['accept-language'],
            timestamp: new Date().toISOString(),
          });

          const session = await this.userSessionService.createSession({
            userId: user.id,
            refreshToken: refresh_token,
            refreshTokenExpiry,
            accessToken: access_token ?? undefined,
            accessTokenExpiry,
            deviceInfo,
            ipAddress: req.ip || req.connection.remoteAddress || undefined,
          });

          sessionId = session.id;
          const sessionEndTime = Date.now();
          logger.info(`✅ [${requestId}] Session created in ${sessionEndTime - sessionStartTime}ms: ${sessionId}`);
        } catch (sessionError) {
          logger.info(`❌ [${requestId}] Error creating user session:`, sessionError);
          logger.error('Error creating user session:', sessionError);
          // Continue without session creation - not critical for login
        }
      } else {
        logger.info(`⚠️ [${requestId}] No refresh token provided - session creation skipped`);
      }

      // Set HTTP-only cookies for tokens
      const isProduction = process.env.NODE_ENV === 'production';
      const cookieOptions = {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'strict' as const,
        path: '/',
      };

      // Set auth token cookie (expires in 24 hours)
      res.cookie('google_access_token', customToken, {
        ...cookieOptions,
        maxAge: config.jwt.expirationSeconds * 1000,
      });

      // Set session ID cookie
      if (sessionId) {
        res.cookie('user_session_id', sessionId, {
          ...cookieOptions,
          maxAge: config.session.expiryDays * 24 * 60 * 60 * 1000,
        });
      }

      // Handle OAuth callback redirect vs API response
      if (isOAuthCallback) {
        // For OAuth redirects, redirect back to frontend with success data (no tokens in URL)
        const params = new URLSearchParams({
          success: 'true',
          userId: user.id,
          userName: user.name,
          userEmail: user.email,
          hasRefreshToken: refresh_token ? 'true' : 'false'
        });

        const frontendUrl = process.env.CORS_ORIGIN || 'http://localhost:5173';
        logger.info(`🔄 [${requestId}] Redirecting to frontend: ${frontendUrl}?${params.toString()}`);
        logger.info(`✅ [${requestId}] === OAuth Exchange Complete (REDIRECT) ===`);
        res.redirect(`${frontendUrl}?${params.toString()}`);
        return;
      }

      // For API calls, return JSON response (no tokens in response body)
      logger.info(`✅ [${requestId}] === OAuth Exchange Complete (JSON) ===`);
      res.status(200).json({
        success: true,
        sessionId,
        user: {
          id: user.id,
          googleId: user.providerUserId,
          email: user.email,
          name: user.name,
        },
        hasRefreshToken: !!refresh_token
      });

    } catch (error) {
      logger.info(`❌ [${requestId}] === OAuth Exchange FAILED ===`);
      logger.info(`❌ [${requestId}] Error details:`, error);
      logger.info(`❌ [${requestId}] Error message: ${error instanceof Error ? error.message : 'Unknown error'}`);
      logger.info(`❌ [${requestId}] Error stack:`, error instanceof Error ? error.stack : 'No stack trace');
      
      // Remove code from used set on failure (in case it was a temporary error)
      const code = req.body.code || req.query.code;
      if (code && this.usedOAuthCodes.has(code)) {
        this.usedOAuthCodes.delete(code);
        logger.info(`🔓 [${requestId}] Removed failed OAuth code from used set`);
      }
      
      logger.error('Error exchanging code for tokens:', error);
      const isOAuthCallback = req.method === 'GET' && req.query.code;
      if (isOAuthCallback) {
        // Redirect to frontend with error
        const frontendUrl = process.env.CORS_ORIGIN || 'http://localhost:5173';
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.info(`🔄 [${requestId}] Redirecting to frontend with error: ${errorMessage}`);
        res.redirect(`${frontendUrl}?error=auth_failed&message=${encodeURIComponent(errorMessage)}`);
        return;
      }
      res.status(500).json({
        error: 'Failed to exchange authorization code',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };

  /**
   * Refresh token using session ID (more secure approach)
   * NOTE: This endpoint is not used - refresh is handled automatically by auth middleware
   * Keeping it for backwards compatibility / manual refresh if needed
   */
  refreshTokenBySession = async (req: Request, res: Response): Promise<void> => {
    try {
      // Read session ID from HTTP-only cookie (set by cookie-parser middleware)
      const sessionId = req.cookies?.user_session_id;

      if (!sessionId) {
        res.status(400).json({
          error: 'Session ID is required (missing from cookie)'
        });
        return;
      }

      // Find session by ID
      const session = await this.userSessionService.getSessionById(sessionId);
      
      if (!session || !session.user) {
        res.status(401).json({
          error: 'Invalid or expired session'
        });
        return;
      }

      // Check if session is still active and not expired
      if (session.status !== 'ACTIVE' || new Date() > session.refreshTokenExpiry) {
        res.status(401).json({
          error: 'Session has expired',
          message: 'Please re-authenticate'
        });
        return;
      }

      // Use the stored refresh token to get a new access token
      this.googleClient.setCredentials({
        refresh_token: session.refreshToken
      });

      const { credentials } = await this.googleClient.refreshAccessToken();
      const newIdToken = credentials.id_token;
      const newAccessToken = credentials.access_token;

      if (!newIdToken) {
        res.status(500).json({
          error: 'Failed to refresh token - no ID token received'
        });
        return;
      }

      // Verify the new token
      const ticket = await this.googleClient.verifyIdToken({
        idToken: newIdToken,
        audience: process.env.GOOGLE_CLIENT_ID,
      });

      const payload = ticket.getPayload();
      if (!payload) {
        res.status(500).json({
          error: 'Invalid refreshed token payload'
        });
        return;
      }

      // Update session with new access token and activity
      const accessTokenExpiry = payload.exp ? new Date(payload.exp * 1000) : undefined;
      await this.userSessionService.updateSession(session.id, {
        accessToken: newAccessToken ?? undefined,
        accessTokenExpiry,
        lastActivity: new Date(),
      });

      // Generate custom JWT token (consistent with initial auth)
      const customToken = jwtService.generateToken({
        sub: session.user.id,
        email: session.user.email,
        name: session.user.name,
        picture: payload.picture,
      });

      // Set HTTP-only cookie for refreshed token
      const isProduction = process.env.NODE_ENV === 'production';
      res.cookie('google_access_token', customToken, {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'strict',
        path: '/',
        maxAge: config.jwt.expirationSeconds * 1000,
      });

      res.status(200).json({
        success: true,
        user: {
          id: session.user.id,
          googleId: session.user.providerUserId,
          email: session.user.email,
          name: session.user.name,
        },
        expiresAt: payload.exp
      });

    } catch (error) {
      logger.error('Error refreshing token by session:', error);
      
      // Handle specific Google API errors
      if (error instanceof Error) {
        if (error.message.includes('invalid_grant')) {
          res.status(401).json({
            error: 'Refresh token is invalid or expired',
            message: 'Please re-authenticate'
          });
          return;
        }
      }

      res.status(500).json({
        error: 'Failed to refresh token',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };

  /**
   * Initiate OAuth login flow (backend-only, no frontend Google credentials needed)
   */
  initiateLogin = async (req: Request, res: Response): Promise<void> => {
    try {
      logger.info('🚀 [AUTH] Initiating backend-only OAuth login...');
      
      // Calculate the redirect URI for OAuth callback (use existing /exchange endpoint)
      const redirectUri = `${this.getBackendUrl(req)}/api/auth/exchange`;
      logger.info(`🔗 [AUTH] OAuth redirect URI: ${redirectUri}`);

      // Generate OAuth URL with offline access for refresh tokens
      const authUrl = this.googleClient.generateAuthUrl({
        access_type: 'offline',
        scope: ['openid', 'email', 'profile'],
        prompt: 'consent', // Force consent to ensure refresh token
        redirect_uri: redirectUri,
        state: `login_${Date.now()}`, // Add state for security
      });

      logger.info(`🌐 [AUTH] Redirecting to Google OAuth: ${authUrl}`);
      
      // Redirect user to Google OAuth
      res.redirect(authUrl);
      
    } catch (error) {
      logger.error('❌ [AUTH] Error initiating OAuth login:', error);
      logger.error('Error initiating OAuth login:', error);
      
      // Redirect to frontend with error
      const frontendUrl = this.getFrontendUrl();
      res.redirect(`${frontendUrl}?error=oauth_init_failed&message=${encodeURIComponent('Failed to initiate login')}`);
    }
  };

  /**
   * Handle OAuth callback from Google (backend-only flow)
   */
  handleCallback = async (req: Request, res: Response): Promise<void> => {
    const requestId = `CB_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    logger.info(`🔄 [${requestId}] === OAuth Callback Started ===`);
    
    try {
      const { code, error, state } = req.query;
      
      logger.info(`🔍 [${requestId}] Callback params:`, {
        hasCode: !!code,
        error: error,
        state: state
      });
      
      if (error) {
        logger.info(`❌ [${requestId}] OAuth error from Google:`, error);
        const frontendUrl = this.getFrontendUrl();
        res.redirect(`${frontendUrl}?error=oauth_error&message=${encodeURIComponent(error as string)}`);
        return;
      }
      
      if (!code) {
        logger.info(`❌ [${requestId}] No authorization code received`);
        const frontendUrl = this.getFrontendUrl();
        res.redirect(`${frontendUrl}?error=missing_code&message=${encodeURIComponent('No authorization code received')}`);
        return;
      }
      
      // Check for code reuse
      if (this.usedOAuthCodes.has(code as string)) {
        logger.info(`❌ [${requestId}] OAuth code already used`);
        const frontendUrl = this.getFrontendUrl();
        res.redirect(`${frontendUrl}?error=code_reused&message=${encodeURIComponent('Authorization code already used')}`);
        return;
      }
      
      // Mark code as used
      this.usedOAuthCodes.add(code as string);
      logger.info(`🔐 [${requestId}] Marked OAuth code as used`);
      
      // Calculate redirect URI (must match the one used in initiateLogin)
      const redirectUri = `${this.getBackendUrl(req)}/api/auth/exchange`;
      logger.info(`🔗 [${requestId}] Using redirect URI: ${redirectUri}`);
      
      // Exchange code for tokens
      logger.info(`🔄 [${requestId}] Exchanging code for tokens...`);
      const { tokens } = await this.googleClient.getToken({
        code: code as string,
        redirect_uri: redirectUri
      });
      
      const { id_token, refresh_token, access_token } = tokens;
      logger.info(`✅ [${requestId}] Received tokens: id_token=${!!id_token}, refresh_token=${!!refresh_token}`);
      
      if (!id_token) {
        logger.info(`❌ [${requestId}] No ID token received`);
        const frontendUrl = this.getFrontendUrl();
        res.redirect(`${frontendUrl}?error=no_id_token&message=${encodeURIComponent('No ID token received from Google')}`);
        return;
      }
      
      // Verify and decode the ID token
      logger.info(`🔐 [${requestId}] Verifying ID token...`);
      const ticket = await this.googleClient.verifyIdToken({
        idToken: id_token,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      
      const payload = ticket.getPayload();
      if (!payload) {
        logger.info(`❌ [${requestId}] Invalid token payload`);
        const frontendUrl = this.getFrontendUrl();
        res.redirect(`${frontendUrl}?error=invalid_token&message=${encodeURIComponent('Invalid token payload')}`);
        return;
      }
      
      // Extract user information
      const googleUserData = {
        googleId: payload.sub,
        email: payload.email!,
        name: payload.name!,
        picture: payload.picture!
      };
      logger.info(`👤 [${requestId}] User: ${googleUserData.email}`);
      // Find or create user
      logger.info(`🔍 [${requestId}] Finding/creating user...`);
      const { user } = await this.userService.findOrCreateUser(googleUserData);
      logger.info(`✅ [${requestId}] User resolved: ${user.email} (ID: ${user.id})`);

      // Ensure user presence entry exists (create if not exists, update timestamps if exists)
      await this.userService.ensureUserPresence(user.id);
      logger.info(`✅ [${requestId}] User presence ensured for user ${user.id}`);

      // Generate custom JWT token
      const customToken = jwtService.generateToken({
        sub: user.id,
        email: user.email,
        name: user.name,
        picture: payload.picture,
      });

      let sessionId = null;
      
      // Create session if refresh token is available
      if (refresh_token) {
        try {
          logger.info(`💾 [${requestId}] Creating user session...`);
          
          const refreshTokenExpiry = new Date();
          refreshTokenExpiry.setDate(refreshTokenExpiry.getDate() + config.session.expiryDays);
          
          const accessTokenExpiry = payload.exp ? new Date(payload.exp * 1000) : undefined;
          
          const deviceInfo = JSON.stringify({
            userAgent: req.headers['user-agent'],
            acceptLanguage: req.headers['accept-language'],
            timestamp: new Date().toISOString(),
          });
          
          const session = await this.userSessionService.createSession({
            userId: user.id,
            refreshToken: refresh_token,
            refreshTokenExpiry,
            accessToken: access_token ?? undefined,
            accessTokenExpiry,
            deviceInfo,
            ipAddress: req.ip || req.connection.remoteAddress || undefined,
          });
          
          sessionId = session.id;
          logger.info(`✅ [${requestId}] Session created: ${sessionId}`);
        } catch (sessionError) {
          logger.info(`❌ [${requestId}] Session creation failed:`, sessionError);
          // Continue without session - not critical
        }
      }
      
      // Set HTTP-only cookies for tokens
      const isProduction = process.env.NODE_ENV === 'production';
      const cookieOptions = {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'strict' as const,
        path: '/',
      };

      // Set auth token cookie (expires in 24 hours)
      res.cookie('google_access_token', customToken, {
        ...cookieOptions,
        maxAge: config.jwt.expirationSeconds * 1000,
      });

      // Set session ID cookie
      if (sessionId) {
        res.cookie('user_session_id', sessionId, {
          ...cookieOptions,
          maxAge: config.session.expiryDays * 24 * 60 * 60 * 1000,
        });
      }

      // Redirect to frontend with success parameters (no tokens in URL)
      const frontendUrl = this.getFrontendUrl();
      const params = new URLSearchParams({
        success: 'true',
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        hasRefreshToken: refresh_token ? 'true' : 'false'
      });

      const redirectUrl = `${frontendUrl}?${params.toString()}`;
      logger.info(`🎯 [${requestId}] Redirecting to frontend: ${frontendUrl}?success=true&...`);
      logger.info(`✅ [${requestId}] === OAuth Callback Complete ===`);

      res.redirect(redirectUrl);
      
    } catch (error) {
      logger.info(`❌ [${requestId}] === OAuth Callback FAILED ===`);
      logger.info(`❌ [${requestId}] Error:`, error);
      
      // Remove code from used set on failure
      const code = req.query.code;
      if (code && this.usedOAuthCodes.has(code as string)) {
        this.usedOAuthCodes.delete(code as string);
        logger.info(`🔓 [${requestId}] Removed failed OAuth code from used set`);
      }
      
      logger.error('Error in OAuth callback:', error);
      
      const frontendUrl = this.getFrontendUrl();
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.redirect(`${frontendUrl}?error=callback_failed&message=${encodeURIComponent(errorMessage)}`);
    }
  };

  /**
   * Refresh session endpoint - generates new JWT from existing session
   * Called directly by frontend when JWT expires, bypassing Zero server
   */
  refreshSession = async (req: Request, res: Response): Promise<void> => {
    try {
      logger.info('[REFRESH] Refresh session endpoint called');

      // Read session ID from HTTP-only cookie
      const sessionId = req.cookies?.user_session_id;

      if (!sessionId) {
        logger.warn('[REFRESH] No session ID cookie found');
        res.status(401).json({
          error: 'No session found',
          message: 'Session ID cookie is missing',
        });
        return;
      }

      logger.info(`[REFRESH] Found session ID: ${sessionId}`);

      // Find session by ID
      const session = await this.userSessionService.getSessionById(sessionId);

      if (!session || !session.user) {
        logger.warn(`[REFRESH] Session not found in database: ${sessionId}`);
        res.status(401).json({
          error: 'Invalid session',
          message: 'Session not found or expired',
        });
        return;
      }

      logger.info(`[REFRESH] Session found for user: ${session.user.email}`);

      // Check if session is still active and not expired
      if (session.status !== 'ACTIVE' || new Date() > session.refreshTokenExpiry) {
        logger.warn(`[REFRESH] Session expired or inactive: ${sessionId} (status: ${session.status}, expiry: ${session.refreshTokenExpiry})`);
        res.status(401).json({
          error: 'Session expired',
          message: 'Please re-authenticate',
        });
        return;
      }

      // Generate a new custom JWT token for the user (no Google API call needed)
      logger.info(`[REFRESH] Generating new JWT token for user: ${session.user.email}`);
      const customToken = jwtService.generateToken({
        sub: session.user.id,
        email: session.user.email,
        name: session.user.name,
        picture: session.user.picture,
      });

      // Update session activity
      await this.userSessionService.updateSession(session.id, {
        lastActivity: new Date(),
      });

      // Set new token in HTTP-only cookie (browser receives this directly!)
      const isProduction = process.env.NODE_ENV === 'production';

      res.cookie('google_access_token', customToken, {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'strict',
        path: '/',
        maxAge: config.jwt.expirationSeconds * 1000,
      });

      logger.info(`[REFRESH] New JWT cookie set for user: ${session.user.email}`);
      logger.info(`[REFRESH] Sending Set-Cookie header to browser`);

      res.status(200).json({
        success: true,
        message: 'Session refreshed successfully'
      });

    } catch (error) {
      logger.error('Error refreshing session:', error);

      res.status(500).json({
        error: 'Failed to refresh session',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };

  /**
   * Logout endpoint - clears session and redirects to frontend
   */
  logout = async (req: Request, res: Response): Promise<void> => {
    try {
      logger.info('🚪 [AUTH] Processing logout...');

      // If user is authenticated, revoke their session
      if (req.user) {
        logger.info(`👤 [AUTH] Revoking sessions for user: ${req.user.email}`);
        await this.userSessionService.revokeAllUserSessions(req.user.id);
      }

      // Clear HTTP-only cookies
      res.clearCookie('google_access_token', { path: '/' });
      res.clearCookie('user_session_id', { path: '/' });

      // For API calls, return JSON
      if (req.headers.accept?.includes('application/json')) {
        res.status(200).json({
          success: true,
          message: 'Logged out successfully'
        });
        return;
      }

      // For browser requests, redirect to frontend
      const frontendUrl = this.getFrontendUrl();
      logger.info(`🔄 [AUTH] Redirecting to frontend: ${frontendUrl}`);
      res.redirect(frontendUrl);

    } catch (error) {
      logger.error('❌ [AUTH] Error during logout:', error);
      logger.error('Error during logout:', error);

      if (req.headers.accept?.includes('application/json')) {
        res.status(500).json({
          error: 'Logout failed',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      } else {
        const frontendUrl = this.getFrontendUrl();
        res.redirect(`${frontendUrl}?error=logout_failed`);
      }
    }
  };

  /**
   * Cleanup method to clear the OAuth code cleanup interval
   */
  cleanup(): void {
    if (this.codeCleanupInterval) {
      clearInterval(this.codeCleanupInterval);
      logger.info('🧹 OAuth code cleanup interval cleared');
    }
  }

}
