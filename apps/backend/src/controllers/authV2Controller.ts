import { Request, Response } from 'express';
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';
import { signPendingAuthToken, verifyPendingAuthToken } from '@/utils/pendingAuthToken';
import { logger } from '../utils/logger';
import { UserService } from '../services/userService';
import { authSessionService, MissingDeviceKeyError } from '../services/authSessionService';
import { completeLogin, respondDeviceKeyRequired, trackLogout, type ProviderTokens } from '../services/loginCompletionService';
import { oauthStateServiceV2 } from '../services/oauthStateServiceV2';
import { pkceServiceV2 } from '../services/pkceServiceV2';
import { MicrosoftAuthController } from './microsoftAuthController';
import { WorkspaceType, AuthProvider, UserStatus, OrgRole } from '@xyne/shared';

import '../types/express';
import { config } from '@/config/env';
import {
  EMAIL_DOMAIN_NOT_ALLOWED_ERROR,
  EMAIL_DOMAIN_NOT_ALLOWED_MESSAGE,
  getProviderLoginDenial,
  isEmailDomainAllowed,
} from '@/services/emailDomainPolicy';
import { DatabaseClient } from '@/database/client';
import {
  issueAccessCookies,
  readWorkspaceJwt,
  LAST_WORKSPACE_COOKIE,
  PENDING_AUTH_COOKIE,
  WORKSPACE_TOKEN_COOKIE_PREFIX,
  type AccessCookieOverrides,
} from '@/services/accessTokenService';
import {
  switchWorkspaceData,
  ensureSelfDmForUserData,
  getWorkspaceLandingChannelData,
  getRefreshTargetUserData,
} from '@/bypassAcl/authServices';
import { getEncryptionProvider } from '@/services/encryption';
import { getFrontendUrl, resolveConfiguredOAuthRedirectUrl } from '@/utils/publicUrls';
import {
  OrganizationDomainConflictError,
  isOrganizationPolicyError,
  organizationDomainService,
} from '@/services/organizationDomainService';
import { migrateLegacyIdentity } from '@/services/legacyIdentityMigrationHelper';
import { redisService } from '@/services/redisService';
import { randomUUID } from 'crypto';
import { setOnboardingCookie } from '@/utils/onboardingCookie';

const authTag = (flowId: string): string => `[AUTH][flow=${flowId}]`;

const workspaceOutcome = (count: number): string =>
  count === 0 ? 'no_workspace' : count === 1 ? 'single_workspace' : 'multi_workspace';

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
    orgMemberId: string;
    providerUserId: string;
    role: string;
  };
  /** auth_sessions.id the login was issued under. */
  sessionId: string;
  isNewUser: boolean;
};

export class AuthV2Controller {
  private googleClient: OAuth2Client;
  private googleClientNew: OAuth2Client | null = null;
  private mobileGoogleClient: OAuth2Client;
  private userService: UserService;
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
    const clientId = config.email.clientId;
    const clientSecret = config.email.clientSecret;
    const mobileClientId = config.email.mobileClientId;
    const mobileClientSecret = config.email.mobileClientSecret;

    if (!clientId || !clientSecret) {
      throw new Error(
        'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables are required'
      );
    }

    this.googleClient = new OAuth2Client(clientId, clientSecret);

    const clientIdNew = config.email.clientIdNew;
    const clientSecretNew = config.email.clientSecretNew;
    if (clientIdNew && clientSecretNew) {
      this.googleClientNew = new OAuth2Client(clientIdNew, clientSecretNew);
    }
    this.mobileGoogleClient = new OAuth2Client(mobileClientId, mobileClientSecret);

    this.userService = new UserService();
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
    return ensureSelfDmForUserData(userId, workspaceId);
  }

  /**
   * Performs single-workspace auto-login (core logic shared across web, mobile, electron).
   * Creates the workspace user, then the auth session + JWT cookies via completeLogin.
   * Throws MissingDeviceKeyError (→ respondDeviceKeyRequired) without x-device-id.
   */
  private async performSingleWorkspaceAutoLogin(
    googleUserData: {
      googleId: string;
      email: string;
      name: string;
      picture?: string;
    },
    workspaceId: string,
    providerTokens: ProviderTokens,
    req: Request,
    res: Response,
    cookieOptions?: AccessCookieOverrides,
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

    const { sessionId } = await completeLogin(req, res, {
      user: { ...workspaceUser, workspaceId },
      loginMethod: 'AUTO_LOGIN',
      providerTokens,
      cookieOptions,
    });

    return { workspaceUser, sessionId, isNewUser };
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

  initiateLogin = async (req: Request, res: Response): Promise<void> => {
    const flowId = randomUUID();

    try {
      logger.info(`${authTag(flowId)} Google OAuth login initiated`);

      const platformQuery = req.query.platform as 'electron' | 'web' | 'mobile';
      const platform = platformQuery || this.detectPlatform(req);
      logger.info(`${authTag(flowId)} Platform detected: ${platform}`);

      const isNy = req.query.isNy === 'true';
      const enterpriseLogin = req.query.enterpriseLogin === 'true';

      // Electron holds its own verifier and sends only the challenge; the server stores none.
      let codeVerifier: string | undefined;
      let codeChallenge: string;
      if (platform === 'electron') {
        const clientChallenge = req.query.code_challenge;
        if (!pkceServiceV2.isValidCodeChallenge(clientChallenge)) {
          logger.warn(`${authTag(flowId)} Electron login without a valid code_challenge - rejecting`);
          res.status(400).json({ error: 'invalid_request', message: 'Electron login requires a code_challenge' });
          return;
        }
        codeChallenge = clientChallenge;
      } else {
        codeVerifier = pkceServiceV2.generateCodeVerifier();
        codeChallenge = pkceServiceV2.generateCodeChallenge(codeVerifier);
      }

      let validatedRedirectTo: string | undefined;
      const redirectToParam = req.query['redirect_to'] as string | undefined;
      if (redirectToParam) {
        const allowedOrigins = config.allowedRedirectOrigins
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
        flowId,
      );

      if (codeVerifier) await pkceServiceV2.storeVerifier(state, codeVerifier);

      const redirectUri = this.getGoogleRedirectUri(req);

      logger.info(`${authTag(flowId)} Redirect URI: ${redirectUri}`);

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
      const isProduction = config.env === 'production';
      res.cookie('oauth_state', state, {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'lax' as const,
        maxAge: 10 * 60 * 1000,
        path: '/',
      });

      logger.info(`${authTag(flowId)} Redirecting to Google OAuth`);
      res.redirect(authUrl);
    } catch (error) {
      logger.error(`${authTag(flowId)} Google OAuth login initiate failed:`, error);

      const frontendUrl = getFrontendUrl(req);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.redirect(
        `${frontendUrl}?error=oauth_init_failed&message=${encodeURIComponent(errorMessage)}`
      );
    }
  };

  handleCallback = async (req: Request, res: Response): Promise<void> => {
    // Placeholder until the OAuth state is decoded and the real flowId (minted in
    // initiateLogin) is adopted. `web-login` marks these early, pre-resolution lines.
    let flowId = 'web-login';
    const tag = (): string => authTag(flowId);

    try {
      const { code, state, error } = req.query;

      logger.info(`${tag()} Google OAuth callback received`);

      if (error) {
        logger.error(`${tag()} Google OAuth provider returned error: ${error}`);
        const frontendUrl = getFrontendUrl(req);
        res.redirect(
          `${frontendUrl}?error=oauth_error&message=${encodeURIComponent(error as string)}`
        );
        return;
      }

      if (!code || !state) {
        logger.error(`${tag()} Missing code or state`);
        const frontendUrl = getFrontendUrl(req);
        res.redirect(
          `${frontendUrl}?error=missing_params&message=${encodeURIComponent('Missing authorization code or state')}`
        );
        return;
      }

      const isCodeUsed = await oauthStateServiceV2.isCodeUsed(code as string);
      if (isCodeUsed) {
        logger.error(`${tag()} Authorization code already used`);
        const frontendUrl = getFrontendUrl(req);
        res.redirect(
          `${frontendUrl}?error=code_reused&message=${encodeURIComponent('Authorization code already used')}`
        );
        return;
      }

      const stateData = await oauthStateServiceV2.validateState(state as string, false);
      if (!stateData) {
        logger.error(`${tag()} Invalid or expired state`);
        const frontendUrl = getFrontendUrl(req);
        res.redirect(
          `${frontendUrl}?error=invalid_state&message=${encodeURIComponent('Invalid or expired state')}`
        );
        return;
      }
      
      flowId = stateData.flowId ?? 'web-login';
      logger.info(`${tag()} Google OAuth state validated (platform=${stateData.platform})`);

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
        logger.info(`${tag()} Google OAuth login handed off to Electron (outcome=electron_handoff) — redirecting to launch page: ${launchUrl}`);
        res.redirect(launchUrl);
        return;
      }

      // The state must match the oauth_state cookie; reject when absent or different. The
      // cookie is single-use and cleared here regardless of outcome. Checked only on the
      // browser-driven path: desktop returns above, and the cookie is host-only.
      const boundState = req.cookies?.oauth_state as string | undefined;
      res.clearCookie('oauth_state', { path: '/' });
      if (!boundState || boundState !== state) {
        logger.error(`${tag()} Google OAuth state cookie missing or mismatched — rejecting`);
        const frontendUrl = getFrontendUrl(req);
        res.redirect(
          `${frontendUrl}?error=invalid_state&message=${encodeURIComponent('Invalid or expired state')}`
        );
        return;
      }

      await oauthStateServiceV2.deleteState(state as string);

      const codeVerifier = await pkceServiceV2.getAndDeleteVerifier(state as string);
      if (!codeVerifier) {
        logger.error(`${tag()} PKCE verifier not found`);
        const frontendUrl = getFrontendUrl(req);
        res.redirect(
          `${frontendUrl}?error=pkce_failed&message=${encodeURIComponent('PKCE verification failed')}`
        );
        return;
      }

      await oauthStateServiceV2.markCodeAsUsed(code as string);

      const redirectUri = this.getGoogleRedirectUri(req);

      logger.info(`${tag()} Redirect URI: ${redirectUri}`);

      logger.info(`${tag()} Exchanging code for tokens`);
      const { tokens } = await this.getGoogleClient(stateData.isNy).getToken({
        code: code as string,
        redirect_uri: redirectUri,
        codeVerifier: codeVerifier,
      });

      const { id_token, refresh_token, access_token } = tokens;
      const accessTokenExpiry = tokens.expiry_date ? new Date(tokens.expiry_date) : undefined;

      if (!id_token) {
        logger.error(`${tag()} No ID token received`);
        const frontendUrl = getFrontendUrl(req);
        res.redirect(
          `${frontendUrl}?error=no_id_token&message=${encodeURIComponent('No ID token received')}`
        );
        return;
      }

      logger.info(`${tag()} Verifying ID token`);
      const ticket = await this.getGoogleClient(stateData.isNy).verifyIdToken({
        idToken: id_token,
        audience: stateData.isNy ? config.email.clientIdNew : config.email.clientId,
      });

      const payload = ticket.getPayload();
      if (!payload) {
        logger.error(`${tag()} Invalid token payload`);
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

      const loginDenial = getProviderLoginDenial(googleUserData.email, payload.email_verified === true);
      if (loginDenial) {
        logger.warn(`${tag()} Google login rejected (reason=${loginDenial.error})`);
        const frontendUrl = stateData.redirectTo ?? getFrontendUrl(req);
        const params = new URLSearchParams({ error: loginDenial.error, message: loginDenial.message });
        res.redirect(`${frontendUrl}?${params.toString()}`);
        return;
      }

      logger.info(`${tag()} Google auth success for: ${googleUserData.email}`);

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
          `${tag()} Provider mismatch for ${googleUserData.email}: account registered with ${existingIdentity.authProvider}, attempted login with GOOGLE`,
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

      const workspaces = await this.userService.getWorkspacesByEmail(googleUserData.email);
      logger.info(`${tag()} User has ${workspaces.length} workspace(s) before invitation check`);

      // Check for pending invitation from cookie (web) or OAuth state (electron/mobile)
      const cookieInvitationId = req.cookies?.pending_invitation_id as string | undefined;
      const stateInvitationId = stateData.invitationId;
      
      // At this point platform is always 'web' | 'mobile' (electron is handled above and returns early).
      // Prefer cookie (set by the browser invite redirect) but fall back to state (set by mobile/other flows).
      const pendingInvitationId = cookieInvitationId || stateInvitationId;
      
      const userExistsButRemoved = await this.userService.userExistsButNoActiveWorkspaces(googleUserData.email);

      let domainConflict = null;
      let domainConflictError = null;

      if (workspaces.length === 0 && !userExistsButRemoved) {
        if (stateData.enterpriseLogin) {
          try {
            await organizationDomainService.assertCanCreateOrgForEmail(googleUserData.email);
          } catch (error) {
            if (error instanceof OrganizationDomainConflictError) {
              domainConflictError = error;
            }
          }
        }

        if (!domainConflictError) {
          domainConflict = await organizationDomainService.findEnterpriseWorkspaceByEmailDomain(googleUserData.email);
          domainConflictError = domainConflict
            ? new OrganizationDomainConflictError(domainConflict.domain, domainConflict)
            : null;
        }
      }

      const isProduction = config.env === 'production';
      const tokenKey = await this.storePendingOAuthTokens(
        refresh_token,
        access_token,
        accessTokenExpiry,
      );
      res.cookie(PENDING_AUTH_COOKIE, signPendingAuthToken({
        googleId: googleUserData.googleId,
        email: googleUserData.email,
        name: googleUserData.name,
        picture: googleUserData.picture,
        provider: AuthProvider.GOOGLE,
        tokenKey,
      }), {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'strict' as const,
        path: '/',
        maxAge: 10 * 60 * 1000, // 10 minutes pending auth window
      });

      const frontendUrl = stateData.redirectTo ?? getFrontendUrl(req);

      // If an invitation is pending, redirect back to the invite page for explicit acceptance.
      // The xyne_pending_auth cookie (set above) carries identity for acceptInvitation + loginWorkspace.
      // Clear pending_invitation_id now — it is one-time-use; clearing it here prevents a
      // subsequent re-login (e.g. after workspace switch) from re-triggering this flow with
      // an already-accepted invitation.
      if (pendingInvitationId) {
        logger.info(`${tag()} Google OAuth login succeeded (platform=web, outcome=pending_invitation, invitationId=${pendingInvitationId})`);
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
        // The callback is a top-level redirect from Google: no x-device-id header, so no auth
        // session can be issued here. The pending cookie (set above) carries the identity and
        // the frontend completes the login through POST /auth/login-workspace.
        logger.info(`${tag()} Single workspace detected - redirecting for auto-login to ${workspaceId}`);

        logger.info(`${tag()} Google OAuth login succeeded (platform=web, outcome=${workspaceOutcome(workspaces.length)}, count=${workspaces.length})`);

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

      logger.info(`${tag()} Google OAuth login succeeded (platform=web, outcome=${workspaceOutcome(workspaces.length)}, count=${workspaces.length})`);

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

      res.redirect(`${frontendUrl}?${params.toString()}`);
      return;
    } catch (error) {
      logger.error(`${tag()} Google OAuth login failed (platform=web):`, error);

      const frontendUrl = getFrontendUrl(req);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.redirect(
        `${frontendUrl}?error=callback_failed&message=${encodeURIComponent(errorMessage)}`
      );
    }
  };

  /**
   * The only place a JWT is re-minted. Credential is the `xs` cookie (org-level auth session);
   * the workspace comes from `xyne_last_workspace`, falling back to the session's latest access
   * row. Any failure is a 401 → the client goes to login. No provider token check: revocation
   * is the auth session's status/expiry plus the member's and user's own state.
   */
  refreshSession = async (req: Request, res: Response): Promise<void> => {
    const requestId = `REFRESH_${Date.now()}`;

    try {
      logger.info(`[${requestId}] Refresh session endpoint called`);

      const session = await authSessionService.validateRefresh(req);
      if (!session) {
        logger.warn(`[${requestId}] Refresh rejected: xs cookie missing, unknown, revoked or expired`);
        res.status(401).json({
          error: 'Session expired',
          code: 'REFRESH_INVALID',
          message: 'Please re-authenticate',
        });
        return;
      }

      const lastWorkspaceCookie = req.cookies?.[LAST_WORKSPACE_COOKIE];
      const workspaceId =
        (typeof lastWorkspaceCookie === 'string' && lastWorkspaceCookie) ||
        (await authSessionService.lastWorkspaceId(session.id));
      if (!workspaceId) {
        logger.warn(`[${requestId}] Refresh rejected: no workspace to refresh for`, { authSessionId: session.id });
        res.status(401).json({
          error: 'Session expired',
          code: 'REFRESH_INVALID',
          message: 'Please re-authenticate',
        });
        return;
      }

      const user = await getRefreshTargetUserData(session.orgMemberId, workspaceId);
      if (!user || user.status === UserStatus.INACTIVE || user.leftAt !== null) {
        logger.warn(`[${requestId}] Refresh rejected: no active user in workspace`, {
          authSessionId: session.id,
          orgMemberId: session.orgMemberId,
          workspaceId,
          reason: !user ? 'no_user' : user.leftAt ? 'left' : 'inactive',
        });
        res.status(403).json({
          error: 'Workspace access denied',
          code: 'WORKSPACE_ACCESS_DENIED',
          message: 'Your account has been deactivated or you have left this workspace',
        });
        return;
      }

      if (!isEmailDomainAllowed(user.email)) {
        logger.warn(`[${requestId}] Session refresh rejected (reason=email_domain_not_allowed)`, { authSessionId: session.id });
        res.status(401).json({
          error: EMAIL_DOMAIN_NOT_ALLOWED_ERROR,
          message: EMAIL_DOMAIN_NOT_ALLOWED_MESSAGE,
        });
        return;
      }

      const minted = issueAccessCookies(res, { user, sessionId: session.id, refreshTokenExpiry: session.refreshTokenExpiry });
      await authSessionService.recordWorkspaceAccessById(session.id, workspaceId);

      logger.info(`[${requestId}] New JWT cookie set`, { authSessionId: session.id, workspaceId, email: user.email });

      res.status(200).json({
        success: true,
        workspaceId,
        accessTokenExpiresAt: minted.expiresAt,
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
    let flowId = 'electron-login';
    const tag = (): string => authTag(flowId);

    try {
      logger.info(`${tag()} Google OAuth callback received (electron exchange)`);

      const { code, state, invitationId } = req.body;

      if (!code || !state) {
        logger.error(`${tag()} Missing code or state`);
        res.status(400).json({
          error: 'Missing parameters',
          message: 'Authorization code and state are required',
        });
        return;
      }

      const isCodeUsed = await oauthStateServiceV2.isCodeUsed(code);
      if (isCodeUsed) {
        logger.error(`${tag()} Authorization code already used`);
        res.status(409).json({
          error: 'Code already used',
          message: 'Authorization code has already been exchanged',
        });
        return;
      }

      const stateData = await oauthStateServiceV2.validateState(state);
      if (!stateData) {
        logger.error(`${tag()} Invalid or expired state`);
        res.status(401).json({
          error: 'Invalid state',
          message: 'State parameter is invalid or expired',
        });
        return;
      }

      // Adopt the flowId minted in initiateLogin so the rest of the exchange shares that login's trace.
      flowId = stateData.flowId ?? 'electron-login';
      logger.info(`${tag()} Google OAuth state validated (platform=${stateData.platform})`);

      if (stateData.platform !== 'electron') {
        logger.error(`${tag()} Invalid platform: ${stateData.platform}`);
        res.status(400).json({
          error: 'Invalid platform',
          message: 'This endpoint is only for Electron platform',
        });
        return;
      }

      const codeVerifier: unknown = req.body?.codeVerifier;
      if (!stateData.codeChallenge || !pkceServiceV2.matchesChallenge(codeVerifier, stateData.codeChallenge)) {
        logger.error(`${tag()} PKCE verifier missing or does not match the login's code_challenge`);
        res.status(401).json({
          error: 'PKCE verification failed',
          message: 'Code verifier missing or invalid',
        });
        return;
      }

      await oauthStateServiceV2.markCodeAsUsed(code);

      const redirectUri = this.getGoogleRedirectUri(req);

      logger.info(`${tag()} Redirect URI: ${redirectUri}`);

      logger.info(`${tag()} Exchanging code for tokens`);
      const { tokens } = await this.getGoogleClient(stateData.isNy).getToken({
        code,
        redirect_uri: redirectUri,
        codeVerifier: codeVerifier,
      });

      const { id_token, refresh_token, access_token } = tokens;
      const accessTokenExpiry = tokens.expiry_date ? new Date(tokens.expiry_date) : undefined;

      if (!id_token) {
        logger.error(`${tag()} No ID token received`);
        res.status(500).json({
          error: 'No ID token',
          message: 'Google did not return an ID token',
        });
        return;
      }

      logger.info(`${tag()} Verifying ID token`);
      const ticket = await this.getGoogleClient(stateData.isNy).verifyIdToken({
        idToken: id_token,
        audience: stateData.isNy ? config.email.clientIdNew : config.email.clientId,
      });

      const payload = ticket.getPayload();
      if (!payload) {
        logger.error(`${tag()} Invalid token payload`);
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

      const loginDenial = getProviderLoginDenial(googleUserData.email, payload.email_verified === true);
      if (loginDenial) {
        logger.warn(`${tag()} Google login rejected (reason=${loginDenial.error})`);
        res.status(403).json({ success: false, ...loginDenial });
        return;
      }

      logger.info(`${tag()} Google auth success for: ${googleUserData.email}`);

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
          `${tag()} Provider mismatch for ${googleUserData.email}: account registered with ${existingIdentity.authProvider}, attempted login with GOOGLE`,
        );
        res.status(403).json({
          success: false,
          error: 'provider_mismatch',
          message: 'This account uses a different login method. Please continue with your original sign-in method.',
          existingProvider: existingIdentity.authProvider,
        });
        return;
      }

      const workspaces = await this.userService.getWorkspacesByEmail(googleUserData.email);
      logger.info(`${tag()} User has ${workspaces.length} workspace(s) before invitation check`);
      const userExistsButRemoved = await this.userService.userExistsButNoActiveWorkspaces(googleUserData.email);

      // Domain-conflict detection, mirroring handleCallback. Without it the Electron renderer
      // receives workspaces: [] for a user whose email domain already maps to an enterprise org
      // and offers "create an organization" instead of the request-to-join UI.
      let domainConflict = null;
      let domainConflictError = null;

      if (workspaces.length === 0 && !userExistsButRemoved) {
        if (stateData.enterpriseLogin) {
          try {
            await organizationDomainService.assertCanCreateOrgForEmail(googleUserData.email);
          } catch (error) {
            if (error instanceof OrganizationDomainConflictError) {
              domainConflictError = error;
            }
          }
        }

        if (!domainConflictError) {
          domainConflict = await organizationDomainService.findEnterpriseWorkspaceByEmailDomain(googleUserData.email);
          domainConflictError = domainConflict
            ? new OrganizationDomainConflictError(domainConflict.domain, domainConflict)
            : null;
        }
      }

      const isProduction = config.env === 'production';

      // If an invitation is pending: set xyne_pending_auth so the Electron renderer can later
      // call acceptInvitation + loginWorkspace, then return a hasInvitation signal. The renderer
      // will navigate to /invite?loginComplete=true inside the app — no browser involvement.
      const effectiveInvitationId = stateData.invitationId || invitationId;
      if (effectiveInvitationId) {
        logger.info(`${tag()} Google OAuth login succeeded (platform=electron, outcome=pending_invitation, invitationId=${effectiveInvitationId})`);
        const tokenKey = await this.storePendingOAuthTokens(
          refresh_token,
          access_token,
          accessTokenExpiry,
        );
        res.cookie(PENDING_AUTH_COOKIE, signPendingAuthToken({
          googleId: googleUserData.googleId,
          email: googleUserData.email,
          name: googleUserData.name,
          picture: googleUserData.picture,
          provider: AuthProvider.GOOGLE,
          tokenKey,
        }), {
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
        logger.info(`${tag()} Single workspace detected - auto-logging in to ${workspaceId}`);

        // The exchange comes from the Electron main process; if it arrived without
        // x-device-id, skip the auto-login and fall through to the pending-cookie path so
        // the renderer completes the login through /auth/login-workspace instead.
        let autoLoggedIn = false;
        try {
          const { isNewUser } = await this.performSingleWorkspaceAutoLogin(
            googleUserData,
            workspaceId,
            { refreshToken: refresh_token, accessToken: access_token, accessTokenExpiry },
            req,
            res,
          );
          setOnboardingCookie(res, isNewUser, {
            secure: isProduction,
            sameSite: 'strict' as const,
          });
          autoLoggedIn = true;
        } catch (error) {
          if (!(error instanceof MissingDeviceKeyError)) throw error;
          logger.warn(`${tag()} Electron exchange without x-device-id - deferring login to login-workspace`);
        }

        if (autoLoggedIn) {
          logger.info(`${tag()} Google OAuth login succeeded (platform=electron, outcome=${workspaceOutcome(workspaces.length)}, count=${workspaces.length})`);

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
      }

      // Store pending auth data for later loginWorkspace/createOrg call (multi-workspace case)
      const tokenKey = await this.storePendingOAuthTokens(
        refresh_token,
        access_token,
        accessTokenExpiry,
      );
      res.cookie(PENDING_AUTH_COOKIE, signPendingAuthToken({
        googleId: googleUserData.googleId,
        email: googleUserData.email,
        name: googleUserData.name,
        picture: googleUserData.picture,
        provider: AuthProvider.GOOGLE,
        tokenKey,
      }), {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'strict' as const,
        path: '/',
        maxAge: 10 * 60 * 1000, // 10 minutes pending auth window
      });

      logger.info(`${tag()} Google OAuth login succeeded (platform=electron, outcome=${workspaceOutcome(workspaces.length)}, count=${workspaces.length})`);
      res.status(200).json({
        success: true,
        email: googleUserData.email,
        name: googleUserData.name,
        picture: googleUserData.picture,
        workspaces,
        userExistsButRemoved,
        ...(domainConflictError ? { domainConflictError: domainConflictError.message } : {}),
        ...(domainConflict ? { enterpriseJoinOrgName: domainConflict.name } : {}),
        ...(domainConflict ? { enterpriseJoinWorkspaces: JSON.stringify(domainConflict.workspaces) } : {}),
      });
    } catch (error) {
      logger.error(`${tag()} Google OAuth login failed (platform=electron):`, error);

      res.status(500).json({
        error: 'Exchange failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  exchangeMobileCode = async (req: Request, res: Response): Promise<void> => {
    // Native mobile carries no OAuth state (PKCE happens in the Google SDK), so there is no
    // flowId to recover — it stays `native-mobile` (set once native is detected below). The
    // web-mobile branch DOES have state and adopts its real flowId after validation.
    let flowId = 'mobile-login';
    const tag = (): string => authTag(flowId);
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
        `${tag()} mobile-exchange selected via query parameter without the x-platform header (browserInitiated=${looksBrowserInitiated})`,
      );
    }
    // The native branch is only selectable by a genuine native client, which sends neither
    // Origin nor Sec-Fetch-Site. Anything browser-initiated takes the web branch.
    const isMobileNative = (nativeByHeader || nativeByQuery) && !looksBrowserInitiated;
    // Native has no OAuth state → no flowId ever; mark it so its logs are still attributable.
    if (isMobileNative) flowId = 'native-mobile';
    if ((nativeByHeader || nativeByQuery) && looksBrowserInitiated) {
      logger.warn(
        `${tag()} native mobile-exchange requested from a browser-initiated request; falling back to the web branch`,
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

      logger.info(`${tag()} Google OAuth callback received (mobile exchange, native=${isMobileNative})`);

      if (error) {
        logger.error(`${tag()} Google OAuth provider returned error: ${error}`);
        sendError('oauth_error', error as string);
        return;
      }

      if (!code) {
        logger.error(`${tag()} Missing code or state`);
        sendError('missing_params', 'Missing authorization code');
        return;
      }

      const isCodeUsed = await oauthStateServiceV2.isCodeUsed(code as string);
      if (isCodeUsed) {
        logger.error(`${tag()} Authorization code already used`);
        sendError('code_reused', 'Authorization code already used');
        return;
      }

      // Native does PKCE inside the Google SDK, so only the web branch verifies it server-side.
      let codeVerifier: string | undefined;
      // Only the web branch carries OAuth state, so enterpriseLogin is captured there and stays
      // undefined for native (same effect as an absent flag on the web callback).
      let enterpriseLogin: boolean | undefined;
      if (!isMobileNative) {
        const state = (req.query.state || req.body?.state) as string | undefined;
        if (!state) {
          logger.error(`${tag()} Missing state on web mobile-exchange`);
          sendError('missing_params', 'Missing state');
          return;
        }
        const stateData = await oauthStateServiceV2.validateState(state, false);
        if (!stateData) {
          logger.error(`${tag()} Invalid or expired state`);
          sendError('invalid_state', 'Invalid or expired state');
          return;
        }
        // Web-mobile carries state — adopt the flowId minted in initiateLogin for the trace.
        flowId = stateData.flowId ?? 'mobile-login';
        enterpriseLogin = stateData.enterpriseLogin;
        logger.info(`${tag()} Google OAuth state validated (platform=${stateData.platform})`);
        await oauthStateServiceV2.deleteState(state);
        codeVerifier = (await pkceServiceV2.getAndDeleteVerifier(state)) ?? undefined;
        if (!codeVerifier) {
          logger.error(`${tag()} PKCE verifier not found`);
          sendError('pkce_failed', 'PKCE verification failed');
          return;
        }
      }

      await oauthStateServiceV2.markCodeAsUsed(code as string);

      // For mobile native apps using serverAuthCode, use empty string as redirect_uri
      // For web OAuth flow, use the backend callback URL
      const redirectUri = isMobileNative ? '' : this.getGoogleRedirectUri(req);

      logger.info(`${tag()} Redirect URI: ${redirectUri}`);

      logger.info(`${tag()} Exchanging code for tokens`);
      const { tokens } = await this.mobileGoogleClient.getToken({
        code: code as string,
        redirect_uri: redirectUri,
        ...(codeVerifier ? { codeVerifier } : {}),
      });

      const { id_token, refresh_token, access_token } = tokens;
      const accessTokenExpiry = tokens.expiry_date ? new Date(tokens.expiry_date) : undefined;

      if (!id_token) {
        logger.error(`${tag()} No ID token received`);
        sendError('no_id_token', 'No ID token received', 500);
        return;
      }

      logger.info(`${tag()} Verifying ID token`);
      const ticket = await this.mobileGoogleClient.verifyIdToken({
        idToken: id_token,
        // Accept both web and iOS client IDs
        audience: [config.email.mobileClientId, config.email.iosClientId].filter(
          Boolean
        ),
      });

      const payload = ticket.getPayload();
      if (!payload) {
        logger.error(`${tag()} Invalid token payload`);
        sendError('invalid_token', 'Invalid token payload', 401);
        return;
      }

      const googleUserData = {
        googleId: payload.sub,
        email: payload.email!,
        name: payload.name!,
        picture: payload.picture,
      };

      const loginDenial = getProviderLoginDenial(googleUserData.email, payload.email_verified === true);
      if (loginDenial) {
        logger.warn(`${tag()} Google login rejected (reason=${loginDenial.error})`);
        sendError(loginDenial.error, loginDenial.message, 403);
        return;
      }

      logger.info(`${tag()} Google auth success for: ${googleUserData.email}`);

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
          `${tag()} Provider mismatch for ${googleUserData.email}: account registered with ${existingIdentity.authProvider}, attempted login with GOOGLE`,
        );
        sendError(
          'provider_mismatch',
          'This account uses a different login method. Please continue with your original sign-in method.',
          403,
        );
        return;
      }

      const workspaces = await this.userService.getWorkspacesByEmail(googleUserData.email);
      logger.info(`${tag()} User has ${workspaces.length} workspace(s) before invitation check`);
      const userExistsButRemoved = await this.userService.userExistsButNoActiveWorkspaces(googleUserData.email);

      // Domain-conflict detection, mirroring handleCallback. Without it the mobile client
      // receives workspaces: [] for a user whose email domain already maps to an enterprise org
      // and offers "create an organization" instead of the request-to-join UI.
      let domainConflict = null;
      let domainConflictError = null;

      if (workspaces.length === 0 && !userExistsButRemoved) {
        if (enterpriseLogin) {
          try {
            await organizationDomainService.assertCanCreateOrgForEmail(googleUserData.email);
          } catch (error) {
            if (error instanceof OrganizationDomainConflictError) {
              domainConflictError = error;
            }
          }
        }

        if (!domainConflictError) {
          domainConflict = await organizationDomainService.findEnterpriseWorkspaceByEmailDomain(googleUserData.email);
          domainConflictError = domainConflict
            ? new OrganizationDomainConflictError(domainConflict.domain, domainConflict)
            : null;
        }
      }

      const isProduction = config.env === 'production';
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
      res.cookie(PENDING_AUTH_COOKIE, signPendingAuthToken({
        googleId: googleUserData.googleId,
        email: googleUserData.email,
        name: googleUserData.name,
        picture: googleUserData.picture,
        provider: AuthProvider.GOOGLE,
        tokenKey,
      }), cookieOptions);
      logger.info(`${tag()} Stored pending auth data for workspace selection`);

      /**
       * AUTO-LOGIN SINGLE WORKSPACE USERS (Mobile)
       * Mirrors web behavior exactly - auto-login when user has exactly 1 workspace
       */
      if (isMobileNative && workspaces.length === 1) {
        const workspaceId = workspaces[0]!.id;
        logger.info(`${tag()} Single workspace detected - auto-logging in to ${workspaceId}`);

        // Mobile cookie options: native WebView needs sameSite none + secure.
        const { workspaceUser, sessionId, isNewUser } = await this.performSingleWorkspaceAutoLogin(
          googleUserData,
          workspaceId,
          { refreshToken: refresh_token, accessToken: access_token, accessTokenExpiry },
          req,
          res,
          { secure: isProduction || isMobileNative, sameSite: isMobileNative ? 'none' : 'lax' },
        );

        setOnboardingCookie(res, isNewUser, {
          secure: isProduction || isMobileNative,
          sameSite: (isMobileNative ? 'none' : 'lax') as 'none' | 'lax',
        });

        logger.info(`${tag()} Google OAuth login succeeded (platform=mobile, outcome=${workspaceOutcome(workspaces.length)}, count=${workspaces.length})`);

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
        logger.info(`${tag()} Google OAuth login succeeded (platform=mobile, outcome=${workspaceOutcome(workspaces.length)}, count=${workspaces.length})`);
        res.status(200).json({
          success: true,
          email: googleUserData.email,
          name: googleUserData.name,
          picture: googleUserData.picture,
          workspaces,
          userExistsButRemoved,
          ...(domainConflictError ? { domainConflictError: domainConflictError.message } : {}),
          ...(domainConflict ? { enterpriseJoinOrgName: domainConflict.name } : {}),
          ...(domainConflict ? { enterpriseJoinWorkspaces: JSON.stringify(domainConflict.workspaces) } : {}),
        });
        return;
      }

      logger.info(`${tag()} Google OAuth login succeeded (platform=mobile, outcome=${workspaceOutcome(workspaces.length)}, count=${workspaces.length})`);

      // Redirect with workspaces (frontend will select workspace)
      const params = new URLSearchParams({
        success: 'true',
        email: googleUserData.email,
        name: googleUserData.name,
        picture: googleUserData.picture || '',
        workspaces: JSON.stringify(workspaces),
      });
      if (domainConflictError && domainConflict) {
        params.set('domainConflictError', domainConflictError.message);
        params.set('enterpriseJoinOrgName', domainConflict.name);
        params.set('enterpriseJoinWorkspaces', JSON.stringify(domainConflict.workspaces));
      }

      res.redirect(`${frontendUrl}?${params.toString()}`);
      return;
    } catch (error) {
      logger.error(`${tag()} Google OAuth login failed (platform=mobile):`, error);

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

      // The auth session being ended: the JWT's sid (xs is only sent to /auth/refresh-session).
      const sessionId = req.user?.sid;

      if (req.user && sessionId) {
        logger.info(`[${requestId}] Ending auth session for user ${req.user.email}`);
        trackLogout(req, req.user.id, sessionId, 'USER_LOGOUT');
        await getEncryptionProvider().revokeSessionKey(sessionId);
      }

      // Revoke the device's org-scoped auth session (by sid and/or member + device) and clear xs.
      await authSessionService.revokeOnLogout(req, res, { orgMemberId: req.user?.memberId, sessionId });

      // Clear all workspace-specific token cookies (session is now global)
      for (const cookieName of Object.keys(req.cookies || {})) {
        if (cookieName.startsWith(WORKSPACE_TOKEN_COOKIE_PREFIX) && cookieName.endsWith('_token')) {
          res.clearCookie(cookieName, { path: '/' });
        }
      }

      // Clear last workspace cookie
      res.clearCookie(LAST_WORKSPACE_COOKIE, { path: '/' });

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
    const platform = this.detectPlatform(req);
    try {
      const { workspaceId } = req.body;

      logger.info(`[LOGIN-WORKSPACE] Workspace login received (platform=${platform}, workspaceId=${workspaceId ?? 'MISSING'}, hasPendingCookie=${!!req.cookies?.[PENDING_AUTH_COOKIE]}, hasAuthSession=${!!req.cookies?.xs})`);

      if (!workspaceId) {
        logger.warn(`[LOGIN-WORKSPACE] Workspace login rejected (platform=${platform}, reason=missing_workspaceId)`);
        res.status(400).json({
          error: 'Missing required fields',
          message: 'workspaceId is required'
        });
        return;
      }

      // Get pending auth data from cookie (for normal OAuth flow)
      const pendingAuthCookie = req.cookies?.[PENDING_AUTH_COOKIE];

      let oauthUserData: { email: string; name: string; googleId?: string; providerUserId?: string; picture?: string };
      let provider: string;
      let pendingRefreshToken: string | undefined;
      let pendingAccessToken: string | undefined;
      let pendingAccessTokenExpiry: Date | undefined;
      let pendingTokenKey: string | undefined;

      if (pendingAuthCookie) {
        const parsed = await this.parsePendingAuthCookie(pendingAuthCookie);
        if (!parsed) {
          logger.warn(`[LOGIN-WORKSPACE] Workspace login rejected (platform=${platform}, reason=invalid_pending_auth)`);
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
          logger.warn(`[LOGIN-WORKSPACE] Workspace login rejected (platform=${platform}, reason=missing_provider_identity)`);
          res.status(401).json({
            error: 'Invalid auth data',
            message: 'Pending auth data is missing provider identity'
          });
          return;
        }
      } else {
        /**
         * ALREADY SIGNED IN: no pending-auth cookie, but a valid workspace JWT cookie
         * (xs is only sent to /auth/refresh-session). Happens when a signed-in user picks
         * another workspace. Identity comes from the org member; any workspace user row of
         * theirs carries the provider identity. An expired JWT is a 401 TOKEN_EXPIRED so the
         * client refreshes and retries.
         */
        const jwtRead = readWorkspaceJwt(req);
        if (jwtRead.status !== 'valid') {
          logger.warn(`[LOGIN-WORKSPACE] Workspace login rejected (platform=${platform}, reason=no_auth, jwt=${jwtRead.status})`);
          res.status(401).json({
            error: 'Unauthorized',
            code: jwtRead.status === 'expired' ? 'TOKEN_EXPIRED' : 'TOKEN_MISSING',
            message: 'Pending auth data not found or expired'
          });
          return;
        }
        if (jwtRead.payload.sid && (await authSessionService.isSessionRevoked(jwtRead.payload.sid))) {
          logger.warn(`[LOGIN-WORKSPACE] Workspace login rejected (platform=${platform}, reason=session_logged_out)`);
          res.status(401).json({
            error: 'Unauthorized',
            code: 'TOKEN_INVALID',
            message: 'Session has been logged out',
          });
          return;
        }
        const signedInMember = await this.prisma.orgMember.findUnique({
          where: { memberId: jwtRead.payload.memberId },
          select: { leftAt: true },
        });
        if (!signedInMember || signedInMember.leftAt) {
          logger.warn(`[LOGIN-WORKSPACE] Workspace login rejected (platform=${platform}, reason=${signedInMember ? 'org_member_left' : 'org_member_missing'})`);
          res.status(401).json({
            error: 'User removed from organization',
            message: 'You have been removed from this organization',
          });
          return;
        }
        logger.info(`[LOGIN-WORKSPACE] No pending auth cookie, but a signed-in member - using auto-login flow (platform=${platform})`);

        const identity = await this.prisma.user.findFirst({
          where: { orgMemberId: jwtRead.payload.memberId },
          orderBy: { createdAt: 'desc' },
          select: { email: true, name: true, providerUserId: true, picture: true, authProvider: true },
        });
        if (!identity) {
          logger.warn(`[LOGIN-WORKSPACE] Workspace login rejected (platform=${platform}, reason=session_invalid)`);
          res.status(401).json({
            error: 'Invalid session',
            message: 'Session not found or expired'
          });
          return;
        }
        if (!isEmailDomainAllowed(identity.email)) {
          logger.warn(`[LOGIN-WORKSPACE] Workspace login rejected (platform=${platform}, reason=email_domain_not_allowed)`);
          res.status(401).json({
            error: EMAIL_DOMAIN_NOT_ALLOWED_ERROR,
            message: EMAIL_DOMAIN_NOT_ALLOWED_MESSAGE,
          });
          return;
        }

        oauthUserData = {
          email: identity.email,
          name: identity.name || '',
          providerUserId: identity.providerUserId,
          picture: identity.picture || undefined,
        };
        provider = identity.authProvider || 'GOOGLE';
      }

      // Reaching here without a pending-auth cookie means the already-signed-in
      // branch above ran (the only other non-early-return path) — the user was
      // already signed in and this is a workspace pick, not a fresh sign-in.
      const isAutoLogin = !pendingAuthCookie;

      if (!oauthUserData?.email) {
        logger.warn(`[LOGIN-WORKSPACE] Workspace login rejected (platform=${platform}, reason=missing_user_data)`);
        res.status(401).json({
          error: 'Invalid auth data',
          message: 'User data missing from pending auth'
        });
        return;
      }

      logger.info(`[LOGIN-WORKSPACE] User ${oauthUserData.email} logging into workspace ${workspaceId} via ${provider} (platform=${platform})`);

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
        logger.warn(`[LOGIN-WORKSPACE] Workspace login rejected (platform=${platform}, provider=${provider}, workspaceId=${workspaceId}, reason=user_inactive)`);
        res.status(403).json({
          error: 'User inactive',
          message: 'Your account has been deactivated or you have left this workspace'
        });
        return;
      }

      // Ensure user presence for workspace-scoped user
      await this.userService.ensureUserPresence(workspaceUser.id, workspaceId);
      const selfDmChannelId = await this.ensureSelfDmForUser(workspaceUser.id, workspaceId);

      const workspace = await getWorkspaceLandingChannelData(workspaceId);

      // Auth session (xs) + JWT cookies; supersedes any session the callback auto-login issued.
      const login = await completeLogin(req, res, {
        user: { ...workspaceUser, workspaceId },
        loginMethod: isAutoLogin ? 'AUTO_LOGIN' : (provider as AuthProvider),
        providerTokens: {
          refreshToken: pendingRefreshToken,
          accessToken: pendingAccessToken,
          accessTokenExpiry: pendingAccessTokenExpiry,
        },
      });

      const isProduction = config.env === 'production';
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
      res.clearCookie(PENDING_AUTH_COOKIE, { path: '/' });
      logger.info(`[LOGIN-WORKSPACE] Workspace login succeeded (platform=${platform}, provider=${provider}, workspaceId=${workspaceId}, isNewUser=${isNewUser})`);
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
        accessTokenExpiresAt: login.accessToken.expiresAt,
      });
    } catch (error) {
      if (respondDeviceKeyRequired(res, error)) return;
      logger.error(`[LOGIN-WORKSPACE] Workspace login failed (platform=${platform}):`, error);
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
      const pendingAuthCookie = req.cookies?.[PENDING_AUTH_COOKIE];
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

      const workspaceRecord = await getWorkspaceLandingChannelData(workspace.id);

      await completeLogin(req, res, {
        user: { ...workspaceUser, workspaceId: workspace.id },
        orgId: organization.orgId,
        loginMethod: provider as AuthProvider,
        providerTokens: { refreshToken: pendingRefreshToken },
      });

      const isProduction = config.env === 'production';
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
      res.clearCookie(PENDING_AUTH_COOKIE, { path: '/' });

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
      if (respondDeviceKeyRequired(res, error)) return;
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

      // The org-level auth session is reused across workspaces: the switch only mints a JWT
      // for the target workspace user under the same sid, capped by the session's expiry.
      const session = currentUser.sid
        ? await authSessionService.findActiveById(currentUser.sid, currentUser.memberId)
        : null;
      if (!session) {
        logger.warn(`[SWITCH-WORKSPACE] No valid auth session for workspace switch`);
        res.status(401).json({
          error: 'Session expired',
          code: 'REFRESH_INVALID',
          message: 'Please re-authenticate',
        });
        return;
      }

      // Switching workspaces is inherently cross-tenant: everything below acts on the
      // TARGET workspace while the ambient session context is still the caller's current
      // (old) one — the per-model ACLs' "must match your current workspace" rule can never
      // be satisfied by definition. Safe to bypass because every lookup here is keyed off
      // `currentUser.email` (the caller's own verified session), never attacker-supplied —
      // this can only ever act on the caller's own identity in the target workspace.
      const data = await switchWorkspaceData(currentUser.email, workspaceId);
      if (!data) {
        res.status(403).json({
          error: 'Forbidden',
          message: 'You do not have access to this workspace',
        });
        return;
      }
      const { targetUser, selfDmChannelId, workspace } = data;

      const minted = issueAccessCookies(res, {
        user: { ...targetUser, workspaceId },
        sessionId: session.id,
        refreshTokenExpiry: session.refreshTokenExpiry,
      });

      // Stamp the entered workspace on the auth session; never fails the switch.
      await authSessionService.recordWorkspaceAccessById(session.id, workspaceId);

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
        accessTokenExpiresAt: minted.expiresAt,
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
      const pendingAuthCookie = req.cookies?.[PENDING_AUTH_COOKIE];
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

        const { workspaceName, workspaceType } = req.body as {
          workspaceName?: string;
          workspaceType?: string;
        };

        if (!workspaceName) {
          res.status(400).json({ error: 'Missing required fields', message: 'workspaceName is required' });
          return;
        }
        if (workspaceType && workspaceType !== WorkspaceType.ENTERPRISE) {
          res.status(400).json({ error: 'Invalid workspace type', message: 'workspaceType must be ENTERPRISE' });
          return;
        }

        logger.info(`[CREATE-WORKSPACE-PENDING] User ${oauthUserData.email} creating workspace "${workspaceName}" via ${provider}`);

        // The pending-auth cookie is a plain string — normalize it into the enum
        // we persist on the User row so a Microsoft login is not saved as GOOGLE.
        const normalizedProvider = provider?.toUpperCase();
        const signUpProvider =
          normalizedProvider === 'MICROSOFT'
            ? AuthProvider.MICROSOFT
            : normalizedProvider === 'EMAIL'
              ? AuthProvider.EMAIL
              : AuthProvider.GOOGLE;

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
          { userId: '', providerUserId: userData.providerUserId, email: userData.email, name: userData.name, picture: userData.picture, authProvider: signUpProvider },
          workspaceName,
        );

        await this.userService.ensureUserPresence(workspaceUser.id, workspace.id);
        const selfDmChannelId = await this.ensureSelfDmForUser(workspaceUser.id, workspace.id);

        const workspaceRecord = await getWorkspaceLandingChannelData(workspace.id);

        await completeLogin(req, res, {
          user: { ...workspaceUser, workspaceId: workspace.id },
          orgId: organization.orgId,
          loginMethod: signUpProvider,
          providerTokens: { refreshToken: pendingRefreshToken },
        });

        const isProduction = config.env === 'production';
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
        res.clearCookie(PENDING_AUTH_COOKIE, { path: '/' });

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
      if (respondDeviceKeyRequired(res, error)) return;
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
      const { workspaceName, workspaceType } = req.body as {
        workspaceName?: string;
        workspaceType?: string;
      };
      if (!workspaceName) {
        res.status(400).json({ error: 'Missing required fields', message: 'workspaceName is required' });
        return;
      }
      if (workspaceType && workspaceType !== WorkspaceType.ENTERPRISE) {
        res.status(400).json({ error: 'Invalid workspace type', message: 'workspaceType must be ENTERPRISE' });
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
        { userId: fullUser.id, providerUserId: fullUser.providerUserId, email: fullUser.email, name: fullUser.name, picture: fullUser.picture, authProvider: fullUser.authProvider as AuthProvider },
        workspaceName,
      );

      await this.userService.ensureUserPresence(workspaceUser.id, workspace.id);
      const selfDmChannelId = await this.ensureSelfDmForUser(workspaceUser.id, workspace.id);

      const workspaceRecord = await getWorkspaceLandingChannelData(workspace.id);

      // Already signed in: keep the org-level auth session, mint a JWT for the new workspace.
      const session = currentUser.sid
        ? await authSessionService.findActiveById(currentUser.sid, currentUser.memberId)
        : null;
      if (!session) {
        logger.warn('[CREATE-WORKSPACE-AUTH] No valid auth session; workspace created but no token issued');
        res.status(401).json({
          error: 'Session expired',
          code: 'REFRESH_INVALID',
          message: 'Please re-authenticate',
        });
        return;
      }
      issueAccessCookies(res, {
        user: { ...workspaceUser, workspaceId: workspace.id },
        sessionId: session.id,
        refreshTokenExpiry: session.refreshTokenExpiry,
      });
      await authSessionService.recordWorkspaceAccessById(session.id, workspace.id);

      const isProduction = config.env === 'production';
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
   * Parses and verifies the xyne_pending_auth pending-auth cookie (signed JWT).
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
      const decoded = verifyPendingAuthToken(cookie);
      if (!decoded?.email) throw new Error('Invalid JWT payload');
      // A pending-auth cookie issued before the allowlist changed must not finish a sign-in.
      if (!isEmailDomainAllowed(decoded.email)) return null;

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
