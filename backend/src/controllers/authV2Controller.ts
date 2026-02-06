import { Request, Response } from 'express';
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';
import { logger } from '../utils/logger';
import { UserService } from '../services/userService';
import { UserSessionService } from '../services/userSessionService';
import { jwtService } from '../services/jwtService';
import { oauthStateServiceV2 } from '../services/oauthStateServiceV2';
import { pkceServiceV2 } from '../services/pkceServiceV2';
import '../types/express';
import { config } from '@/config/env';

export class AuthV2Controller {
  private googleClient: OAuth2Client;
  private userService: UserService;
  private userSessionService: UserSessionService;

  constructor() {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables are required');
    }

    this.googleClient = new OAuth2Client(clientId, clientSecret);
    this.userService = new UserService();
    this.userSessionService = new UserSessionService();
  }

  private getFrontendUrl(req: Request | null = null,): string {

    logger.info(`[X-Original-Host]: value: ${req?.headers['x-original-host']}`);

    if (req) {
      const originalHost = req.headers['x-original-host'];
      if (originalHost && typeof originalHost === 'string') {
        const protocol = req.headers['x-forwarded-proto'] || req.protocol || "https";
        return `${protocol}://${originalHost}`;
      }
    }

    const url = process.env.FRONTEND_URL;
    if (!url) {
      throw new Error('FRONTEND_URL environment variable is required');
    }
    return url.trim();
  }

  private getBackendUrl(req: Request | null = null): string {

    logger.info(`[X-Original-Host]: value: ${req?.headers['x-original-host']}`);

    if (req) {
      const originalHost = req.headers['x-original-host'];
      if (originalHost && typeof originalHost === 'string') {
        const protocol = req.headers['x-forwarded-proto'] || req.protocol || "https";
        return `${protocol}://${originalHost}`;
      }
    }

    const url = process.env.BACKEND_URL;
    if (!url) {
      throw new Error('BACKEND_URL environment variable is required');
    }
    return url.trim();
  }

  private detectPlatform(req: Request): 'web' | 'electron' | 'mobile' {
    const userAgent = req.headers['user-agent'] || '';
    const platform = req.headers['x-platform'] as string;

    if (platform === 'electron' || userAgent.toLowerCase().includes('electron')) {
      return 'electron';
    }

    if (platform === 'mobile' || userAgent.toLowerCase().includes('mobile')) {
      return 'mobile';
    }

    return 'web';
  }

  initiateLogin = async (req: Request, res: Response): Promise<void> => {
    const requestId = `LOGIN_${Date.now()}`;

    try {
      logger.info(`[${requestId}] Initiating OAuth login`);

      const platformQuery = req.query.platform as 'electron' | 'web' | 'mobile';
      const platform = platformQuery || this.detectPlatform(req);
      logger.info(`[${requestId}] Detected platform: ${platform}`);

      const codeVerifier = pkceServiceV2.generateCodeVerifier();
      const codeChallenge = pkceServiceV2.generateCodeChallenge(codeVerifier);

      const state = await oauthStateServiceV2.generateState(platform, codeChallenge);

      await pkceServiceV2.storeVerifier(state, codeVerifier);

      const redirectUri = `${this.getBackendUrl(req)}/api/auth/exchange`;

      logger.info('[X-Original-Host] : Redirect URI:', redirectUri);

      const authUrl = this.googleClient.generateAuthUrl({
        access_type: 'offline',
        scope: ['openid', 'email', 'profile'],
        prompt: 'consent',
        redirect_uri: redirectUri,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: CodeChallengeMethod.S256,
      });

      logger.info(`[${requestId}] Redirecting to Google OAuth`);
      res.redirect(authUrl);
    } catch (error) {
      logger.error(`[${requestId}] Error initiating login:`, error);

      const frontendUrl = this.getFrontendUrl(req);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.redirect(
        `${frontendUrl}?error=oauth_init_failed&message=${encodeURIComponent(errorMessage)}`
      );
    }
  };

  handleCallback = async (req: Request, res: Response): Promise<void> => {
    const requestId = `CALLBACK_${Date.now()}`;

    try {
      const { code, state, error } = req.query;

      logger.info(`[${requestId}] OAuth callback received`);

      if (error) {
        logger.error(`[${requestId}] OAuth error: ${error}`);
        const frontendUrl = this.getFrontendUrl(req);
        res.redirect(
          `${frontendUrl}?error=oauth_error&message=${encodeURIComponent(error as string)}`
        );
        return;
      }

      if (!code || !state) {
        logger.error(`[${requestId}] Missing code or state`);
        const frontendUrl = this.getFrontendUrl(req);
        res.redirect(
          `${frontendUrl}?error=missing_params&message=${encodeURIComponent('Missing authorization code or state')}`
        );
        return;
      }

      const isCodeUsed = await oauthStateServiceV2.isCodeUsed(code as string);
      if (isCodeUsed) {
        logger.error(`[${requestId}] Authorization code already used`);
        const frontendUrl = this.getFrontendUrl(req);
        res.redirect(
          `${frontendUrl}?error=code_reused&message=${encodeURIComponent('Authorization code already used')}`
        );
        return;
      }

      const stateData = await oauthStateServiceV2.validateState(state as string, false);
      if (!stateData) {
        logger.error(`[${requestId}] Invalid or expired state`);
        const frontendUrl = this.getFrontendUrl(req);
        res.redirect(
          `${frontendUrl}?error=invalid_state&message=${encodeURIComponent('Invalid or expired state')}`
        );
        return;
      }

      if (stateData.platform === 'electron') {
        const frontendUrl = this.getFrontendUrl(req);
        const launchUrl = `${frontendUrl}/launch?code=${encodeURIComponent(code as string)}&state=${encodeURIComponent(state as string)}`;
        logger.info(
          `[${requestId}] Redirecting to Frontend launch page`
        );
        res.redirect(launchUrl);
        return;
      }

      await oauthStateServiceV2.deleteState(state as string);

      const codeVerifier = await pkceServiceV2.getAndDeleteVerifier(state as string);
      if (!codeVerifier) {
        logger.error(`[${requestId}] PKCE verifier not found`);
        const frontendUrl = this.getFrontendUrl(req);
        res.redirect(
          `${frontendUrl}?error=pkce_failed&message=${encodeURIComponent('PKCE verification failed')}`
        );
        return;
      }

      await oauthStateServiceV2.markCodeAsUsed(code as string);

      const redirectUri = `${this.getBackendUrl(req)}/api/auth/exchange`;

      logger.info('[X-Original-Host] : Redirect URI:', redirectUri);

      logger.info(`[${requestId}] Exchanging code for tokens`);
      const { tokens } = await this.googleClient.getToken({
        code: code as string,
        redirect_uri: redirectUri,
        codeVerifier: codeVerifier,
      });

      const { id_token, refresh_token, access_token } = tokens;

      if (!id_token) {
        logger.error(`[${requestId}] No ID token received`);
        const frontendUrl = this.getFrontendUrl(req);
        res.redirect(
          `${frontendUrl}?error=no_id_token&message=${encodeURIComponent('No ID token received')}`
        );
        return;
      }

      logger.info(`[${requestId}] Verifying ID token`);
      const ticket = await this.googleClient.verifyIdToken({
        idToken: id_token,
        audience: process.env.GOOGLE_CLIENT_ID,
      });

      const payload = ticket.getPayload();
      if (!payload) {
        logger.error(`[${requestId}] Invalid token payload`);
        const frontendUrl = this.getFrontendUrl(req);
        res.redirect(
          `${frontendUrl}?error=invalid_token&message=${encodeURIComponent('Invalid token payload')}`
        );
        return;
      }

      const googleUserData = {
        googleId: payload.sub,
        email: payload.email!,
        name: payload.name!,
        picture: payload.picture,
      };

      logger.info(`[${requestId}] Finding/creating user: ${googleUserData.email}`);
      const { user, isNewUser } = await this.userService.findOrCreateUser(googleUserData);

      // Ensure user presence entry exists (create if not exists, update timestamps if exists)
      await this.userService.ensureUserPresence(user.id);
      logger.info(`[${requestId}] User presence ensured for user ${user.id}`);

      const customToken = jwtService.generateToken({
        sub: user.id,
        email: user.email,
        name: user.name,
        picture: payload.picture,
      });

      let sessionId = null;

      if (refresh_token) {
        try {
          logger.info(`[${requestId}] Creating user session`);

          const refreshTokenExpiry = new Date();
          refreshTokenExpiry.setDate(refreshTokenExpiry.getDate() + 30);

          const accessTokenExpiry = payload.exp ? new Date(payload.exp * 1000) : undefined;

          const deviceInfo = JSON.stringify({
            userAgent: req.headers['user-agent'],
            acceptLanguage: req.headers['accept-language'],
            timestamp: new Date().toISOString(),
            platform: stateData.platform,
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
          logger.info(`[${requestId}] Session created: ${sessionId}`);
        } catch (sessionError) {
          logger.error(`[${requestId}] Session creation failed:`, sessionError);
        }
      }

      const isProduction = process.env.NODE_ENV === 'production';
      const cookieOptions = {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'strict' as const,
        path: '/',
      };

      res.cookie('google_access_token', customToken, {
        ...cookieOptions,
        maxAge: config.jwt.expirationSeconds * 1000,
      });

      if (sessionId) {
        res.cookie('user_session_id', sessionId, {
          ...cookieOptions,
          maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        });
      }

      // Set onboarding cookie for new users
      if (isNewUser) {
        res.cookie('is_new_user', 'true', {
          httpOnly: false, // Allow frontend to read this cookie
          secure: isProduction,
          sameSite: 'strict',
          path: '/',
          maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        });
        logger.info(`[${requestId}] Set is_new_user cookie for new user: ${user.email}`);
      }

      const frontendUrl = this.getFrontendUrl(req);
      logger.info(`[${requestId}] Redirecting to frontend with success`);
      res.redirect(`${frontendUrl}?success=true`);

    } catch (error) {
      logger.error(`[${requestId}] Callback error:`, error);

      const frontendUrl = this.getFrontendUrl(req);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.redirect(`${frontendUrl}?error=callback_failed&message=${encodeURIComponent(errorMessage)}`);
    }
  };

  refreshSession = async (req: Request, res: Response): Promise<void> => {
    const requestId = `REFRESH_${Date.now()}`;

    try {
      logger.info(`[${requestId}] Refresh session endpoint called`);

      const sessionId = req.cookies?.user_session_id;

      if (!sessionId) {
        logger.warn(`[${requestId}] No session ID cookie found`);
        res.status(401).json({
          error: 'No session found',
          message: 'Session ID cookie is missing',
        });
        return;
      }

      logger.info(`[${requestId}] Found session ID: ${sessionId}`);

      const session = await this.userSessionService.getSessionById(sessionId);

      if (!session || !session.user) {
        logger.warn(`[${requestId}] Session not found in database`);
        res.status(401).json({
          error: 'Invalid session',
          message: 'Session not found or expired',
        });
        return;
      }

      logger.info(`[${requestId}] Session found for user: ${session.user.email}`);

      if (session.status !== 'ACTIVE' || new Date() > session.refreshTokenExpiry) {
        logger.warn(`[${requestId}] Session expired or inactive`);
        res.status(401).json({
          error: 'Session expired',
          message: 'Please re-authenticate',
        });
        return;
      }

      logger.info(`[${requestId}] Generating new JWT token`);
      const customToken = jwtService.generateToken({
        sub: session.user.id,
        email: session.user.email,
        name: session.user.name,
        picture: session.user.picture,
      });

      await this.userSessionService.updateSession(session.id, {
        lastActivity: new Date(),
      });

      const isProduction = process.env.NODE_ENV === 'production';

      const cookieMaxAge = config.jwt.expirationSeconds * 1000;

      res.cookie('google_access_token', customToken, {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'strict',
        path: '/',
        maxAge: cookieMaxAge,
      });

      logger.info(`[${requestId}] New JWT cookie set for user: ${session.user.email}`);

      res.status(200).json({
        success: true,
        message: 'Session refreshed successfully',
      });

    } catch (error) {
      logger.error(`[${requestId}] Error refreshing session:`, error);

      res.status(500).json({
        error: 'Failed to refresh session',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  exchangeElectronCode = async (req: Request, res: Response): Promise<void> => {
    const requestId = `ELECTRON_EXCHANGE_${Date.now()}`;

    try {
      logger.info(`[${requestId}] Electron code exchange initiated`);

      const { code, state } = req.body;

      if (!code || !state) {
        logger.error(`[${requestId}] Missing code or state`);
        res.status(400).json({
          error: 'Missing parameters',
          message: 'Authorization code and state are required',
        });
        return;
      }

      const isCodeUsed = await oauthStateServiceV2.isCodeUsed(code);
      if (isCodeUsed) {
        logger.error(`[${requestId}] Authorization code already used`);
        res.status(409).json({
          error: 'Code already used',
          message: 'Authorization code has already been exchanged',
        });
        return;
      }

      const stateData = await oauthStateServiceV2.validateState(state);
      if (!stateData) {
        logger.error(`[${requestId}] Invalid or expired state`);
        res.status(401).json({
          error: 'Invalid state',
          message: 'State parameter is invalid or expired',
        });
        return;
      }

      if (stateData.platform !== 'electron') {
        logger.error(`[${requestId}] Invalid platform: ${stateData.platform}`);
        res.status(400).json({
          error: 'Invalid platform',
          message: 'This endpoint is only for Electron platform',
        });
        return;
      }

      const codeVerifier = await pkceServiceV2.getAndDeleteVerifier(state);
      if (!codeVerifier) {
        logger.error(`[${requestId}] PKCE verifier not found`);
        res.status(401).json({
          error: 'PKCE verification failed',
          message: 'Code verifier not found or expired',
        });
        return;
      }

      await oauthStateServiceV2.markCodeAsUsed(code);

      const redirectUri = `${this.getBackendUrl(req)}/api/auth/exchange`;

      logger.info('[X-Original-Host] : Redirect URI:', redirectUri);

      logger.info(`[${requestId}] Exchanging code for tokens`);
      const { tokens } = await this.googleClient.getToken({
        code,
        redirect_uri: redirectUri,
        codeVerifier: codeVerifier,
      });

      const { id_token, refresh_token, access_token } = tokens;

      if (!id_token) {
        logger.error(`[${requestId}] No ID token received`);
        res.status(500).json({
          error: 'No ID token',
          message: 'Google did not return an ID token',
        });
        return;
      }

      logger.info(`[${requestId}] Verifying ID token`);
      const ticket = await this.googleClient.verifyIdToken({
        idToken: id_token,
        audience: process.env.GOOGLE_CLIENT_ID,
      });

      const payload = ticket.getPayload();
      if (!payload) {
        logger.error(`[${requestId}] Invalid token payload`);
        res.status(500).json({
          error: 'Invalid token',
          message: 'Token payload is invalid',
        });
        return;
      }

      const googleUserData = {
        googleId: payload.sub,
        email: payload.email!,
        name: payload.name!,
        picture: payload.picture,
      };

      logger.info(`[${requestId}] Finding/creating user: ${googleUserData.email}`);
      const { user, isNewUser } = await this.userService.findOrCreateUser(googleUserData);

      // Ensure user presence entry exists (create if not exists, update timestamps if exists)
      await this.userService.ensureUserPresence(user.id);
      logger.info(`[${requestId}] User presence ensured for user ${user.id}`);

      const customToken = jwtService.generateToken({
        sub: user.id,
        email: user.email,
        name: user.name,
        picture: payload.picture,
      });

      let sessionId = null;

      if (refresh_token) {
        try {
          logger.info(`[${requestId}] Creating user session`);

          const refreshTokenExpiry = new Date();
          refreshTokenExpiry.setDate(refreshTokenExpiry.getDate() + 30);

          const accessTokenExpiry = payload.exp ? new Date(payload.exp * 1000) : undefined;

          const deviceInfo = JSON.stringify({
            userAgent: req.headers['user-agent'],
            acceptLanguage: req.headers['accept-language'],
            timestamp: new Date().toISOString(),
            platform: 'electron',
          });

          const session = await this.userSessionService.createSession({
            userId: user.id,
            refreshToken: refresh_token,
            refreshTokenExpiry,
            accessToken: access_token ?? undefined,
            accessTokenExpiry,
            deviceInfo,
            ipAddress: req.ip || undefined,
          });

          sessionId = session.id;
          logger.info(`[${requestId}] Session created: ${sessionId}`);
        } catch (sessionError) {
          logger.error(`[${requestId}] Session creation failed:`, sessionError);
        }
      }

      const isProduction = process.env.NODE_ENV === 'production';
      const cookieOptions = {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'strict' as const,
        path: '/',
      };

      res.cookie('google_access_token', customToken, {
        ...cookieOptions,
        maxAge: config.jwt.expirationSeconds * 1000,
      });

      if (sessionId) {
        res.cookie('user_session_id', sessionId, {
          ...cookieOptions,
          maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        });
      }

      // Set onboarding cookie for new users
      if (isNewUser) {
        res.cookie('is_new_user', 'true', {
          httpOnly: false,
          secure: isProduction,
          sameSite: 'strict',
          path: '/',
          maxAge: 30 * 24 * 60 * 60 * 1000,
        });
        logger.info(`[${requestId}] Set is_new_user cookie for new user: ${user.email}`);
      }

      logger.info(`[${requestId}] Electron code exchange successful`);
      res.status(200).json({
        success: true,
        message: 'Authentication successful',
      });

    } catch (error) {
      logger.error(`[${requestId}] Electron code exchange error:`, error);

      res.status(500).json({
        error: 'Exchange failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  exchangeMobileCode = async (req: Request, res: Response): Promise<void> => {
    const requestId = `EXCHANGE_CODE_${Date.now()}`;
    const frontendUrl = this.getFrontendUrl(req);

    try {
      const { code, error } = req.query;

      logger.info(`[${requestId}] OAuth callback received`);

      if (error) {
        logger.error(`[${requestId}] OAuth error: ${error}`);
        res.redirect(`${frontendUrl}?error=oauth_error&message=${encodeURIComponent(error as string)}`);
        return;
      }

      if (!code) {
        logger.error(`[${requestId}] Missing code`);
        res.redirect(`${frontendUrl}?error=missing_params&message=${encodeURIComponent('Missing authorization code')}`);
        return;
      }

      const isCodeUsed = await oauthStateServiceV2.isCodeUsed(code as string);
      if (isCodeUsed) {
        logger.error(`[${requestId}] Authorization code already used`);
        res.redirect(`${frontendUrl}?error=code_reused&message=${encodeURIComponent('Authorization code already used')}`);
        return;
      }

      await oauthStateServiceV2.markCodeAsUsed(code as string);

      const redirectUri = `${this.getBackendUrl(req)}/api/auth/exchange`;

      logger.info('[X-Original-Host] : Redirect URI:', redirectUri);

      logger.info(`[${requestId}] Exchanging code for tokens`);
      const { tokens } = await this.googleClient.getToken({
        code: code as string,
        redirect_uri: redirectUri,
      });

      const { id_token, refresh_token, access_token } = tokens;

      if (!id_token) {
        logger.error(`[${requestId}] No ID token received`);
        res.redirect(`${frontendUrl}?error=no_id_token&message=${encodeURIComponent('No ID token received')}`);
        return;
      }

      logger.info(`[${requestId}] Verifying ID token`);
      const ticket = await this.googleClient.verifyIdToken({
        idToken: id_token,
        audience: process.env.GOOGLE_CLIENT_ID,
      });

      const payload = ticket.getPayload();
      if (!payload) {
        logger.error(`[${requestId}] Invalid token payload`);
        res.redirect(`${frontendUrl}?error=invalid_token&message=${encodeURIComponent('Invalid token payload')}`);
        return;
      }

      const googleUserData = {
        googleId: payload.sub,
        email: payload.email!,
        name: payload.name!,
        picture: payload.picture,
      };

      logger.info(`[${requestId}] Finding/creating user: ${googleUserData.email}`);
      const { user, isNewUser } = await this.userService.findOrCreateUser(googleUserData);

      // Ensure user presence entry exists (create if not exists, update timestamps if exists)
      await this.userService.ensureUserPresence(user.id);
      logger.info(`[${requestId}] User presence ensured for user ${user.id}`);

      const customToken = jwtService.generateToken({
        sub: user.id,
        email: user.email,
        name: user.name,
        picture: payload.picture,
      });

      let sessionId = null;

      if (refresh_token) {
        try {
          logger.info(`[${requestId}] Creating user session`);

          const refreshTokenExpiry = new Date();
          refreshTokenExpiry.setDate(refreshTokenExpiry.getDate() + 30);

          const accessTokenExpiry = payload.exp ? new Date(payload.exp * 1000) : undefined;

          const deviceInfo = JSON.stringify({
            userAgent: req.headers['user-agent'],
            acceptLanguage: req.headers['accept-language'],
            timestamp: new Date().toISOString(),
            platform: 'mobile',
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
          logger.info(`[${requestId}] Session created: ${sessionId}`);
        } catch (sessionError) {
          logger.error(`[${requestId}] Session creation failed:`, sessionError);
        }
      }

      const isProduction = process.env.NODE_ENV === 'production';
      const cookieOptions = {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'strict' as const,
        path: '/',
      };

      res.cookie('google_access_token', customToken, {
        ...cookieOptions,
        maxAge: config.jwt.expirationSeconds * 1000,
      });

      if (sessionId) {
        res.cookie('user_session_id', sessionId, {
          ...cookieOptions,
          maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        });
      }

      // Set onboarding cookie for new users
      if (isNewUser) {
        res.cookie('is_new_user', 'true', {
          httpOnly: false,
          secure: isProduction,
          sameSite: 'strict',
          path: '/',
          maxAge: 30 * 24 * 60 * 60 * 1000,
        });
        logger.info(`[${requestId}] Set is_new_user cookie for new user: ${user.email}`);
      }

      const sendUserId = req.headers['x-platform'] === 'mobile';

      if (sendUserId) {
        res.status(200).json({
          success: true,
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            picture: user.picture,
          },
        });
        return;
      }

      logger.info(`[${requestId}] Redirecting to frontend with success`);
      res.redirect(`${frontendUrl}?success=true`);
    } catch (error) {
      logger.error(`[${requestId}] Callback error:`, error);

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.redirect(`${frontendUrl}?error=callback_failed&message=${encodeURIComponent(errorMessage)}`);
    }
  };

  logout = async (req: Request, res: Response): Promise<void> => {
    const requestId = `LOGOUT_${Date.now()}`;

    try {
      logger.info(`[${requestId}] Processing logout`);

      const sessionId = req.cookies?.user_session_id;
      if (sessionId) {
        logger.info(`[${requestId}] Revoking session: ${sessionId} for user ${req.user?.email}`);
        await this.userSessionService.revokeSession(sessionId);
      }

      res.clearCookie('google_access_token', { path: '/' });
      res.clearCookie('user_session_id', { path: '/' });

      if (req.headers.accept?.includes('application/json')) {
        res.status(200).json({
          success: true,
          message: 'Logged out successfully',
        });
        return;
      }

      const frontendUrl = this.getFrontendUrl(req);
      logger.info(`[${requestId}] Redirecting to frontend`);
      res.redirect(frontendUrl);

    } catch (error) {
      logger.error(`[${requestId}] Logout error:`, error);

      if (req.headers.accept?.includes('application/json')) {
        res.status(500).json({
          error: 'Logout failed',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      } else {
        const frontendUrl = this.getFrontendUrl(req);
        res.redirect(`${frontendUrl}?error=logout_failed`);
      }
    }
  };
}
