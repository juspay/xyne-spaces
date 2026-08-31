import { Request, Response } from 'express';
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger';
import { UserService } from '../services/userService';
import { UserSessionService } from '../services/userSessionService';
import { jwtService } from '../services/jwtService';
import { oauthStateServiceV2 } from '../services/oauthStateServiceV2';
import { pkceServiceV2 } from '../services/pkceServiceV2';
import { MicrosoftAuthController } from './microsoftAuthController';
import { channelService } from '../services/channelService';
import { WorkspaceJoinPolicy, WorkspaceType, AuthProvider, UserStatus, OrgRole } from '@xyne/shared';
import type { WorkspaceJoinPolicy as WorkspaceJoinPolicyValue, WorkspaceType as WorkspaceTypeValue } from '@xyne/shared';

import '../types/express';
import { config } from '@/config/env';
import { DatabaseClient } from '@/database/client';
import { runAsSystem } from '@/database/tenant/context';
import { getEncryptionProvider } from '@/services/encryption';
import { getFrontendUrl, resolveConfiguredOAuthRedirectUrl } from '@/utils/publicUrls';
import {
  OrganizationDomainConflictError,
  PublicEmailDomainError,
  isOrganizationPolicyError,
  organizationDomainService,
} from '@/services/organizationDomainService';
import { migrateLegacyIdentity } from '@/services/legacyIdentityMigrationHelper';
import { redisService } from '@/services/redisService';
import { randomUUID } from 'crypto';
import { setOnboardingCookie } from '@/utils/onboardingCookie';

/**
 * Result type for single workspace auto-login
 */
type AutoLoginResult = {
  workspaceUser: {
    id: string;
    email: string;
    name: string;
    picture: string | null;
    workspaceId: string | null;
    orgMemberId: string | null;
    providerUserId: string;
    role: string;
  };
  sessionId: string | null;
  jwtToken: string;
  isNewUser: boolean;
};

export class AuthV2Controller {
  private googleClient: OAuth2Client;
  private googleClientNew: OAuth2Client | null = null;
  private mobileGoogleClient: OAuth2Client;
  private userService: UserService;
  private userSessionService: UserSessionService;
  private microsoftAuthController: MicrosoftAuthController;
  private prisma = DatabaseClient.getInstance();

  private async storePendingOAuthTokens(
    refreshToken?: string | null,
    accessToken?: string | null,
    accessTokenExpiry?: Date,
  ): Promise<string> {
    const tokenKey = randomUUID();
    await redisService.set(
      `${config.pendingOAuthTokens.redisKeyPrefix}${tokenKey}`,
      JSON.stringify({
        refreshToken: refreshToken ?? null,
        accessToken: accessToken ?? null,
        accessTokenExpiry: accessTokenExpiry?.toISOString() ?? null,
      }),
      config.pendingOAuthTokens.ttlSeconds,
    );
    return tokenKey;
  }

  constructor() {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const mobileClientId = process.env.GOOGLE_MOBILE_CLIENT_ID;
    const mobileClientSecret = process.env.GOOGLE_MOBILE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error(
        'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables are required'
      );
    }

    this.googleClient = new OAuth2Client(clientId, clientSecret);

    const clientIdNew = process.env.GOOGLE_CLIENT_ID_NEW;
    const clientSecretNew = process.env.GOOGLE_CLIENT_SECRET_NEW;
    if (clientIdNew && clientSecretNew) {
      this.googleClientNew = new OAuth2Client(clientIdNew, clientSecretNew);
    }
    this.mobileGoogleClient = new OAuth2Client(mobileClientId, mobileClientSecret);

    this.userService = new UserService();
    this.userSessionService = new UserSessionService();
    this.microsoftAuthController = new MicrosoftAuthController();
  }

  private getGoogleClient(isNy?: boolean): OAuth2Client {
    if (isNy && this.googleClientNew) {
      return this.googleClientNew;
    }
    return this.googleClient;
  }

  private async ensureSelfDmForUser(
    userId: string,
    workspaceId: string
  ): Promise<string | null> {
    try {
      const selfDmChannelId = await channelService.ensureSelfDmExists(userId, workspaceId);
      logger.info(`[ensureSelfDmForUser] Self-DM ensured for user ${userId}: ${selfDmChannelId}`);
      return selfDmChannelId;
    } catch (error) {
      logger.error(`[ensureSelfDmForUser] Failed to ensure self-DM for user ${userId}:`, error);
      return null;
    }
  }

  /**
   * Performs single-workspace auto-login (core logic shared across web, mobile, electron).
   * Creates workspace user, session, and generates JWT.
   */
  private async performSingleWorkspaceAutoLogin(
    googleUserData: {
      googleId: string;
      email: string;
      name: string;
      picture?: string;
    },
    workspaceId: string,
    refreshToken: string | null | undefined,
    accessToken: string | null | undefined,
    req: Request,
    platform: 'web' | 'mobile' | 'electron'
  ): Promise<AutoLoginResult> {
    // Create/get workspace user
    const { user: workspaceUser, isNewUser } = await this.userService.createOrGetWorkspaceUser({
      providerUserId: googleUserData.googleId,
      email: googleUserData.email,
      name: googleUserData.name,
      picture: googleUserData.picture,
      workspaceId,
      authProvider: AuthProvider.GOOGLE,
    });

    // Create session
    let sessionId: string | null = null;
    if (refreshToken) {
      try {
        const refreshTokenExpiry = new Date();
        refreshTokenExpiry.setDate(refreshTokenExpiry.getDate() + 30);

        const deviceInfo = JSON.stringify({
          userAgent: req.headers['user-agent'],
          acceptLanguage: req.headers['accept-language'],
          timestamp: new Date().toISOString(),
          platform,
          appVersion: req.headers['x-app-version'],
        });

        const session = await this.userSessionService.createSession({
          userId: workspaceUser.id,
          refreshToken,
          refreshTokenExpiry,
          accessToken: accessToken ?? undefined,
          deviceInfo,
          ipAddress: req.ip || req.connection.remoteAddress || undefined,
        });

        sessionId = session.id;
      } catch (sessionError) {
        logger.error(`[performSingleWorkspaceAutoLogin] Session creation failed:`, sessionError);
      }
    }

    // Generate JWT with workspace context
    const jwtToken = jwtService.generateToken({
      sub: workspaceUser.id,
      email: workspaceUser.email,
      name: workspaceUser.name,
      picture: workspaceUser.picture || undefined,
      workspaceId: workspaceUser.workspaceId ?? undefined,
      memberId: workspaceUser.orgMemberId,
    });

    return { workspaceUser, sessionId, jwtToken, isNewUser };
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

  private getGoogleRedirectUri(req: Request): string {
    return resolveConfiguredOAuthRedirectUrl(
      config.googleAuthRedirectUri,
      config.backendUrl,
      '/api/auth/exchange',
      'GOOGLE_AUTH_REDIRECT_URI',
      req,
    );
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

  private getEnterpriseAwareWorkspaces<T extends { workspaceType?: string | null }>(
    workspaces: T[],
    enterpriseLogin?: boolean,
  ): T[] {
    if (!enterpriseLogin) {
      return workspaces;
    }

    return workspaces.filter(workspace => workspace.workspaceType !== WorkspaceType.COMMUNITY);
  }

  initiateLogin = async (req: Request, res: Response): Promise<void> => {
    const requestId = `LOGIN_${Date.now()}`;

    try {
      logger.info(`[${requestId}] Initiating OAuth login`);

      const platformQuery = req.query.platform as 'electron' | 'web' | 'mobile';
      const platform = platformQuery || this.detectPlatform(req);
      logger.info(`[${requestId}] Detected platform: ${platform}`);

      const isNy = req.query.isNy === 'true';
      const enterpriseLogin = req.query.enterpriseLogin === 'true';

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
          const frontendOrigin = new URL(getFrontendUrl(req)).origin;
          if (allowedOrigins.includes(origin) || origin === frontendOrigin) {
            validatedRedirectTo = redirectToParam;
          }
        } catch (_e) {
          // Ignore malformed redirect targets; only configured origins are allowed.
        }
      }

      // Get invitationId from query (for invitation flow)
      const invitationId = req.query.invitationId as string | undefined;

      const state = await oauthStateServiceV2.generateState(
        platform,
        codeChallenge,
        validatedRedirectTo,
        undefined,
        isNy,
        invitationId,
        enterpriseLogin,
      );

      await pkceServiceV2.storeVerifier(state, codeVerifier);

      const redirectUri = this.getGoogleRedirectUri(req);

      logger.info('[OAuth] Redirect URI:', redirectUri);

      const authUrl = this.getGoogleClient(isNy).generateAuthUrl({
        access_type: 'offline',
        scope: ['openid', 'email', 'profile'],
        prompt: 'consent',
        redirect_uri: redirectUri,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: CodeChallengeMethod.S256,
      });

      // sameSite=lax so the cookie survives Google's top-level callback redirect.
      const isProduction = process.env.NODE_ENV === 'production';
      res.cookie('oauth_state', state, {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'lax' as const,
        maxAge: 10 * 60 * 1000,
        path: '/',
      });

      logger.info(`[${requestId}] Redirecting to Google OAuth`);
      res.redirect(authUrl);
    } catch (error) {
      logger.error(`[${requestId}] Error initiating login:`, error);

      const frontendUrl = getFrontendUrl(req);
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
        const frontendUrl = getFrontendUrl(req);
        res.redirect(
          `${frontendUrl}?error=oauth_error&message=${encodeURIComponent(error as string)}`
        );
        return;
      }

      if (!code || !state) {
        logger.error(`[${requestId}] Missing code or state`);
        const frontendUrl = getFrontendUrl(req);
        res.redirect(
          `${frontendUrl}?error=missing_params&message=${encodeURIComponent('Missing authorization code or state')}`
        );
        return;
      }

      const isCodeUsed = await oauthStateServiceV2.isCodeUsed(code as string);
      if (isCodeUsed) {
        logger.error(`[${requestId}] Authorization code already used`);
        const frontendUrl = getFrontendUrl(req);
        res.redirect(
          `${frontendUrl}?error=code_reused&message=${encodeURIComponent('Authorization code already used')}`
        );
        return;
      }

      const stateData = await oauthStateServiceV2.validateState(state as string, false);
      if (!stateData) {
        logger.error(`[${requestId}] Invalid or expired state`);
        const frontendUrl = getFrontendUrl(req);
        res.redirect(
          `${frontendUrl}?error=invalid_state&message=${encodeURIComponent('Invalid or expired state')}`
        );
        return;
      }

      // For Electron: always relay code+state back to the Electron app without consuming the state,
      // PKCE verifier, or auth code. The actual token exchange (and invitation handling) happens
      // in exchangeElectronCode so the accept-invitation UI runs inside Electron, not the browser.
      if (stateData.platform === 'electron') {
        const frontendUrl = stateData.redirectTo ?? getFrontendUrl(req);
        const launchParams = new URLSearchParams({
          code: code as string,
          state: state as string,
        });
        if (stateData.invitationId) {
          launchParams.set('invitationId', stateData.invitationId);
        }
        const launchUrl = `${frontendUrl}/launch?${launchParams.toString()}`;
        logger.info(`[${requestId}] Redirecting to Frontend launch page: ${launchUrl}`);
        res.redirect(launchUrl);
        return;
      }

      // The state must match the oauth_state cookie; reject when absent or different. The
      // cookie is single-use and cleared here regardless of outcome. Checked only on the
      // browser-driven path: desktop returns above, and the cookie is host-only.
      const boundState = req.cookies?.oauth_state as string | undefined;
      res.clearCookie('oauth_state', { path: '/' });
      if (!boundState || boundState !== state) {
        logger.error(`[${requestId}] OAuth state cookie missing or mismatched — rejecting`);
        const frontendUrl = getFrontendUrl(req);
        res.redirect(
          `${frontendUrl}?error=invalid_state&message=${encodeURIComponent('Invalid or expired state')}`
        );
        return;
      }

      await oauthStateServiceV2.deleteState(state as string);

      const codeVerifier = await pkceServiceV2.getAndDeleteVerifier(state as string);
      if (!codeVerifier) {
        logger.error(`[${requestId}] PKCE verifier not found`);
        const frontendUrl = getFrontendUrl(req);
        res.redirect(
          `${frontendUrl}?error=pkce_failed&message=${encodeURIComponent('PKCE verification failed')}`
        );
        return;
      }

      await oauthStateServiceV2.markCodeAsUsed(code as string);

      const redirectUri = this.getGoogleRedirectUri(req);

      logger.info('[OAuth] Redirect URI:', redirectUri);

      logger.info(`[${requestId}] Exchanging code for tokens`);
      const { tokens } = await this.getGoogleClient(stateData.isNy).getToken({
        code: code as string,
        redirect_uri: redirectUri,
        codeVerifier: codeVerifier,
      });

      const { id_token, refresh_token, access_token } = tokens;
      const accessTokenExpiry = tokens.expiry_date ? new Date(tokens.expiry_date) : undefined;

      if (!id_token) {
        logger.error(`[${requestId}] No ID token received`);
        const frontendUrl = getFrontendUrl(req);
        res.redirect(
          `${frontendUrl}?error=no_id_token&message=${encodeURIComponent('No ID token received')}`
        );
        return;
      }

      logger.info(`[${requestId}] Verifying ID token`);
      const ticket = await this.getGoogleClient(stateData.isNy).verifyIdToken({
        idToken: id_token,
        audience: stateData.isNy ? process.env.GOOGLE_CLIENT_ID_NEW : process.env.GOOGLE_CLIENT_ID,
      });

      const payload = ticket.getPayload();
      if (!payload) {
        logger.error(`[${requestId}] Invalid token payload`);
        const frontendUrl = getFrontendUrl(req);
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

      await migrateLegacyIdentity({
        email: googleUserData.email,
        authProvider: AuthProvider.GOOGLE,
        providerUserId: googleUserData.googleId,
      });

      // SECURITY: reject provider mismatch before issuing any pending-auth cookie
      // or touching workspace state. Account linking is intentionally NOT done here
      // (it enables account takeover). If an account already exists for this email
      // under a different login method (providerUserId differs — e.g. Microsoft or a
      // different Google account), stop and tell the UI to use the original method.
      const existingIdentity = await this.userService.findAuthIdentityByEmail(googleUserData.email);
      if (existingIdentity && existingIdentity.providerUserId !== googleUserData.googleId) {
        logger.warn(
          `[${requestId}] Provider mismatch for ${googleUserData.email}: account registered with ${existingIdentity.authProvider}, attempted login with GOOGLE`,
        );
        const frontendUrl = stateData.redirectTo ?? getFrontendUrl(req);
        const params = new URLSearchParams({
          error: 'provider_mismatch',
          message: 'This account uses a different login method. Please continue with your original sign-in method.',
          existingProvider: existingIdentity.authProvider,
        });
        res.redirect(`${frontendUrl}?${params.toString()}`);
        return;
      }

      const workspaces = this.getEnterpriseAwareWorkspaces(
        await this.userService.getWorkspacesByEmail(googleUserData.email),
        stateData.enterpriseLogin,
      );
      logger.info(`[${requestId}] [DEBUG] User has ${workspaces.length} workspace(s) before invitation check`);

      // Check for pending invitation from cookie (web) or OAuth state (electron/mobile)
      const cookieInvitationId = req.cookies?.pending_invitation_id as string | undefined;
      const stateInvitationId = stateData.invitationId;
      
      // At this point platform is always 'web' | 'mobile' (electron is handled above and returns early).
      // Prefer cookie (set by the browser invite redirect) but fall back to state (set by mobile/other flows).
      const pendingInvitationId = cookieInvitationId || stateInvitationId;
      
      const userExistsButRemoved = await this.userService.userExistsButNoActiveWorkspaces(googleUserData.email);

      let domainConflict = null;
      let domainConflictError = null;
      let publicEmailError = null;

      if (workspaces.length === 0 && !userExistsButRemoved) {
        if (stateData.enterpriseLogin) {
          try {
            await organizationDomainService.assertCanCreateOrgForEmail(googleUserData.email);
          } catch (error) {
            if (error instanceof PublicEmailDomainError) {
              publicEmailError = error;
            } else if (error instanceof OrganizationDomainConflictError) {
              domainConflictError = error;
            }
          }
        }

        if (!domainConflictError && !publicEmailError) {
          domainConflict = await organizationDomainService.findEnterpriseWorkspaceByEmailDomain(googleUserData.email);
          domainConflictError = domainConflict
            ? new OrganizationDomainConflictError(domainConflict.domain, domainConflict)
            : null;
        }
      }

      const isProduction = process.env.NODE_ENV === 'production';
      const tokenKey = await this.storePendingOAuthTokens(
        refresh_token,
        access_token,
        accessTokenExpiry,
      );
      res.cookie('google_access_token', jwt.sign({
        googleId: googleUserData.googleId,
        email: googleUserData.email,
        name: googleUserData.name,
        picture: googleUserData.picture,
        provider: AuthProvider.GOOGLE,
        tokenKey,
      }, process.env.JWT_SECRET!, { expiresIn: '10m' }), {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'strict' as const,
        path: '/',
        maxAge: 10 * 60 * 1000, // 10 minutes pending auth window
      });

      const frontendUrl = stateData.redirectTo ?? getFrontendUrl(req);

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

      /**
       * AUTO-LOGIN SINGLE WORKSPACE USERS
       * SHOULD REMOVE AS ITS FALLBACK FOR OLD DASHBOARD, AND NEW USERS SHOULD EXPECT TO SELECT WORKSPACE ON FIRST LOGIN
       * Users with exactly 1 workspace get auto-logged in (good UX).
       * Works for both old dashboards and new users with single workspace.
       */
      if (workspaces.length === 1) {
        const workspaceId = workspaces[0]!.id;
        logger.info(`[${requestId}] Single workspace detected - auto-logging in to ${workspaceId}`);

        const { sessionId, jwtToken, isNewUser } = await this.performSingleWorkspaceAutoLogin(
          googleUserData,
          workspaceId,
          refresh_token,
          access_token,
          req,
          'web'
        );

        // Set workspace cookies
        // NOTE: sameSite must be 'lax' (not 'strict') for OAuth callback
        // because the redirect comes from Google (cross-site navigation)
        const cookieBase = {
          httpOnly: true,
          secure: isProduction,
          sameSite: 'lax' as const,
          path: '/',
        };

        res.cookie('xyne_last_workspace', workspaceId, {
          ...cookieBase,
          maxAge: 30 * 24 * 60 * 60 * 1000,
        });

        res.cookie(`xyne_ws_${workspaceId}_token`, jwtToken, {
          ...cookieBase,
          maxAge: 24 * 60 * 60 * 1000,
        });

        setOnboardingCookie(res, isNewUser, {
          secure: isProduction,
          sameSite: 'lax' as const,
        });

        // Legacy cookie for backward compatibility with older dashboards
        res.cookie('user_session_id', sessionId, {
          ...cookieBase,
          maxAge: config.session.expiryDays * 24 * 60 * 60 * 1000,
        });


        logger.info(`[${requestId}] Auto-login complete - redirecting to dashboard with cookies`);
        logger.info(`[${requestId}] Cookies set: xyne_last_workspace=${workspaceId}, xyne_ws_${workspaceId}_token=<JWT>`);

        // Include user data and autoLoginWorkspace in redirect
        // Frontend will call loginWorkspace which will find the session from cookies
        const autoLoginParams = new URLSearchParams({
          success: 'true',
          email: googleUserData.email,
          name: googleUserData.name,
          picture: googleUserData.picture || '',
          autoLoginWorkspace: workspaceId,
          userExistsButRemoved: String(userExistsButRemoved),
        });
        res.redirect(`${frontendUrl}?${autoLoginParams.toString()}`);
        return;
      }

      logger.info(`[${requestId}] Multiple workspaces (${workspaces.length}) detected - redirecting to workspace selection`);

      // Redirect with workspaces (frontend will select workspace)
      const params = new URLSearchParams({
        success: 'true',
        email: googleUserData.email,
        name: googleUserData.name,
        picture: googleUserData.picture || '',
        workspaces: JSON.stringify(workspaces),
        userExistsButRemoved: String(userExistsButRemoved),
      });
      if (domainConflictError && domainConflict) {
        params.set('domainConflictError', domainConflictError.message);
        params.set('enterpriseJoinOrgName', domainConflict.name);
        params.set('enterpriseJoinWorkspaces', JSON.stringify(domainConflict.workspaces));
      }
      if (publicEmailError) {
        params.set('publicEmailDomainError', publicEmailError.message);
      }

      res.redirect(`${frontendUrl}?${params.toString()}`);
      return;
    } catch (error) {
      logger.error(`[${requestId}] Callback error:`, error);

      const frontendUrl = getFrontendUrl(req);
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
      const sessionId = req.cookies?.user_session_id;

      if (!sessionId) {
        logger.warn(`[${requestId}] No session ID cookie found`);
        res.status(401).json({
          error: 'No session found',
          message: 'Session ID cookie is missing',
        });
        return;
      }

      logger.info(`[${requestId}] Found session ID`);

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

      const { code, state, invitationId } = req.body;

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

      const redirectUri = this.getGoogleRedirectUri(req);

      logger.info('[OAuth] Redirect URI:', redirectUri);

      logger.info(`[${requestId}] Exchanging code for tokens`);
      const { tokens } = await this.getGoogleClient(stateData.isNy).getToken({
        code,
        redirect_uri: redirectUri,
        codeVerifier: codeVerifier,
      });

      const { id_token, refresh_token, access_token } = tokens;
      const accessTokenExpiry = tokens.expiry_date ? new Date(tokens.expiry_date) : undefined;

      if (!id_token) {
        logger.error(`[${requestId}] No ID token received`);
        res.status(500).json({
          error: 'No ID token',
          message: 'Google did not return an ID token',
        });
        return;
      }

      logger.info(`[${requestId}] Verifying ID token`);
      const ticket = await this.getGoogleClient(stateData.isNy).verifyIdToken({
        idToken: id_token,
        audience: stateData.isNy ? process.env.GOOGLE_CLIENT_ID_NEW : process.env.GOOGLE_CLIENT_ID,
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

      await migrateLegacyIdentity({
        email: googleUserData.email,
        authProvider: AuthProvider.GOOGLE,
        providerUserId: googleUserData.googleId,
      });

      // SECURITY: reject provider mismatch before issuing any pending-auth cookie
      // or touching workspace state. Account linking is intentionally not done here
      // (it enables account takeover). Mirrors the web callback + Microsoft/email.
      const existingIdentity = await this.userService.findAuthIdentityByEmail(googleUserData.email);
      if (existingIdentity && existingIdentity.providerUserId !== googleUserData.googleId) {
        logger.warn(
          `[${requestId}] Provider mismatch for ${googleUserData.email}: account registered with ${existingIdentity.authProvider}, attempted login with GOOGLE`,
        );
        res.status(403).json({
          success: false,
          error: 'provider_mismatch',
          message: 'This account uses a different login method. Please continue with your original sign-in method.',
          existingProvider: existingIdentity.authProvider,
        });
        return;
      }

      logger.info(`[${requestId}] Getting workspaces for: ${googleUserData.email}`);
      const workspaces = this.getEnterpriseAwareWorkspaces(
        await this.userService.getWorkspacesByEmail(googleUserData.email),
        stateData.enterpriseLogin,
      );
      const userExistsButRemoved = await this.userService.userExistsButNoActiveWorkspaces(googleUserData.email);

      const isProduction = process.env.NODE_ENV === 'production';

      // If an invitation is pending: set google_access_token so the Electron renderer can later
      // call acceptInvitation + loginWorkspace, then return a hasInvitation signal. The renderer
      // will navigate to /invite?loginComplete=true inside the app — no browser involvement.
      const effectiveInvitationId = stateData.invitationId || invitationId;
      if (effectiveInvitationId) {
        logger.info(`[${requestId}] Invitation detected (${effectiveInvitationId}) — returning hasInvitation signal to Electron`);
        const tokenKey = await this.storePendingOAuthTokens(
          refresh_token,
          access_token,
          accessTokenExpiry,
        );
        res.cookie('google_access_token', jwt.sign({
          googleId: googleUserData.googleId,
          email: googleUserData.email,
          name: googleUserData.name,
          picture: googleUserData.picture,
          provider: AuthProvider.GOOGLE,
          tokenKey,
        }, process.env.JWT_SECRET!, { expiresIn: '10m' }), {
          httpOnly: true,
          secure: isProduction,
          sameSite: 'strict' as const,
          path: '/',
          maxAge: 10 * 60 * 1000,
        });
        res.status(200).json({
          success: true,
          hasInvitation: true,
          invitationId: effectiveInvitationId,
          loggedInEmail: googleUserData.email,
          email: googleUserData.email,
          name: googleUserData.name,
          picture: googleUserData.picture,
        });
        return;
      }

      /**
       * AUTO-LOGIN SINGLE WORKSPACE USERS (Electron)
       * Mirrors web and mobile behavior exactly - auto-login when user has exactly 1 workspace
       */
      if (workspaces.length === 1) {
        const workspaceId = workspaces[0]!.id;
        logger.info(`[${requestId}] Single workspace detected - auto-logging in to ${workspaceId}`);

        const { sessionId, jwtToken, isNewUser } = await this.performSingleWorkspaceAutoLogin(
          googleUserData,
          workspaceId,
          refresh_token,
          access_token,
          req,
          'electron'
        );

        // Set workspace cookies using electron cookie options
        const cookieBase = {
          httpOnly: true,
          secure: isProduction,
          sameSite: 'strict' as const,
          path: '/',
        };

        res.cookie('xyne_last_workspace', workspaceId, {
          ...cookieBase,
          maxAge: 30 * 24 * 60 * 60 * 1000,
        });

        res.cookie(`xyne_ws_${workspaceId}_token`, jwtToken, {
          ...cookieBase,
          maxAge: 24 * 60 * 60 * 1000,
        });

        setOnboardingCookie(res, isNewUser, {
          secure: isProduction,
          sameSite: 'strict' as const,
        });

        res.cookie('user_session_id', sessionId, {
          ...cookieBase,
          maxAge: config.session.expiryDays * 24 * 60 * 60 * 1000,
        });

        logger.info(`[${requestId}] Electron auto-login complete - cookies set: user_session_id`);

        // Return JSON with workspaces (Electron expects this for renderer to handle)
        res.status(200).json({
          success: true,
          email: googleUserData.email,
          name: googleUserData.name,
          picture: googleUserData.picture,
          workspaces,
          userExistsButRemoved,
        });
        return;
      }

      // Store pending auth data for later loginWorkspace/createOrg call (multi-workspace case)
      const tokenKey = await this.storePendingOAuthTokens(
        refresh_token,
        access_token,
        accessTokenExpiry,
      );
      res.cookie('google_access_token', jwt.sign({
        googleId: googleUserData.googleId,
        email: googleUserData.email,
        name: googleUserData.name,
        picture: googleUserData.picture,
        provider: AuthProvider.GOOGLE,
        tokenKey,
      }, process.env.JWT_SECRET!, { expiresIn: '10m' }), {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'strict' as const,
        path: '/',
        maxAge: 10 * 60 * 1000, // 10 minutes pending auth window
      });

      logger.info(`[${requestId}] Electron code exchange successful (multi-workspace or new user)`);
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
    const frontendUrl = getFrontendUrl(req);

    // Select the native branch via the `x-platform` header. `?platform=mobile` is kept for
    // older mobile builds, but only when the request carries no browser cross-site markers;
    // otherwise it is treated as a web request and must pass state + PKCE.
    const secFetchSite = req.headers['sec-fetch-site'];
    const looksBrowserInitiated =
      !!req.headers.origin ||
      (typeof secFetchSite === 'string' && secFetchSite !== 'none');
    const nativeByHeader = req.headers['x-platform'] === 'mobile';
    const nativeByQuery = req.query.platform === 'mobile' && !looksBrowserInitiated;
    if (req.query.platform === 'mobile' && !nativeByHeader) {
      logger.warn(
        `[${requestId}] mobile-exchange selected via query parameter without the x-platform header (browserInitiated=${looksBrowserInitiated})`,
      );
    }
    // The native branch is only selectable by a genuine native client, which sends neither
    // Origin nor Sec-Fetch-Site. Anything browser-initiated takes the web branch.
    const isMobileNative = (nativeByHeader || nativeByQuery) && !looksBrowserInitiated;
    if ((nativeByHeader || nativeByQuery) && looksBrowserInitiated) {
      logger.warn(
        `[${requestId}] native mobile-exchange requested from a browser-initiated request; falling back to the web branch`,
      );
    }

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

      // Native does PKCE inside the Google SDK, so only the web branch verifies it server-side.
      let codeVerifier: string | undefined;
      if (!isMobileNative) {
        const state = (req.query.state || req.body?.state) as string | undefined;
        if (!state) {
          logger.error(`[${requestId}] Missing state on web mobile-exchange`);
          sendError('missing_params', 'Missing state');
          return;
        }
        const stateData = await oauthStateServiceV2.validateState(state, false);
        if (!stateData) {
          logger.error(`[${requestId}] Invalid or expired state`);
          sendError('invalid_state', 'Invalid or expired state');
          return;
        }
        await oauthStateServiceV2.deleteState(state);
        codeVerifier = (await pkceServiceV2.getAndDeleteVerifier(state)) ?? undefined;
        if (!codeVerifier) {
          logger.error(`[${requestId}] PKCE verifier not found`);
          sendError('pkce_failed', 'PKCE verification failed');
          return;
        }
      }

      await oauthStateServiceV2.markCodeAsUsed(code as string);

      // For mobile native apps using serverAuthCode, use empty string as redirect_uri
      // For web OAuth flow, use the backend callback URL
      const redirectUri = isMobileNative ? '' : this.getGoogleRedirectUri(req);

      logger.info('[OAuth] Redirect URI:', redirectUri);

      logger.info(`[${requestId}] Exchanging code for tokens`);
      const { tokens } = await this.mobileGoogleClient.getToken({
        code: code as string,
        redirect_uri: redirectUri,
        ...(codeVerifier ? { codeVerifier } : {}),
      });

      const { id_token, refresh_token, access_token } = tokens;
      const accessTokenExpiry = tokens.expiry_date ? new Date(tokens.expiry_date) : undefined;

      if (!id_token) {
        logger.error(`[${requestId}] No ID token received`);
        sendError('no_id_token', 'No ID token received', 500);
        return;
      }

      logger.info(`[${requestId}] Verifying ID token`);
      const ticket = await this.mobileGoogleClient.verifyIdToken({
        idToken: id_token,
        // Accept both web and iOS client IDs
        audience: [process.env.GOOGLE_MOBILE_CLIENT_ID!, process.env.GOOGLE_IOS_CLIENT_ID!].filter(
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

      await migrateLegacyIdentity({
        email: googleUserData.email,
        authProvider: AuthProvider.GOOGLE,
        providerUserId: googleUserData.googleId,
      });

      // SECURITY: reject provider mismatch before issuing any pending-auth cookie
      // or touching workspace state. Account linking is intentionally not done here
      // (it enables account takeover). Mirrors the web callback + Microsoft/email.
      const existingIdentity = await this.userService.findAuthIdentityByEmail(googleUserData.email);
      if (existingIdentity && existingIdentity.providerUserId !== googleUserData.googleId) {
        logger.warn(
          `[${requestId}] Provider mismatch for ${googleUserData.email}: account registered with ${existingIdentity.authProvider}, attempted login with GOOGLE`,
        );
        sendError(
          'provider_mismatch',
          'This account uses a different login method. Please continue with your original sign-in method.',
          403,
        );
        return;
      }

      const workspaces = await this.userService.getWorkspacesByEmail(googleUserData.email);
      const userExistsButRemoved = await this.userService.userExistsButNoActiveWorkspaces(googleUserData.email);

      const isProduction = process.env.NODE_ENV === 'production';
      const cookieOptions = {
        httpOnly: true,
        secure: isProduction || isMobileNative, // Must be secure for sameSite: 'none'
        sameSite: (isMobileNative ? 'none' : 'strict') as 'none' | 'strict',
        path: '/',
        maxAge: 10 * 60 * 1000, // 10 minutes
      };

      // Keep provider tokens in Redis; the cookie contains only the lookup key.
      const tokenKey = await this.storePendingOAuthTokens(
        refresh_token,
        access_token,
        accessTokenExpiry,
      );
      res.cookie('google_access_token', jwt.sign({
        googleId: googleUserData.googleId,
        email: googleUserData.email,
        name: googleUserData.name,
        picture: googleUserData.picture,
        provider: AuthProvider.GOOGLE,
        tokenKey,
      }, process.env.JWT_SECRET!, { expiresIn: '10m' }), cookieOptions);
      logger.info(`[${requestId}] Stored pending auth data for workspace selection`);

      /**
       * AUTO-LOGIN SINGLE WORKSPACE USERS (Mobile)
       * Mirrors web behavior exactly - auto-login when user has exactly 1 workspace
       */
      if (isMobileNative && workspaces.length === 1) {
        const workspaceId = workspaces[0]!.id;
        logger.info(`[${requestId}] Single workspace detected - auto-logging in to ${workspaceId}`);

        const { workspaceUser, sessionId, jwtToken, isNewUser } = await this.performSingleWorkspaceAutoLogin(
          googleUserData,
          workspaceId,
          refresh_token,
          access_token,
          req,
          'mobile'
        );

        // Set workspace cookies using mobile cookie options
        const cookieBase = {
          httpOnly: true,
          secure: isProduction || isMobileNative,
          sameSite: (isMobileNative ? 'none' : 'lax') as 'none' | 'lax',
          path: '/',
        };

        res.cookie('xyne_last_workspace', workspaceId, {
          ...cookieBase,
          maxAge: 30 * 24 * 60 * 60 * 1000,
        });

        res.cookie(`xyne_ws_${workspaceId}_token`, jwtToken, {
          ...cookieBase,
          maxAge: 24 * 60 * 60 * 1000,
        });

        setOnboardingCookie(res, isNewUser, {
          secure: isProduction || isMobileNative,
          sameSite: (isMobileNative ? 'none' : 'lax') as 'none' | 'lax',
        });

        if (sessionId) {
          res.cookie('user_session_id', sessionId, {
            ...cookieBase,
            maxAge: config.session.expiryDays * 24 * 60 * 60 * 1000,
          });
        }

        logger.info(`[${requestId}] Mobile auto-login complete - cookies set: user_session_id`);

        // Return JSON instead of redirect (mobile expects this)
        res.status(200).json({
          success: true,
          sessionId,
          userId: workspaceUser.id,
          email: googleUserData.email,
          name: googleUserData.name,
          picture: googleUserData.picture,
          workspaces,
          userExistsButRemoved,
        });
        return;
      }

      if (isMobileNative) {
        logger.info(`[${requestId}] Mobile auth successful for: ${googleUserData.email}`);
        res.status(200).json({
          success: true,
          email: googleUserData.email,
          name: googleUserData.name,
          picture: googleUserData.picture,
          workspaces,
          userExistsButRemoved,
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
      const sessionId = req.cookies?.user_session_id;
      
      if (sessionId) {
        logger.info(`[${requestId}] Revoking session for user ${req.user?.email}`);
        await this.userSessionService.revokeSession(sessionId);
      }

      if (req.user && sessionId) {
        await getEncryptionProvider().revokeSessionKey(sessionId);
      }

      // Clear global session cookie
      res.clearCookie('user_session_id', { path: '/' });
      
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

      const frontendUrl = getFrontendUrl(req);
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
        const frontendUrl = getFrontendUrl(req);
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

      // Get pending auth data from cookie (for normal OAuth flow)
      const pendingAuthCookie = req.cookies?.google_access_token;
      const existingSessionId = req.cookies?.user_session_id;
      
      let oauthUserData: { email: string; name: string; googleId?: string; providerUserId?: string; picture?: string };
      let provider: string;
      let pendingRefreshToken: string | undefined;
      let pendingAccessToken: string | undefined;
      let pendingAccessTokenExpiry: Date | undefined;
      let pendingTokenKey: string | undefined;

      if (pendingAuthCookie) {
        const parsed = await this.parsePendingAuthCookie(pendingAuthCookie);
        if (!parsed) {
          res.status(401).json({
            error: 'Invalid auth data',
            message: 'Pending auth data is corrupted or expired'
          });
          return;
        }

        const hasProviderIdentity = !!(parsed.oauthUserData.providerUserId || parsed.oauthUserData.googleId);
        if (hasProviderIdentity) {
          oauthUserData = parsed.oauthUserData;
          provider = parsed.provider;
          pendingRefreshToken = parsed.pendingRefreshToken;
          pendingAccessToken = parsed.pendingAccessToken;
          pendingAccessTokenExpiry = parsed.pendingAccessTokenExpiry;
          pendingTokenKey = parsed.pendingTokenKey;
        } else {
          res.status(401).json({
            error: 'Invalid auth data',
            message: 'Pending auth data is missing provider identity'
          });
          return;
        }
      } else if (existingSessionId) {
        /**
         * AUTO-LOGIN FLOW: Use existing session (cookies already set)
         * This happens when user is auto-logged in to single workspace
         */
        logger.info(`[LOGIN-WORKSPACE] No pending auth cookie, but session ${existingSessionId} found - using auto-login flow`);
        
        const session = await this.userSessionService.getSessionById(existingSessionId);
        if (!session || !session.user || session.status !== 'ACTIVE' || new Date() > session.refreshTokenExpiry) {
          res.status(401).json({
            error: 'Invalid session',
            message: 'Session not found or expired'
          });
          return;
        }
        
        oauthUserData = {
          email: session.user.email,
          name: session.user.name || '',
          providerUserId: session.user.providerUserId,
          picture: session.user.picture || undefined,
        };
        provider = session.user.authProvider || 'GOOGLE';
        pendingRefreshToken = session.refreshToken;
        pendingAccessToken = session.accessToken || undefined;
        pendingAccessTokenExpiry = session.accessTokenExpiry || undefined;
      } else {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Pending auth data not found or expired'
        });
        return;
      }

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
        providerUserId: (oauthUserData.providerUserId || oauthUserData.googleId)!,
        email: oauthUserData.email,
        name: oauthUserData.name,
        picture: oauthUserData.picture,
        workspaceId,
        authProvider: provider,
      });

      // Check if user is inactive or has left the workspace
      if (workspaceUser.status === UserStatus.INACTIVE || workspaceUser.leftAt !== null) {
        res.status(403).json({
          error: 'User inactive',
          message: 'Your account has been deactivated or you have left this workspace'
        });
        return;
      }

      // Ensure user presence for workspace-scoped user
      await this.userService.ensureUserPresence(workspaceUser.id, workspaceId);
      const selfDmChannelId = await this.ensureSelfDmForUser(workspaceUser.id, workspaceId);

      const workspace = await this.prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { landingChannelId: true },
      });

      let sessionId = null;

      const isEmailProvider = provider === AuthProvider.EMAIL;
      const sessionRefreshToken = pendingRefreshToken ?? (isEmailProvider ? randomUUID() : undefined);

      if (sessionRefreshToken) {
        try {
          const refreshTokenExpiry = new Date();
          refreshTokenExpiry.setDate(refreshTokenExpiry.getDate() + 30);


          const deviceInfo = JSON.stringify({
            userAgent: req.headers['user-agent'],
            acceptLanguage: req.headers['accept-language'],
            timestamp: new Date().toISOString(),
            appVersion: req.headers['x-app-version'],
          });

          const session = await this.userSessionService.createSession({
            userId: workspaceUser.id,
            refreshToken: sessionRefreshToken,
            refreshTokenExpiry,
            accessToken: pendingAccessToken,
            accessTokenExpiry: pendingAccessTokenExpiry,
            deviceInfo,
            ipAddress: req.ip || req.connection.remoteAddress || undefined,
          });

          sessionId = session.id;
          logger.info(`[LOGIN-WORKSPACE] Session created${isEmailProvider ? ' (email provider — generated refresh token)' : ''}`);
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
        res.cookie('user_session_id', sessionId, {
          ...cookieOptions,
          maxAge: config.session.expiryDays * 24 * 60 * 60 * 1000,
        });
      }

      setOnboardingCookie(res, isNewUser, {
        secure: isProduction,
        sameSite: 'strict' as const,
      });
      if (isNewUser) {
        logger.info(`[LOGIN-WORKSPACE] Set is_new_user cookie for new user: ${workspaceUser.email}`);
      }

      const orgRole = workspaceUser.orgMemberId
        ? (await this.userService.getOrgRole(workspaceUser.orgMemberId)) ?? ''
        : '';

      // Clear pending auth cookie and return success
      if (pendingTokenKey) {
        await redisService.del(
          `${config.pendingOAuthTokens.redisKeyPrefix}${pendingTokenKey}`,
        );
      }
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
        selfDmChannelId,
        landingChannelId: workspace?.landingChannelId ?? null,
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

      const parsedAuth = await this.parsePendingAuthCookie(pendingAuthCookie);
      if (!parsedAuth) {
        res.status(401).json({
          error: 'Invalid auth data',
          message: 'Pending auth data is corrupted or expired'
        });
        return;
      }
      const { oauthUserData, provider, pendingRefreshToken, pendingTokenKey } = parsedAuth;

      if (!oauthUserData?.email) {
        res.status(401).json({
          error: 'Invalid auth data',
          message: 'User data missing from pending auth'
        });
        return;
      }

      logger.info(`[CREATE-ORG] User ${oauthUserData.email} creating org "${orgName}" with workspace "${workspaceName}" via ${provider}`);

      const userData = {
        providerUserId: (oauthUserData.providerUserId || oauthUserData.googleId)!,
        email: oauthUserData.email,
        name: oauthUserData.name,
        picture: oauthUserData.picture,
      };

      const { organization, workspace, workspaceUser, isNewUser } = await this.userService.createOrganizationWithUser(
        userData,
        orgName,
        workspaceName,
        provider
      );

      // Check if user is inactive or has left the workspace
      if (workspaceUser.status === UserStatus.INACTIVE || workspaceUser.leftAt !== null) {
        res.status(403).json({
          error: 'User inactive',
          message: 'Your account has been deactivated or you have left this workspace'
        });
        return;
      }

      // Ensure user presence for workspace-scoped user
      await this.userService.ensureUserPresence(workspaceUser.id, workspace.id);
      const selfDmChannelId = await this.ensureSelfDmForUser(workspaceUser.id, workspace.id);

      const workspaceRecord = await this.prisma.workspace.findUnique({
        where: { id: workspace.id },
        select: { landingChannelId: true },
      });

      let sessionId = null;

      if (pendingRefreshToken) {
        try {
          const refreshTokenExpiry = new Date();
          refreshTokenExpiry.setDate(refreshTokenExpiry.getDate() + 30);

          const deviceInfo = JSON.stringify({
            userAgent: req.headers['user-agent'],
            acceptLanguage: req.headers['accept-language'],
            timestamp: new Date().toISOString(),
            appVersion: req.headers['x-app-version'],
          });

          const session = await this.userSessionService.createSession({
            userId: workspaceUser.id,
            refreshToken: pendingRefreshToken,
            refreshTokenExpiry,
            deviceInfo,
            ipAddress: req.ip || req.connection.remoteAddress || undefined,
          });

          sessionId = session.id;
          logger.info(`[CREATE-ORG] Session created`);
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
        res.cookie('user_session_id', sessionId, {
          ...cookieOptions,
          maxAge: config.session.expiryDays * 24 * 60 * 60 * 1000, // 30 days
        });
      }
      
      // Set last workspace pointer
      res.cookie('xyne_last_workspace', targetWorkspaceId, {
        ...cookieOptions,
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      });

      setOnboardingCookie(res, isNewUser, {
        secure: isProduction,
        sameSite: 'strict' as const,
        maxAge: 24 * 60 * 60 * 1000,
      });

      // Clear pending auth cookie
      if (pendingTokenKey) {
        await redisService.del(
          `${config.pendingOAuthTokens.redisKeyPrefix}${pendingTokenKey}`,
        );
      }
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
        isNewUser,
        selfDmChannelId,
        landingChannelId: workspaceRecord?.landingChannelId ?? null,
      });

    } catch (error) {
      logger.error('Error creating organization:', error);
      if (isOrganizationPolicyError(error)) {
        res.status(error.statusCode).json({
          error: error.message,
          code: error.code,
          ...(error instanceof Error && 'domain' in error ? { domain: error.domain } : {}),
          ...(error instanceof Error && 'existingOrg' in error ? { existingOrg: error.existingOrg } : {}),
        });
        return;
      }

      const statusCode = (error as Error & { statusCode?: number }).statusCode;
      if (statusCode) {
        res.status(statusCode).json({
          error: 'Failed to create organization',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
        return;
      }

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

      // Switching workspaces is inherently cross-tenant: everything below acts on the
      // TARGET workspace while the ambient session context is still the caller's current
      // (old) one — the per-model ACLs' "must match your current workspace" rule can never
      // be satisfied by definition. Safe to bypass because every lookup here is keyed off
      // `currentUser.email` (the caller's own verified session), never attacker-supplied —
      // this can only ever act on the caller's own identity in the target workspace.
      await runAsSystem(async () => {
        // Find the User record scoped to the target workspace
        const targetUser = await this.userService.findUserByEmail(currentUser.email, workspaceId);
        if (!targetUser) {
          res.status(403).json({
            error: 'Forbidden',
            message: 'You do not have access to this workspace',
          });
          return;
        }

        await this.userService.ensureUserPresence(targetUser.id, workspaceId);
        const selfDmChannelId = await this.ensureSelfDmForUser(targetUser.id, workspaceId);

        const workspace = await this.prisma.workspace.findUnique({
          where: { id: workspaceId },
          select: { landingChannelId: true },
        });

        // Get existing session from global session cookie
        // We reuse the same session across workspaces (session belongs to user, not workspace)
        const sessionId = req.cookies?.user_session_id;

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
          res.cookie('user_session_id', validSessionId, { ...cookieBase, maxAge: 30 * 24 * 60 * 60 * 1000 });
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
          selfDmChannelId,
          landingChannelId: workspace?.landingChannelId ?? null,
        });
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
   * Create a new workspace in an existing org via pending auth cookie (like create-org).
   * POST /api/auth/create-workspace-pending
   */
  createWorkspaceWithPendingAuth = async (req: Request, res: Response): Promise<void> => {
    try {
      const pendingAuthCookie = req.cookies?.google_access_token;
      if (!pendingAuthCookie) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Pending auth data not found or expired'
        });
        return;
      }

      const parsedAuth = await this.parsePendingAuthCookie(pendingAuthCookie);
      if (!parsedAuth) {
        res.status(401).json({
          error: 'Invalid auth data',
          message: 'Pending auth data is corrupted or expired'
        });
        return;
      }
      const { oauthUserData, provider, pendingRefreshToken, pendingTokenKey } = parsedAuth;
        if (!oauthUserData?.email) {
          res.status(401).json({
            error: 'Invalid auth data',
            message: 'User data missing from pending auth'
          });
          return;
        }

        const { workspaceName, workspaceType, joinPolicy } = req.body as {
          workspaceName?: string;
          workspaceType?: string;
          joinPolicy?: string;
        };

        if (!workspaceName) {
          res.status(400).json({ error: 'Missing required fields', message: 'workspaceName is required' });
          return;
        }
        if (
          workspaceType &&
          workspaceType !== WorkspaceType.ENTERPRISE &&
          workspaceType !== WorkspaceType.COMMUNITY
        ) {
          res.status(400).json({ error: 'Invalid workspace type', message: 'workspaceType must be ENTERPRISE or COMMUNITY' });
          return;
        }
        if (joinPolicy && !Object.values(WorkspaceJoinPolicy).includes(joinPolicy as WorkspaceJoinPolicyValue)) {
          res.status(400).json({ error: 'Invalid join policy', message: 'joinPolicy must be INVITE_ONLY, OPEN, or REQUEST_TO_JOIN' });
          return;
        }

        logger.info(`[CREATE-WORKSPACE-PENDING] User ${oauthUserData.email} creating workspace "${workspaceName}" via ${provider}`);

        const userData = {
          providerUserId: (oauthUserData.providerUserId || oauthUserData.googleId)!,
          email: oauthUserData.email.toLowerCase(),
          name: oauthUserData.name,
          picture: oauthUserData.picture,
        };

        // Ensure OrgMember exists — find the org by email domain, or fall back to
        // the user's existing OrgMember record (e.g. when domain mapping is missing).
        let existingOrgId: string | null = null;
        const existingOrgByDomain = await organizationDomainService.findExistingOrgByEmailDomain(userData.email);

        if (existingOrgByDomain) {
          existingOrgId = existingOrgByDomain.orgId;
        } else {
          const existingOrgMember = await this.prisma.orgMember.findFirst({
            where: { email: userData.email.toLowerCase(), leftAt: null },
            select: { orgId: true },
          });
          existingOrgId = existingOrgMember?.orgId ?? null;
        }

        if (!existingOrgId) {
          res.status(409).json({
            error: 'No organization found',
            message: 'No organization found for your email domain. Please create an organization first.',
          });
          return;
        }

        await this.prisma.orgMember.upsert({
          where: { email: userData.email.toLowerCase() },
          create: {
            orgId: existingOrgId,
            email: userData.email.toLowerCase(),
            role: OrgRole.MEMBER,
          },
          update: {
            leftAt: null,
          },
        });

        const { organization, workspace, workspaceUser } = await this.userService.createWorkspaceInOrg(
          { userId: '', providerUserId: userData.providerUserId, email: userData.email, name: userData.name, picture: userData.picture },
          workspaceName,
          {
            workspaceType: (workspaceType ?? WorkspaceType.ENTERPRISE) as WorkspaceTypeValue,
            joinPolicy: joinPolicy as WorkspaceJoinPolicyValue | undefined,
          },
        );

        await this.userService.ensureUserPresence(workspaceUser.id, workspace.id);
        const selfDmChannelId = await this.ensureSelfDmForUser(workspaceUser.id, workspace.id);

        const workspaceRecord = await this.prisma.workspace.findUnique({
          where: { id: workspace.id },
          select: { landingChannelId: true },
        });

        let sessionId = null;
        if (pendingRefreshToken) {
          try {
            const refreshTokenExpiry = new Date();
            refreshTokenExpiry.setDate(refreshTokenExpiry.getDate() + 30);
            const deviceInfo = JSON.stringify({
              userAgent: req.headers['user-agent'],
              acceptLanguage: req.headers['accept-language'],
              timestamp: new Date().toISOString(),
              appVersion: req.headers['x-app-version'],
            });
            const session = await this.userSessionService.createSession({
              userId: workspaceUser.id,
              refreshToken: pendingRefreshToken,
              refreshTokenExpiry,
              deviceInfo,
              ipAddress: req.ip || req.connection.remoteAddress || undefined,
            });
            sessionId = session.id;
          } catch (sessionError) {
            logger.error(`[CREATE-WORKSPACE-PENDING] Session creation failed:`, sessionError);
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

        const targetWorkspaceId = workspaceUser.workspaceId;
        res.cookie(`xyne_ws_${targetWorkspaceId}_token`, token, {
          ...cookieOptions,
          maxAge: config.jwt.expirationSeconds * 1000,
        });

        if (sessionId) {
          res.cookie('user_session_id', sessionId, {
            ...cookieOptions,
            maxAge: config.session.expiryDays * 24 * 60 * 60 * 1000,
          });
        }

        res.cookie('xyne_last_workspace', targetWorkspaceId, {
          ...cookieOptions,
          maxAge: 30 * 24 * 60 * 60 * 1000,
        });

        const isNewUser = !(await this.userService.hasCompletedOnboarding(userData.email));

        setOnboardingCookie(res, isNewUser, {
          secure: isProduction,
          sameSite: 'strict' as const,
          maxAge: 24 * 60 * 60 * 1000,
        });

        if (pendingTokenKey) {
          await redisService.del(
            `${config.pendingOAuthTokens.redisKeyPrefix}${pendingTokenKey}`,
          );
        }
        res.clearCookie('google_access_token', { path: '/' });

        logger.info(`[CREATE-WORKSPACE-PENDING] Created workspace "${workspaceName}" for ${oauthUserData.email} in org ${organization.orgId}`);

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
          selfDmChannelId,
          landingChannelId: workspaceRecord?.landingChannelId ?? null,
        });
    } catch (error) {
      logger.error('Error creating workspace (pending auth):', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      const statusCode = (error as Error & { statusCode?: number }).statusCode;
      res.status(statusCode ?? (message.includes('already exists') ? 409 : 500)).json({
        error: 'Failed to create workspace',
        message,
      });
    }
  };

  /**
   * Create a new workspace in an existing org via authenticated session.
   * POST /api/auth/create-workspace
   */
  createWorkspaceAuth = async (req: Request, res: Response): Promise<void> => {
    try {
      const { workspaceName, workspaceType, joinPolicy } = req.body as {
        workspaceName?: string;
        workspaceType?: string;
        joinPolicy?: string;
      };
      if (!workspaceName) {
        res.status(400).json({ error: 'Missing required fields', message: 'workspaceName is required' });
        return;
      }
      if (
        workspaceType &&
        workspaceType !== WorkspaceType.ENTERPRISE &&
        workspaceType !== WorkspaceType.COMMUNITY
      ) {
        res.status(400).json({ error: 'Invalid workspace type', message: 'workspaceType must be ENTERPRISE or COMMUNITY' });
        return;
      }
      if (joinPolicy && !Object.values(WorkspaceJoinPolicy).includes(joinPolicy as WorkspaceJoinPolicyValue)) {
        res.status(400).json({ error: 'Invalid join policy', message: 'joinPolicy must be INVITE_ONLY, OPEN, or REQUEST_TO_JOIN' });
        return;
      }

      const currentUser = req.user!;
      const fullUser = await this.userService.getUserById(currentUser.id);
      if (!fullUser) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      if (fullUser.role === 'GUEST') {
        res.status(403).json({
          error: 'Forbidden',
          message: 'Guest users cannot create workspaces',
        });
        return;
      }

      const { organization, workspace, workspaceUser } = await this.userService.createWorkspaceInOrg(
        { userId: fullUser.id, providerUserId: fullUser.providerUserId, email: fullUser.email, name: fullUser.name, picture: fullUser.picture },
        workspaceName,
        {
          workspaceType: (workspaceType ?? WorkspaceType.ENTERPRISE) as WorkspaceTypeValue,
          joinPolicy: joinPolicy as WorkspaceJoinPolicyValue | undefined,
        },
      );

      await this.userService.ensureUserPresence(workspaceUser.id, workspace.id);
      const selfDmChannelId = await this.ensureSelfDmForUser(workspaceUser.id, workspace.id);

      const workspaceRecord = await this.prisma.workspace.findUnique({
        where: { id: workspace.id },
        select: { landingChannelId: true },
      });

      // Reuse refresh token from current session
      // Get global session cookie
      const sessionId = req.cookies?.user_session_id;
      
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
            deviceInfo: JSON.stringify({ userAgent: req.headers['user-agent'], timestamp: new Date().toISOString(), appVersion: req.headers['x-app-version'] }),
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
        res.cookie('user_session_id', newSessionId, { ...cookieBase, maxAge: config.session.expiryDays * 24 * 60 * 60 * 1000 });
      }
      res.cookie('xyne_last_workspace', targetWorkspaceId, { ...cookieBase, maxAge: 30 * 24 * 60 * 60 * 1000 });
      const isNewUser = !(await this.userService.hasCompletedOnboarding(fullUser.email));
      setOnboardingCookie(res, isNewUser, {
        secure: isProduction,
        sameSite: 'strict' as const,
        maxAge: 24 * 60 * 60 * 1000,
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
        isNewUser,
        selfDmChannelId,
        landingChannelId: workspaceRecord?.landingChannelId ?? null,
      });
    } catch (error) {
      logger.error('Error creating workspace:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      const statusCode = (error as Error & { statusCode?: number }).statusCode;
      res.status(statusCode ?? (message.includes('already exists') ? 409 : 500)).json({
        error: 'Failed to create workspace',
        message,
      });
    }
  };

  /**
   * Parses and verifies the google_access_token pending-auth cookie (signed JWT).
   * Returns null if the token is invalid, expired, or cannot be verified.
   */
  private async parsePendingAuthCookie(cookie: string): Promise<{
    oauthUserData: { email: string; name: string; googleId?: string; providerUserId?: string; picture?: string };
    provider: string;
    pendingRefreshToken: string | undefined;
    pendingAccessToken: string | undefined;
    pendingAccessTokenExpiry: Date | undefined;
    pendingTokenKey: string | undefined;
  } | null> {
    try {
      const decoded = jwt.verify(cookie, process.env.JWT_SECRET!) as {
        googleId?: string;
        providerUserId?: string;
        email?: string;
        name?: string;
        picture?: string;
        provider?: string;
        refreshToken?: string | null;
        accessToken?: string | null;
        accessTokenExpiry?: string | null;
        tokenKey?: string;
      };
      if (!decoded?.email) throw new Error('Invalid JWT payload');

      let redisTokens: {
        refreshToken?: string | null;
        accessToken?: string | null;
        accessTokenExpiry?: string | null;
      } | null = null;
      if (decoded.tokenKey) {
        const storedTokens = await redisService.get(
          `${config.pendingOAuthTokens.redisKeyPrefix}${decoded.tokenKey}`,
        );
        if (!storedTokens) return null;
        redisTokens = JSON.parse(storedTokens);
      }

      const refreshToken = redisTokens?.refreshToken ?? decoded.refreshToken;
      const accessToken = redisTokens?.accessToken ?? decoded.accessToken;
      const accessTokenExpiry = redisTokens?.accessTokenExpiry ?? decoded.accessTokenExpiry;
      const pendingAccessTokenExpiry = accessTokenExpiry
        ? new Date(accessTokenExpiry)
        : undefined;
      return {
        oauthUserData: {
          email: decoded.email,
          name: decoded.name || '',
          googleId: decoded.googleId,
          providerUserId: decoded.providerUserId,
          picture: decoded.picture,
        },
        provider: decoded.provider || AuthProvider.GOOGLE,
        pendingRefreshToken: refreshToken || undefined,
        pendingAccessToken: accessToken || undefined,
        pendingAccessTokenExpiry:
          pendingAccessTokenExpiry && !Number.isNaN(pendingAccessTokenExpiry.getTime())
            ? pendingAccessTokenExpiry
            : undefined,
        pendingTokenKey: decoded.tokenKey,
      };
    } catch {
      return null;
    }
  }
}
