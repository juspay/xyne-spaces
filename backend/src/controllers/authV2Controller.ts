import { Request, Response } from 'express';
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';
import { logger } from '../utils/logger';
import { UserService } from '../services/userService';
import { UserSessionService } from '../services/userSessionService';
import { jwtService } from '../services/jwtService';
import { oauthStateServiceV2 } from '../services/oauthStateServiceV2';
import { pkceServiceV2 } from '../services/pkceServiceV2';
import { MicrosoftAuthController } from './microsoftAuthController';
import '../types/express';
import { config } from '@/config/env';

export class AuthV2Controller {
  private googleClient: OAuth2Client;
  private userService: UserService;
  private userSessionService: UserSessionService;
  private microsoftAuthController: MicrosoftAuthController;

  constructor() {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error(
        'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables are required'
      );
    }

    this.googleClient = new OAuth2Client(clientId, clientSecret);
    this.userService = new UserService();
    this.userSessionService = new UserSessionService();
    this.microsoftAuthController = new MicrosoftAuthController();
  }

  /**
   * Unified Electron code-exchange dispatcher.
   *
   * Peeks at the OAuth state (without consuming it) to determine which
   * provider issued it, then delegates to the provider-specific handler.
   * This lets the Electron app use a single deep link
   * (xyne-spaces://auth/callback) and a single POST endpoint for both
   * Google and Microsoft logins.
   */
  dispatchElectronExchange = async (req: Request, res: Response): Promise<void> => {
    const requestId = `ELECTRON_EXCHANGE_DISPATCH_${Date.now()}`;
    const state = typeof req.body?.state === 'string' ? req.body.state.trim() : '';

    if (state) {
      try {
        const stateData = await oauthStateServiceV2.validateState(state, false);
        if (stateData?.provider === 'microsoft') {
          return this.microsoftAuthController.exchangeElectron(req, res);
        }
      } catch (error) {
        logger.warn(
          `[${requestId}] Failed to peek OAuth state for provider dispatch; falling back to Google handler`,
          error,
        );
      }
    }

    return this.exchangeElectronCode(req, res);
  };

  private getFrontendUrl(req: Request | null = null): string {
    logger.info(`[X-Original-Host]: value: ${req?.headers['x-original-host']}`);

    if (req) {
      const originalHost = req.headers['x-original-host'];
      if (originalHost && typeof originalHost === 'string') {
        const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
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
        const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
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

      let validatedRedirectTo: string | undefined;
      const redirectToParam = req.query['redirect_to'] as string | undefined;
      if (redirectToParam) {
        const allowedOrigins = (process.env.ALLOWED_REDIRECT_ORIGINS ?? '')
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean);
        try {
          const origin = new URL(redirectToParam).origin;
          if (allowedOrigins.includes(origin)) {
            validatedRedirectTo = redirectToParam;
          }
        } catch (_e) {}
      }

      const state = await oauthStateServiceV2.generateState(platform, codeChallenge, validatedRedirectTo);

      await pkceServiceV2.storeVerifier(state, codeVerifier);

      const redirectUri = `${this.getBackendUrl(req)}/api/auth/exchange`;

      logger.info('[X-Original-Host] : Redirect URI:', redirectUri);

      const authUrl = this.googleClient.generateAuthUrl({
        access_type: 'offline',
        scope: ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/calendar.readonly'],
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
        logger.info(`[${requestId}] Redirecting to Frontend launch page`);
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

      logger.info(`[${requestId}] [DEBUG] Google auth success for: ${googleUserData.email}`);

      let workspaces = await this.userService.getWorkspacesByEmail(googleUserData.email);
      logger.info(`[${requestId}] [DEBUG] User has ${workspaces.length} workspace(s) before invitation check`);

      const pendingInvitationId = req.cookies?.pending_invitation_id as string | undefined;

      const userExistsButRemoved = await this.userService.userExistsButNoActiveWorkspaces(googleUserData.email);

      // Store pending auth data in cookie for later loginWorkspace/createOrg call
      const isProduction = process.env.NODE_ENV === 'production';
      res.cookie('google_access_token', JSON.stringify({
        user: googleUserData,
        provider: 'google',
        refreshToken: refresh_token,
        accessToken: access_token,
      }), {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'strict' as const,
        path: '/',
        maxAge: 10 * 60 * 1000, // 10 minutes pending auth window
      });

      const frontendUrl = stateData.redirectTo ?? this.getFrontendUrl(req);

      // If an invitation is pending, redirect back to the invite page for explicit acceptance.
      // The google_access_token cookie (set above) carries identity for acceptInvitation + loginWorkspace.
      // Clear pending_invitation_id now — it is one-time-use; clearing it here prevents a
      // subsequent re-login (e.g. after workspace switch) from re-triggering this flow with
      // an already-accepted invitation.
      if (pendingInvitationId) {
        logger.info(`[${requestId}] Pending invitation ${pendingInvitationId} found — redirecting to invite page for ${googleUserData.email}`);
        res.clearCookie('pending_invitation_id', { path: '/' });
        const inviteParams = new URLSearchParams({
          loginComplete: 'true',
          invitationId: pendingInvitationId,
          loggedInEmail: googleUserData.email,
        });
        res.redirect(`${frontendUrl}/invite?${inviteParams.toString()}`);
        return;
      }

      logger.info(`[${requestId}] Redirecting to frontend with workspaces`);

      // Redirect with workspaces (frontend will select workspace)
      const params = new URLSearchParams({
        success: 'true',
        email: googleUserData.email,
        name: googleUserData.name,
        picture: googleUserData.picture || '',
        workspaces: JSON.stringify(workspaces),
        userExistsButRemoved: String(userExistsButRemoved),
      });

      res.redirect(`${frontendUrl}?${params.toString()}`);
      return;
    } catch (error) {
      logger.error(`[${requestId}] Callback error:`, error);

      const frontendUrl = this.getFrontendUrl(req);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.redirect(
        `${frontendUrl}?error=callback_failed&message=${encodeURIComponent(errorMessage)}`
      );
    }
  };

  refreshSession = async (req: Request, res: Response): Promise<void> => {
    const requestId = `REFRESH_${Date.now()}`;

    try {
      logger.info(`[${requestId}] Refresh session endpoint called`);

      // Get session from global session cookie
      const sessionId = req.cookies?.xyne_session;

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
        workspaceId: session.user.workspaceId ?? undefined,
        memberId: session.user.orgMemberId,
      });

      await this.userSessionService.updateSession(session.id, {
        lastActivity: new Date(),
      });

      const isProduction = process.env.NODE_ENV === 'production';

      const cookieMaxAge = config.jwt.expirationSeconds * 1000;
      const targetWorkspaceId = session.user.workspaceId;

      // Set workspace-specific token cookie
      if (targetWorkspaceId) {
        res.cookie(`xyne_ws_${targetWorkspaceId}_token`, customToken, {
          httpOnly: true,
          secure: isProduction,
          sameSite: 'strict',
          path: '/',
          maxAge: cookieMaxAge,
        });
      }

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

      logger.info(`[${requestId}] Getting workspaces for: ${googleUserData.email}`);
      const workspaces = await this.userService.getWorkspacesByEmail(googleUserData.email);
      const userExistsButRemoved = await this.userService.userExistsButNoActiveWorkspaces(googleUserData.email);

      // Store pending auth data for later loginWorkspace/createOrg call
      const isProduction = process.env.NODE_ENV === 'production';
      res.cookie('google_access_token', JSON.stringify({
        user: googleUserData,
        provider: 'google',
        refreshToken: refresh_token,
        accessToken: access_token,
      }), {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'strict' as const,
        path: '/',
        maxAge: 10 * 60 * 1000, // 10 minutes pending auth window
      });

      logger.info(`[${requestId}] Electron code exchange successful`);
      res.status(200).json({
        success: true,
        email: googleUserData.email,
        name: googleUserData.name,
        picture: googleUserData.picture,
        workspaces,
        userExistsButRemoved,
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

    const isMobileNative =
      req.headers['x-platform'] === 'mobile' || req.query.platform === 'mobile';

    // Helper to send error response (JSON for mobile, redirect for web)
    const sendError = (errorCode: string, message: string, statusCode = 400) => {
      if (isMobileNative) {
        res.status(statusCode).json({
          success: false,
          error: errorCode,
          message,
        });
      } else {
        res.redirect(`${frontendUrl}?error=${errorCode}&message=${encodeURIComponent(message)}`);
      }
    };

    try {
      // Support both query params and body for mobile
      const code = (req.query.code || req.body?.code) as string | undefined;
      const error = req.query.error as string | undefined;

      logger.info(`[${requestId}] OAuth code exchange received (mobile: ${isMobileNative})`);

      if (error) {
        logger.error(`[${requestId}] OAuth error: ${error}`);
        sendError('oauth_error', error as string);
        return;
      }

      if (!code) {
        logger.error(`[${requestId}] Missing code`);
        sendError('missing_params', 'Missing authorization code');
        return;
      }

      const isCodeUsed = await oauthStateServiceV2.isCodeUsed(code as string);
      if (isCodeUsed) {
        logger.error(`[${requestId}] Authorization code already used`);
        sendError('code_reused', 'Authorization code already used');
        return;
      }

      await oauthStateServiceV2.markCodeAsUsed(code as string);

      // For mobile native apps using serverAuthCode, use empty string as redirect_uri
      // For web OAuth flow, use the backend callback URL
      const redirectUri = isMobileNative ? '' : `${this.getBackendUrl(req)}/api/auth/exchange`;

      logger.info('[X-Original-Host] : Redirect URI:', redirectUri);

      logger.info(`[${requestId}] Exchanging code for tokens`);
      const { tokens } = await this.googleClient.getToken({
        code: code as string,
        redirect_uri: redirectUri,
      });

      const { id_token, refresh_token, access_token } = tokens;

      if (!id_token) {
        logger.error(`[${requestId}] No ID token received`);
        sendError('no_id_token', 'No ID token received', 500);
        return;
      }

      logger.info(`[${requestId}] Verifying ID token`);
      const ticket = await this.googleClient.verifyIdToken({
        idToken: id_token,
        // Accept both web and iOS client IDs
        audience: [process.env.GOOGLE_CLIENT_ID!, process.env.GOOGLE_IOS_CLIENT_ID!].filter(
          Boolean
        ),
      });

      const payload = ticket.getPayload();
      if (!payload) {
        logger.error(`[${requestId}] Invalid token payload`);
        sendError('invalid_token', 'Invalid token payload', 401);
        return;
      }

      const googleUserData = {
        googleId: payload.sub,
        email: payload.email!,
        name: payload.name!,
        picture: payload.picture,
      };

      logger.info(`[${requestId}] Google auth success for: ${googleUserData.email}`);

      const workspaces = await this.userService.getWorkspacesByEmail(googleUserData.email);

      const isProduction = process.env.NODE_ENV === 'production';
      const cookieOptions = {
        httpOnly: true,
        secure: isProduction || isMobileNative, // Must be secure for sameSite: 'none'
        sameSite: (isMobileNative ? 'none' : 'strict') as 'none' | 'strict',
        path: '/',
        maxAge: 10 * 60 * 1000, // 10 minutes
      };

      // Store all Google auth data in one cookie (until workspace selection)
      const customToken = {
        user: googleUserData,
        refreshToken: refresh_token || null,
        accessToken: access_token || null,
      };
      res.cookie('google_auth_pending', JSON.stringify(customToken), cookieOptions);
      logger.info(`[${requestId}] Stored pending auth data for workspace selection`);

      if (isMobileNative) {
        logger.info(`[${requestId}] Mobile auth successful for: ${googleUserData.email}`);
        res.status(200).json({
          success: true,
          email: googleUserData.email,
          name: googleUserData.name,
          picture: googleUserData.picture,
          workspaces,
        });
        return;
      }

      logger.info(`[${requestId}] Redirecting to frontend with workspaces`);

      // Redirect with workspaces (frontend will select workspace)
      const params = new URLSearchParams({
        success: 'true',
        email: googleUserData.email,
        name: googleUserData.name,
        picture: googleUserData.picture || '',
        workspaces: JSON.stringify(workspaces),
      });

      res.redirect(`${frontendUrl}?${params.toString()}`);
      return;
    } catch (error) {
      logger.error(`[${requestId}] Callback error:`, error);

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (isMobileNative) {
        res.status(500).json({
          success: false,
          error: 'callback_failed',
          message: errorMessage,
        });
      } else {
        res.redirect(
          `${frontendUrl}?error=callback_failed&message=${encodeURIComponent(errorMessage)}`
        );
      }
    }
  };

  logout = async (req: Request, res: Response): Promise<void> => {
    const requestId = `LOGOUT_${Date.now()}`;

    try {
      logger.info(`[${requestId}] Processing logout`);

      // Find and revoke global session
      const sessionId = req.cookies?.xyne_session;
      
      if (sessionId) {
        logger.info(`[${requestId}] Revoking session: ${sessionId} for user ${req.user?.email}`);
        await this.userSessionService.revokeSession(sessionId);
      }

      // Clear global session cookie
      res.clearCookie('xyne_session', { path: '/' });
      
      // Clear all workspace-specific token cookies (session is now global)
      for (const cookieName of Object.keys(req.cookies || {})) {
        if (cookieName.startsWith('xyne_ws_') && cookieName.endsWith('_token')) {
          res.clearCookie(cookieName, { path: '/' });
        }
      }
      
      // Clear last workspace cookie
      res.clearCookie('xyne_last_workspace', { path: '/' });

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

  /**
   * Login to a specific workspace
   * POST /api/auth/login-workspace
   */
  loginWorkspace = async (req: Request, res: Response): Promise<void> => {
    try {
      const { workspaceId } = req.body;

      logger.info(`[DEBUG] [loginWorkspace] Called with workspaceId=${workspaceId ?? 'MISSING'} pending_invitation_id=${req.cookies?.pending_invitation_id ?? 'NONE'} has_google_access_token=${!!req.cookies?.google_access_token}`);

      if (!workspaceId) {
        res.status(400).json({
          error: 'Missing required fields',
          message: 'workspaceId is required'
        });
        return;
      }

      // Get pending auth data from cookie
      const pendingAuthCookie = req.cookies?.google_access_token;
      if (!pendingAuthCookie) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Pending auth data not found or expired'
        });
        return;
      }

      let customToken;
      try {
        customToken = JSON.parse(pendingAuthCookie);
      } catch {
        res.status(401).json({
          error: 'Invalid auth data',
          message: 'Pending auth data is corrupted'
        });
        return;
      }

      const { user: oauthUserData, provider, refreshToken: pendingRefreshToken, accessToken: pendingAccessToken } = customToken;

      if (!oauthUserData?.email) {
        res.status(401).json({
          error: 'Invalid auth data',
          message: 'User data missing from pending auth'
        });
        return;
      }

      logger.info(`[LOGIN-WORKSPACE] User ${oauthUserData.email} logging into workspace ${workspaceId} via ${provider}`);

      // Create workspace-scoped user (or get existing)
      const { user: workspaceUser, isNewUser } = await this.userService.createOrGetWorkspaceUser({
        providerUserId: oauthUserData.providerUserId || oauthUserData.googleId,
        email: oauthUserData.email,
        name: oauthUserData.name,
        picture: oauthUserData.picture,
        workspaceId,
        authProvider: provider,
      });

      // Ensure user presence for workspace-scoped user
      await this.userService.ensureUserPresence(workspaceUser.id);
      let sessionId = null;

      if (pendingRefreshToken) {
        try {
          const refreshTokenExpiry = new Date();
          refreshTokenExpiry.setDate(refreshTokenExpiry.getDate() + 30);


          const deviceInfo = JSON.stringify({
            userAgent: req.headers['user-agent'],
            acceptLanguage: req.headers['accept-language'],
            timestamp: new Date().toISOString(),
          });

          const session = await this.userSessionService.createSession({
            userId: workspaceUser.id,
            refreshToken: pendingRefreshToken,
            refreshTokenExpiry,
            accessToken: pendingAccessToken,
            deviceInfo,
            ipAddress: req.ip || req.connection.remoteAddress || undefined,
          });

          sessionId = session.id;
          logger.info(`[LOGIN-WORKSPACE] Session created: ${sessionId}`);
        } catch (sessionError) {
          logger.error(`[LOGIN-WORKSPACE] Session creation failed:`, sessionError);
        }
      }

      const token = jwtService.generateToken({
        sub: workspaceUser.id,
        email: workspaceUser.email,
        name: workspaceUser.name,
        picture: workspaceUser.picture || undefined,
        workspaceId: workspaceUser.workspaceId ?? undefined,
        memberId: workspaceUser.orgMemberId,
      });

      const isProduction = process.env.NODE_ENV === 'production';
      const cookieOptions = {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'strict' as const,
        path: '/',
      };

      // Set workspace-specific cookies only
      res.cookie(`xyne_ws_${workspaceId}_token`, token, {
        ...cookieOptions,
        maxAge: config.jwt.expirationSeconds * 1000,
      });

      // Set last workspace pointer
      res.cookie('xyne_last_workspace', workspaceId, {
        ...cookieOptions,
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      });

      if (sessionId) {
        res.cookie('xyne_session', sessionId, {
          ...cookieOptions,
          maxAge: config.session.expiryDays * 24 * 60 * 60 * 1000,
        });
      }

      // Set is_new_user cookie for new users (readable by frontend)
      if (isNewUser) {
        res.cookie('is_new_user', 'true', {
          httpOnly: false,
          secure: isProduction,
          sameSite: 'strict' as const,
          path: '/',
          maxAge: 30 * 24 * 60 * 60 * 1000,
        });
        logger.info(`[LOGIN-WORKSPACE] Set is_new_user cookie for new user: ${workspaceUser.email}`);
      }

      const orgRole = workspaceUser.orgMemberId
        ? (await this.userService.getOrgRole(workspaceUser.orgMemberId)) ?? ''
        : '';

      // Clear pending auth cookie and return success
      res.clearCookie('google_access_token', { path: '/' });
      res.status(200).json({
        success: true,
        workspaceId,
        user: {
          id: workspaceUser.id,
          googleId: workspaceUser.providerUserId,
          email: workspaceUser.email,
          name: workspaceUser.name,
          picture: workspaceUser.picture,
          workspaceId: workspaceUser.workspaceId,
          role: workspaceUser.role,
          orgRole: orgRole,
          memberId: workspaceUser.orgMemberId,
        },
        isNewUser,
      });
    } catch (error) {
      logger.error('Error logging into workspace:', error);
      res.status(500).json({
        error: 'Failed to login to workspace',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  /**
   * Create a new organization and workspace
   * POST /api/auth/create-org
   */
  createOrg = async (req: Request, res: Response): Promise<void> => {
    try {
      const { orgName, workspaceName } = req.body as { orgName: string; workspaceName: string };

      // Get pending auth data from cookie
      const pendingAuthCookie = req.cookies?.google_access_token;
      if (!pendingAuthCookie) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Pending auth data not found or expired'
        });
        return;
      }

      let customToken;
      try {
        customToken = JSON.parse(pendingAuthCookie);
      } catch {
        res.status(401).json({
          error: 'Invalid auth data',
          message: 'Pending auth data is corrupted'
        });
        return;
      }

      const { user: oauthUserData, provider, refreshToken: pendingRefreshToken } = customToken;

      if (!oauthUserData?.email) {
        res.status(401).json({
          error: 'Invalid auth data',
          message: 'User data missing from pending auth'
        });
        return;
      }

      logger.info(`[CREATE-ORG] User ${oauthUserData.email} creating org "${orgName}" with workspace "${workspaceName}" via ${provider}`);

      const userData = {
        providerUserId: oauthUserData.providerUserId || oauthUserData.googleId,
        email: oauthUserData.email,
        name: oauthUserData.name,
        picture: oauthUserData.picture,
      };

      const { organization, workspace, workspaceUser } = await this.userService.createOrganizationWithUser(
        userData,
        orgName,
        workspaceName,
        provider
      );

      // Ensure user presence for workspace-scoped user
      await this.userService.ensureUserPresence(workspaceUser.id);
      let sessionId = null;

      if (pendingRefreshToken) {
        try {
          const refreshTokenExpiry = new Date();
          refreshTokenExpiry.setDate(refreshTokenExpiry.getDate() + 30);

          const deviceInfo = JSON.stringify({
            userAgent: req.headers['user-agent'],
            acceptLanguage: req.headers['accept-language'],
            timestamp: new Date().toISOString(),
          });

          const session = await this.userSessionService.createSession({
            userId: workspaceUser.id,
            refreshToken: pendingRefreshToken,
            refreshTokenExpiry,
            deviceInfo,
            ipAddress: req.ip || req.connection.remoteAddress || undefined,
          });

          sessionId = session.id;
          logger.info(`[CREATE-ORG] Session created: ${sessionId}`);
        } catch (sessionError) {
          logger.error(`[CREATE-ORG] Session creation failed:`, sessionError);
        }
      }

      const token = jwtService.generateToken({
        sub: workspaceUser.id,
        email: workspaceUser.email,
        name: workspaceUser.name,
        picture: workspaceUser.picture || undefined,
        workspaceId: workspaceUser.workspaceId ?? undefined,
        memberId: workspaceUser.orgMemberId,
      });

      const isProduction = process.env.NODE_ENV === 'production';
      const cookieOptions = {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'strict' as const,
        path: '/',
      };

      // Set workspace-specific cookies
      const targetWorkspaceId = workspaceUser.workspaceId;
      
      res.cookie(`xyne_ws_${targetWorkspaceId}_token`, token, {
        ...cookieOptions,
        maxAge: config.jwt.expirationSeconds * 1000,
      });

      if (sessionId) {
        res.cookie('xyne_session', sessionId, {
          ...cookieOptions,
          maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        });
      }
      
      // Set last workspace pointer
      res.cookie('xyne_last_workspace', targetWorkspaceId, {
        ...cookieOptions,
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      });

      // Set is_new_user cookie for new users (readable by frontend)
      res.cookie('is_new_user', 'true', {
        httpOnly: false,
        secure: isProduction,
        sameSite: 'strict' as const,
        path: '/',
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
      });

      // Clear pending auth cookie
      res.clearCookie('google_access_token', { path: '/' });

      logger.info(`[CREATE-ORG] Created org ${organization.orgId} with workspace ${workspace.id}`);

      res.status(201).json({
        organization: {
          id: organization.orgId,
          name: organization.name
        },
        workspace: {
          id: workspace.id,
          name: workspace.name
        },
        user: {
          id: workspaceUser.id,
          email: workspaceUser.email,
          name: workspaceUser.name,
          picture: workspaceUser.picture,
          role: workspaceUser.role,
          workspaceId: workspaceUser.workspaceId
        },
        isNewUser: true
      });

    } catch (error) {
      logger.error('Error creating organization:', error);
      res.status(500).json({
        error: 'Failed to create organization',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };

  /**
   * Get all workspaces the authenticated user belongs to (by email)
   * GET /api/auth/workspaces
   */
  getWorkspaces = async (req: Request, res: Response): Promise<void> => {
    try {
      const email = req.user!.email;
      const workspaces = await this.userService.getWorkspacesByEmail(email);
      res.status(200).json({ workspaces });
    } catch (error) {
      logger.error('Error getting workspaces:', error);
      res.status(500).json({
        error: 'Failed to get workspaces',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  /**
   * Switch to a different workspace (user already authenticated).
   * Finds the User record for this email in the target workspace,
   * issues a new JWT + creates a new UserSession — no OAuth triggered.
   * POST /api/auth/switch-workspace
   */
  switchWorkspace = async (req: Request, res: Response): Promise<void> => {
    try {
      const { workspaceId } = req.body as { workspaceId?: string };
      if (!workspaceId) {
        res.status(400).json({ error: 'Missing required fields', message: 'workspaceId is required' });
        return;
      }

      const currentUser = req.user!;

      // Find the User record scoped to the target workspace
      const targetUser = await this.userService.findUserByEmail(currentUser.email, workspaceId);
      if (!targetUser) {
        res.status(403).json({
          error: 'Forbidden',
          message: 'You do not have access to this workspace',
        });
        return;
      }

      await this.userService.ensureUserPresence(targetUser.id);

      // Get existing session from global session cookie
      // We reuse the same session across workspaces (session belongs to user, not workspace)
      const sessionId = req.cookies?.xyne_session;
      
      // Verify session exists and is valid
      let validSessionId: string | null = null;
      if (sessionId) {
        const currentSession = await this.userSessionService.getSessionById(sessionId);
        if (currentSession && currentSession.status === 'ACTIVE') {
          validSessionId = currentSession.id;
          logger.info(`[SWITCH-WORKSPACE] Reusing existing session: ${validSessionId}`);
        }
      }
      
      if (!validSessionId) {
        logger.warn(`[SWITCH-WORKSPACE] No valid session found for workspace switch`);
      }

      const token = jwtService.generateToken({
        sub: targetUser.id,
        email: targetUser.email,
        name: targetUser.name,
        picture: targetUser.picture || undefined,
        workspaceId: targetUser.workspaceId ?? undefined,
        memberId: targetUser.orgMemberId,
      });

      const isProduction = process.env.NODE_ENV === 'production';
      const cookieBase = { httpOnly: true, secure: isProduction, sameSite: 'strict' as const, path: '/' };

      // Set workspace-specific cookies
      res.cookie(`xyne_ws_${workspaceId}_token`, token, { ...cookieBase, maxAge: config.jwt.expirationSeconds * 1000 });
      res.cookie('xyne_last_workspace', workspaceId, { ...cookieBase, maxAge: 30 * 24 * 60 * 60 * 1000 });
      
      // Set global session cookie (reusing existing session)
      if (validSessionId) {
        res.cookie('xyne_session', validSessionId, { ...cookieBase, maxAge: 30 * 24 * 60 * 60 * 1000 });
      }

      logger.info(`[SWITCH-WORKSPACE] User ${currentUser.email} switched to workspace ${workspaceId}`);

      res.status(200).json({
        user: {
          id: targetUser.id,
          email: targetUser.email,
          name: targetUser.name,
          picture: targetUser.picture,
          workspaceId: targetUser.workspaceId,
          role: targetUser.role,
          memberId: targetUser.orgMemberId,
        },
      });
    } catch (error) {
      logger.error('Error switching workspace:', error);
      res.status(500).json({
        error: 'Failed to switch workspace',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  /**
   * Create a new org + workspace while already authenticated (no google_auth_pending cookie needed).
   * POST /api/auth/create-workspace
   */
  createWorkspaceAuth = async (req: Request, res: Response): Promise<void> => {
    try {
      const { workspaceName } = req.body as { workspaceName?: string };
      if (!workspaceName) {
        res.status(400).json({ error: 'Missing required fields', message: 'workspaceName is required' });
        return;
      }

      const currentUser = req.user!;
      const fullUser = await this.userService.getUserById(currentUser.id);
      if (!fullUser) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      const { organization, workspace, workspaceUser } = await this.userService.createWorkspaceInOrg(
        { userId: fullUser.id, providerUserId: fullUser.providerUserId, email: fullUser.email, name: fullUser.name, picture: fullUser.picture },
        workspaceName,
      );

      await this.userService.ensureUserPresence(workspaceUser.id);

      // Reuse refresh token from current session
      // Get global session cookie
      const sessionId = req.cookies?.xyne_session;
      
      const currentSession = sessionId ? await this.userSessionService.getSessionById(sessionId) : null;

      let newSessionId: string | null = null;
      if (currentSession?.refreshToken) {
        try {
          const refreshTokenExpiry = new Date();
          refreshTokenExpiry.setDate(refreshTokenExpiry.getDate() + 30);
          const newSession = await this.userSessionService.createSession({
            userId: workspaceUser.id,
            refreshToken: currentSession.refreshToken,
            refreshTokenExpiry,
            accessToken: currentSession.accessToken ?? undefined,
            deviceInfo: JSON.stringify({ userAgent: req.headers['user-agent'], timestamp: new Date().toISOString() }),
            ipAddress: req.ip || req.connection.remoteAddress || undefined,
          });
          newSessionId = newSession.id;
        } catch (sessionError) {
          logger.error('[CREATE-WORKSPACE-AUTH] Session creation failed:', sessionError);
        }
      }

      const token = jwtService.generateToken({
        sub: workspaceUser.id,
        email: workspaceUser.email,
        name: workspaceUser.name,
        picture: workspaceUser.picture || undefined,
        workspaceId: workspaceUser.workspaceId ?? undefined,
        memberId: workspaceUser.orgMemberId,
      });

      const isProduction = process.env.NODE_ENV === 'production';
      const cookieBase = { httpOnly: true, secure: isProduction, sameSite: 'strict' as const, path: '/' };

      // Set workspace-specific cookies
      const targetWorkspaceId = workspaceUser.workspaceId;
      
      res.cookie(`xyne_ws_${targetWorkspaceId}_token`, token, { ...cookieBase, maxAge: config.jwt.expirationSeconds * 1000 });
      if (newSessionId) {
        res.cookie('xyne_session', newSessionId, { ...cookieBase, maxAge: 30 * 24 * 60 * 60 * 1000 });
      }
      res.cookie('xyne_last_workspace', targetWorkspaceId, { ...cookieBase, maxAge: 30 * 24 * 60 * 60 * 1000 });
      res.cookie('is_new_user', 'true', {
        httpOnly: false, secure: isProduction, sameSite: 'strict' as const, path: '/', maxAge: 24 * 60 * 60 * 1000,
      });

      logger.info(`[CREATE-WORKSPACE-AUTH] Created org ${organization.orgId} / workspace ${workspace.id} for ${currentUser.email}`);

      res.status(201).json({
        organization: { id: organization.orgId, name: organization.name },
        workspace: { id: workspace.id, name: workspace.name },
        user: {
          id: workspaceUser.id,
          email: workspaceUser.email,
          name: workspaceUser.name,
          picture: workspaceUser.picture,
          workspaceId: workspaceUser.workspaceId,
        },
        isNewUser: true,
      });
    } catch (error) {
      logger.error('Error creating workspace:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(message.includes('already exists') ? 409 : 500).json({
        error: 'Failed to create workspace',
        message,
      });
    }
  };
}