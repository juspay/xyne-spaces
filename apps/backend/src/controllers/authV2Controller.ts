import { Request, Response } from 'express';
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';
import { logger } from '../utils/logger';
import { UserService } from '../services/userService';
import type { LoginMethod } from '../services/userSessionService';
import { oauthStateServiceV2 } from '../services/oauthStateServiceV2';
import { pkceServiceV2 } from '../services/pkceServiceV2';
import { MicrosoftAuthController } from './microsoftAuthController';
import { WorkspaceJoinPolicy, WorkspaceType, AuthProvider, UserStatus, OrgRole } from '@xyne/shared';
import type { WorkspaceJoinPolicy as WorkspaceJoinPolicyValue, WorkspaceType as WorkspaceTypeValue } from '@xyne/shared';

import '../types/express';
import { config } from '@/config/env';
import { DatabaseClient } from '@/database/client';
import { switchWorkspaceData, ensureSelfDmForUserData, getWorkspaceLandingChannelData } from '@/bypassAcl/authServices';
import { getEncryptionProvider } from '@/services/encryption';
import { getFrontendUrl, resolveConfiguredOAuthRedirectUrl } from '@/utils/publicUrls';
import {
  OrganizationDomainConflictError,
  PublicEmailDomainError,
  isOrganizationPolicyError,
  organizationDomainService,
} from '@/services/organizationDomainService';
import { migrateLegacyIdentity } from '@/services/legacyIdentityMigrationHelper';
import { randomUUID } from 'crypto';
import { completeLogin, existingSessionFromRequest } from '@/auth/loginCompletion';
import { applyResolvedAuth, resolveRequest } from '@/auth/sessionResolver';
import { issueRefresh, mintWorkspaceJwt } from '@/auth/sessionIssuer';
import { applyCookies, cookiesForLogout, wsTokenCookie } from '@/auth/sessionCookies';
import { readPendingAuth, setPendingAuthCookie } from '@/auth/pendingAuth';
import type { PendingAuthIdentity } from '@/auth/pendingAuth';
import { platformFromRequest } from '@/auth/platform';
import {
  LAST_WORKSPACE_COOKIE,
  LEGACY_SESSION_COOKIE,
  MAX_REFRESH_TOKENS_PER_SESSION,
  PENDING_AUTH_COOKIE,
  WORKSPACE_HEADER,
} from '@/auth/constants';
import type { CookieSameSite, ExistingSessionRef, ResolvedAuth } from '@/auth/types';
import { revokeByLegacySessionId, revokeSessionCascade } from '@/bypassAcl/authSessionServices';
import { recordRefreshSession } from '@/services/otel/authMetrics';

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
    orgMemberId: string | null;
    providerUserId: string;
    role: string;
  };
  /** The login row id in `workflow.user_sessions` (what `user_session_id` carries). */
  sessionId: string;
  isNewUser: boolean;
};

type GoogleUserData = { googleId: string; email: string; name: string; picture?: string };

/** Identity-only pending cookie payload for a Google login (no provider tokens). */
const googlePendingIdentity = (u: GoogleUserData): PendingAuthIdentity => ({
  googleId: u.googleId,
  providerUserId: u.googleId,
  email: u.email,
  name: u.name,
  picture: u.picture,
  provider: AuthProvider.GOOGLE,
});

/** Pending-cookie `provider` → LoginMethod (older cookies carried lowercase `microsoft`). */
const loginMethodForProvider = (provider: string): LoginMethod => provider.toUpperCase() as LoginMethod;

/** `ExistingSessionRef` for a request the controller resolved itself (no middleware ran). */
const existingSessionFromAuth = (auth: ResolvedAuth): ExistingSessionRef => ({
  sessionId: auth.session?.id ?? null,
  legacySessionId: auth.legacySessionId,
});

export class AuthV2Controller {
  private googleClient: OAuth2Client;
  private googleClientNew: OAuth2Client | null = null;
  private mobileGoogleClient: OAuth2Client;
  private userService: UserService;
  private microsoftAuthController: MicrosoftAuthController;
  private prisma = DatabaseClient.getInstance();

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
   * Creates the workspace user and completes the login (session + grant + cookies). The pending
   * identity cookie is NOT cleared here: loginWorkspace follows and consumes it.
   */
  private async performSingleWorkspaceAutoLogin(
    googleUserData: GoogleUserData,
    workspaceId: string,
    req: Request,
    res: Response,
    platform: 'web' | 'mobile' | 'electron',
    sameSite: CookieSameSite,
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

    const login = await completeLogin({
      req,
      res,
      workspaceUser,
      loginMethod: AuthProvider.GOOGLE,
      platform,
      sameSite,
      isNewUser,
    });

    return { workspaceUser, sessionId: login.legacySessionId, isNewUser };
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
    const flowId = randomUUID();

    try {
      logger.info(`${authTag(flowId)} Google OAuth login initiated`);

      const platformQuery = req.query.platform as 'electron' | 'web' | 'mobile';
      const platform = platformQuery || this.detectPlatform(req);
      logger.info(`${authTag(flowId)} Platform detected: ${platform}`);

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
        flowId,
      );

      await pkceServiceV2.storeVerifier(state, codeVerifier);

      const redirectUri = this.getGoogleRedirectUri(req);

      logger.info(`${authTag(flowId)} Redirect URI: ${redirectUri}`);

      // Identity only: no access_type=offline / prompt=consent, so Google never issues a
      // refresh token (nothing is stored or verified server-side any more).
      const authUrl = this.getGoogleClient(isNy).generateAuthUrl({
        scope: ['openid', 'email', 'profile'],
        prompt: 'select_account',
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

      const { id_token } = tokens;

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
        audience: stateData.isNy ? process.env.GOOGLE_CLIENT_ID_NEW : process.env.GOOGLE_CLIENT_ID,
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

      const workspaces = this.getEnterpriseAwareWorkspaces(
        await this.userService.getWorkspacesByEmail(googleUserData.email),
        stateData.enterpriseLogin,
      );
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
      let publicEmailError = null;

      if (workspaces.length === 0 && !userExistsButRemoved) {
        // Public email domains can never create enterprise workspaces — the only
        // path forward for a workspace-less user without a pending community join
        // or invitation — so fail fast on them regardless of the entry flow. The
        // remaining domain-conflict assert stays gated on the explicit
        // enterprise intent.
        try {
          await organizationDomainService.assertNotPublicEmailDomain(googleUserData.email);
        } catch (error) {
          if (error instanceof PublicEmailDomainError) {
            publicEmailError = error;
          }
        }

        if (stateData.enterpriseLogin && !publicEmailError) {
          try {
            await organizationDomainService.assertCanCreateOrgForEmail(googleUserData.email);
          } catch (error) {
            if (error instanceof OrganizationDomainConflictError) {
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

      // Pending identity cookie (10 min window, identity only — no provider tokens).
      setPendingAuthCookie(res, googlePendingIdentity(googleUserData), 'strict');

      const frontendUrl = stateData.redirectTo ?? getFrontendUrl(req);

      // If an invitation is pending, redirect back to the invite page for explicit acceptance.
      // The google_access_token cookie (set above) carries identity for acceptInvitation + loginWorkspace.
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
        logger.info(`${tag()} Single workspace detected - auto-logging in to ${workspaceId}`);

        // NOTE: sameSite must be 'lax' (not 'strict') for OAuth callback
        // because the redirect comes from Google (cross-site navigation)
        await this.performSingleWorkspaceAutoLogin(googleUserData, workspaceId, req, res, 'web', 'lax');

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
      if (publicEmailError) {
        params.set('publicEmailDomainError', publicEmailError.message);
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

  refreshSession = async (req: Request, res: Response): Promise<void> => {
    const requestId = `REFRESH_${Date.now()}`;
    const headerHint = req.headers[WORKSPACE_HEADER];
    const hint =
      (Array.isArray(headerHint) ? headerHint[0] : headerHint) ||
      (req.cookies?.[LAST_WORKSPACE_COOKIE] as string | undefined) ||
      undefined;
    // Claw forges `user_session_id` and sends neither hint; everything else is a client.
    const caller: 'claw_like' | 'client' =
      !hint && !!req.cookies?.[LEGACY_SESSION_COOKIE] ? 'claw_like' : 'client';
    const record = (outcome: 'ok' | 'fail', tokensMinted: number): void =>
      recordRefreshSession({ hasWorkspaceHint: !!hint, caller, outcome, tokensMinted });

    try {
      logger.info(`[${requestId}] Refresh session endpoint called`);

      // Session path only (no Bearer): `refresh-endpoint` mode returns the session without
      // requiring a grant when no hint is present, so a token can be minted per grant.
      const result = await resolveRequest(req, {
        allowBearer: false,
        allowAutoRefresh: true,
        mode: 'refresh-endpoint',
      });

      if (!result.ok) {
        logger.warn(`[${requestId}] Session refresh rejected (reason=${result.reason})`);
        record('fail', 0);
        res.status(result.status).json(result.body);
        return;
      }

      const auth = result.auth;
      logger.info(`[${requestId}] Session found for user: ${auth.user.email} (path=${auth.path})`);

      const isProduction = process.env.NODE_ENV === 'production';
      const workspaces: Array<{ workspaceId: string }> = [];

      if (auth.refreshed) {
        // With a hint (or a legacy session) the resolver already minted the token; its
        // cookies carry it. Never writes xyne_last_workspace.
        applyResolvedAuth(req, res, auth);
        workspaces.push({ workspaceId: auth.workspaceId });
      } else if (auth.session) {
        // v3 session without a hint: one `xyne_ws_<ws>_token` per active grant (capped);
        // claw picks the cookie by name.
        const now = new Date();
        const grants = auth.session.grants
          .filter((g) => !g.revokedAt && (!g.expiresAt || g.expiresAt > now))
          .slice(0, MAX_REFRESH_TOKENS_PER_SESSION);
        const refreshed = await issueRefresh({
          session: auth.session,
          grants,
          hint,
          sameSite: 'strict',
          path: auth.path,
        });
        applyCookies(res, refreshed.cookies);
        for (const t of refreshed.tokens) workspaces.push({ workspaceId: t.workspaceId });
      } else {
        // Legacy session whose JWT was still valid: today's behaviour, a single workspace
        // token for the session's workspace.
        const legacyUser = auth.legacySession?.user;
        const jwt = mintWorkspaceJwt({
          user: legacyUser ?? {
            id: auth.user.id,
            email: auth.user.email,
            name: auth.user.name,
            picture: null,
            providerUserId: auth.user.googleId,
            authProvider: auth.user.authProvider ?? AuthProvider.GOOGLE,
          },
          memberId: auth.user.memberId,
          workspaceId: auth.workspaceId,
          lsid: auth.legacySessionId ?? undefined,
        });
        applyCookies(res, [
          wsTokenCookie(auth.workspaceId, jwt, config.jwt.expirationSeconds, {
            sameSite: 'strict',
            secure: isProduction,
          }),
        ]);
        workspaces.push({ workspaceId: auth.workspaceId });
      }

      logger.info(`[${requestId}] New JWT cookie set for user: ${auth.user.email} (tokens=${workspaces.length})`);
      record('ok', workspaces.length);

      res.status(200).json({
        success: true,
        message: 'Session refreshed successfully',
        workspaces,
      });
    } catch (error) {
      logger.error(`[${requestId}] Error refreshing session:`, error);
      record('fail', 0);

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

      const codeVerifier = await pkceServiceV2.getAndDeleteVerifier(state);
      if (!codeVerifier) {
        logger.error(`${tag()} PKCE verifier not found`);
        res.status(401).json({
          error: 'PKCE verification failed',
          message: 'Code verifier not found or expired',
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

      const { id_token } = tokens;

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
        audience: stateData.isNy ? process.env.GOOGLE_CLIENT_ID_NEW : process.env.GOOGLE_CLIENT_ID,
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

      const workspaces = this.getEnterpriseAwareWorkspaces(
        await this.userService.getWorkspacesByEmail(googleUserData.email),
        stateData.enterpriseLogin,
      );
      logger.info(`${tag()} User has ${workspaces.length} workspace(s) before invitation check`);
      const userExistsButRemoved = await this.userService.userExistsButNoActiveWorkspaces(googleUserData.email);

      // Domain-conflict detection, mirroring handleCallback. Without it the Electron renderer
      // receives workspaces: [] for a user whose email domain already maps to an enterprise org
      // and offers "create an organization" instead of the request-to-join UI.
      let domainConflict = null;
      let domainConflictError = null;
      let publicEmailError = null;

      if (workspaces.length === 0 && !userExistsButRemoved) {
        // Public email domains can never create enterprise workspaces, so fail fast
        // on them regardless of the entry flow (mirrors handleCallback). The
        // remaining domain-conflict assert stays gated on the explicit
        // enterprise intent.
        try {
          await organizationDomainService.assertNotPublicEmailDomain(googleUserData.email);
        } catch (error) {
          if (error instanceof PublicEmailDomainError) {
            publicEmailError = error;
          }
        }

        if (stateData.enterpriseLogin && !publicEmailError) {
          try {
            await organizationDomainService.assertCanCreateOrgForEmail(googleUserData.email);
          } catch (error) {
            if (error instanceof OrganizationDomainConflictError) {
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

      // If an invitation is pending: set the pending identity cookie so the Electron renderer can
      // later call acceptInvitation + loginWorkspace, then return a hasInvitation signal. The
      // renderer will navigate to /invite?loginComplete=true inside the app — no browser involvement.
      const effectiveInvitationId = stateData.invitationId || invitationId;
      if (effectiveInvitationId) {
        logger.info(`${tag()} Google OAuth login succeeded (platform=electron, outcome=pending_invitation, invitationId=${effectiveInvitationId})`);
        setPendingAuthCookie(res, googlePendingIdentity(googleUserData), 'strict');
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

        // Electron's own session store: sameSite=strict.
        await this.performSingleWorkspaceAutoLogin(googleUserData, workspaceId, req, res, 'electron', 'strict');

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

      // Store pending identity for the later loginWorkspace/createOrg call (multi-workspace case)
      setPendingAuthCookie(res, googlePendingIdentity(googleUserData), 'strict');

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
        ...(publicEmailError ? { publicEmailDomainError: publicEmailError.message } : {}),
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

      const { id_token } = tokens;

      if (!id_token) {
        logger.error(`${tag()} No ID token received`);
        sendError('no_id_token', 'No ID token received', 500);
        return;
      }

      logger.info(`${tag()} Verifying ID token`);
      const ticket = await this.mobileGoogleClient.verifyIdToken({
        idToken: id_token,
        // Accept both web and iOS client IDs
        audience: [process.env.GOOGLE_MOBILE_CLIENT_ID!, process.env.GOOGLE_IOS_CLIENT_ID!].filter(
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

      const workspaces = this.getEnterpriseAwareWorkspaces(
        await this.userService.getWorkspacesByEmail(googleUserData.email),
        enterpriseLogin,
      );
      logger.info(`${tag()} User has ${workspaces.length} workspace(s) before invitation check`);
      const userExistsButRemoved = await this.userService.userExistsButNoActiveWorkspaces(googleUserData.email);

      // Domain-conflict detection, mirroring handleCallback. Without it the mobile client
      // receives workspaces: [] for a user whose email domain already maps to an enterprise org
      // and offers "create an organization" instead of the request-to-join UI.
      let domainConflict = null;
      let domainConflictError = null;
      let publicEmailError = null;

      if (workspaces.length === 0 && !userExistsButRemoved) {
        if (enterpriseLogin) {
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

      // Pending identity cookie (identity only, no provider tokens). Native needs
      // sameSite=none (secure is forced by the helper); the web branch keeps strict.
      setPendingAuthCookie(res, googlePendingIdentity(googleUserData), isMobileNative ? 'none' : 'strict');
      logger.info(`${tag()} Stored pending auth data for workspace selection`);

      /**
       * AUTO-LOGIN SINGLE WORKSPACE USERS (Mobile)
       * Mirrors web behavior exactly - auto-login when user has exactly 1 workspace
       */
      if (isMobileNative && workspaces.length === 1) {
        const workspaceId = workspaces[0]!.id;
        logger.info(`${tag()} Single workspace detected - auto-logging in to ${workspaceId}`);

        // Native shell: sameSite=none (secure forced). The shell reads `sessionId` from the
        // body and injects `user_session_id` itself.
        const { workspaceUser, sessionId } = await this.performSingleWorkspaceAutoLogin(
          googleUserData,
          workspaceId,
          req,
          res,
          'mobile',
          'none',
        );

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
          ...(publicEmailError ? { publicEmailDomainError: publicEmailError.message } : {}),
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
      if (publicEmailError) {
        params.set('publicEmailDomainError', publicEmailError.message);
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

      // Every legacy row id we learn about gets its encryption key revoked (best-effort).
      const legacyIds = new Set<string>();
      const cookieLegacyId = req.cookies?.[LEGACY_SESSION_COOKIE] as string | undefined;
      if (cookieLegacyId) legacyIds.add(cookieLegacyId);
      if (req.authSession?.legacySessionId) legacyIds.add(req.authSession.legacySessionId);

      // Resolve (session path, no Bearer) to find the account session behind the cookies even
      // when the JWT has expired. Nothing it minted is applied — the cookies are cleared below.
      const resolved = await resolveRequest(req, { allowBearer: false, allowAutoRefresh: true }).catch(
        (err: unknown) => {
          logger.warn(`[${requestId}] Session resolve failed during logout: ${err instanceof Error ? err.message : String(err)}`);
          return null;
        },
      );

      const sessionId = req.authSession?.sessionId ?? (resolved?.ok ? resolved.auth.session?.id ?? null : null);
      const legacySessionId = resolved?.ok ? resolved.auth.legacySessionId : null;
      if (legacySessionId) legacyIds.add(legacySessionId);
      if (resolved?.ok && resolved.auth.session) {
        for (const grant of resolved.auth.session.grants) {
          if (grant.legacySessionId) legacyIds.add(grant.legacySessionId);
        }
        if (resolved.auth.session.legacySessionId) legacyIds.add(resolved.auth.session.legacySessionId);
      }

      // Both revoke paths emit auth_session_revoked_total themselves (bypassAcl/authSessionServices).
      if (sessionId) {
        logger.info(`[${requestId}] Revoking account session for user ${req.user?.email}`);
        await revokeSessionCascade(sessionId, 'USER_LOGOUT');
      } else {
        const legacyId = legacySessionId ?? cookieLegacyId;
        if (legacyId) {
          // Cascades through the mapped account session when the row was dual-written
          // (e.g. READ_MODE=legacy), else revokes the single legacy row.
          logger.info(`[${requestId}] Revoking session for user ${req.user?.email}`);
          await revokeByLegacySessionId(legacyId, 'USER_LOGOUT');
        }
      }

      for (const legacyId of legacyIds) {
        await getEncryptionProvider()
          .revokeSessionKey(legacyId)
          .catch((err: unknown) =>
            logger.warn(`[${requestId}] Session key revoke failed: ${err instanceof Error ? err.message : String(err)}`),
          );
      }

      // Clear every auth cookie the request carried plus the fixed set (xyne_session,
      // user_session_id, xyne_last_workspace, pending cookie, every xyne_ws_*_token).
      // Still 200 when the cookies were already gone.
      applyCookies(res, cookiesForLogout(Object.keys(req.cookies ?? {})));

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

      logger.info(`[LOGIN-WORKSPACE] Workspace login received (platform=${platform}, workspaceId=${workspaceId ?? 'MISSING'}, hasPendingCookie=${!!req.cookies?.[PENDING_AUTH_COOKIE]}, hasSession=${!!req.cookies?.[LEGACY_SESSION_COOKIE]})`);

      if (!workspaceId) {
        logger.warn(`[LOGIN-WORKSPACE] Workspace login rejected (platform=${platform}, reason=missing_workspaceId)`);
        res.status(400).json({
          error: 'Missing required fields',
          message: 'workspaceId is required'
        });
        return;
      }

      let oauthUserData: { email: string; name: string; googleId?: string; providerUserId?: string; picture?: string };
      let provider: string;
      // Set when the caller was already signed in: the login adds a grant to that session.
      let existingSession: ExistingSessionRef | null = null;

      const pendingAuthCookie = req.cookies?.[PENDING_AUTH_COOKIE];
      if (pendingAuthCookie) {
        // Pending identity cookie (normal OAuth / email flow). Identity only.
        const pending = readPendingAuth(req);
        if (!pending) {
          logger.warn(`[LOGIN-WORKSPACE] Workspace login rejected (platform=${platform}, reason=invalid_pending_auth)`);
          res.status(401).json({
            error: 'Invalid auth data',
            message: 'Pending auth data is corrupted or expired'
          });
          return;
        }

        const hasProviderIdentity = !!(pending.providerUserId || pending.googleId);
        if (!hasProviderIdentity) {
          logger.warn(`[LOGIN-WORKSPACE] Workspace login rejected (platform=${platform}, reason=missing_provider_identity)`);
          res.status(401).json({
            error: 'Invalid auth data',
            message: 'Pending auth data is missing provider identity'
          });
          return;
        }
        oauthUserData = {
          email: pending.email,
          name: pending.name,
          googleId: pending.googleId,
          providerUserId: pending.providerUserId,
          picture: pending.picture,
        };
        provider = pending.provider;
      } else {
        /**
         * AUTO-LOGIN FLOW: Use existing session (cookies already set)
         * This happens when user is auto-logged in to single workspace
         */
        const resolved = await resolveRequest(req, { allowBearer: false, allowAutoRefresh: true });
        if (!resolved.ok) {
          if (resolved.reason === 'no_credentials') {
            logger.warn(`[LOGIN-WORKSPACE] Workspace login rejected (platform=${platform}, reason=no_auth)`);
            res.status(401).json({
              error: 'Unauthorized',
              message: 'Pending auth data not found or expired'
            });
            return;
          }
          logger.warn(`[LOGIN-WORKSPACE] Workspace login rejected (platform=${platform}, reason=session_invalid, resolver=${resolved.reason})`);
          res.status(401).json({
            error: 'Invalid session',
            message: 'Session not found or expired'
          });
          return;
        }
        const auth = resolved.auth;
        logger.info(`[LOGIN-WORKSPACE] No pending auth cookie, but session ${auth.legacySessionId ?? auth.session?.id ?? 'unknown'} found - using auto-login flow (platform=${platform})`);

        // The resolver's view of the user carries no picture; the row behind the session does.
        const sessionUser = auth.legacySession?.user ?? (await this.userService.getUserById(auth.user.id));
        oauthUserData = {
          email: auth.user.email,
          name: auth.user.name || '',
          providerUserId: auth.user.googleId,
          picture: sessionUser?.picture || undefined,
        };
        provider = auth.user.authProvider || AuthProvider.GOOGLE;
        existingSession = existingSessionFromAuth(auth);
      }

      // Reaching here without a pending-auth cookie means the existing-session
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

      // Session + grant + cookies (+ onboarding cookie, + pending cookie clear). An existing
      // session gets a grant for this workspace instead of a second login; failures propagate.
      await completeLogin({
        req,
        res,
        workspaceUser,
        loginMethod: isAutoLogin ? 'AUTO_LOGIN' : loginMethodForProvider(provider),
        platform,
        sameSite: 'strict',
        isNewUser,
        existingSession,
        pending: !isAutoLogin,
      });
      logger.info(`[LOGIN-WORKSPACE] Session created`);
      if (isNewUser) {
        logger.info(`[LOGIN-WORKSPACE] Set is_new_user cookie for new user: ${workspaceUser.email}`);
      }

      const orgRole = workspaceUser.orgMemberId
        ? (await this.userService.getOrgRole(workspaceUser.orgMemberId)) ?? ''
        : '';

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
      });
    } catch (error) {
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

      // Get pending identity from cookie
      if (!req.cookies?.[PENDING_AUTH_COOKIE]) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Pending auth data not found or expired'
        });
        return;
      }

      const oauthUserData = readPendingAuth(req);
      if (!oauthUserData) {
        res.status(401).json({
          error: 'Invalid auth data',
          message: 'Pending auth data is corrupted or expired'
        });
        return;
      }
      const provider = oauthUserData.provider;

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

      // Session + grant + cookies (+ onboarding cookie for 24h, + pending cookie clear).
      await completeLogin({
        req,
        res,
        workspaceUser,
        loginMethod: loginMethodForProvider(provider),
        platform: platformFromRequest(req),
        sameSite: 'strict',
        isNewUser,
        pending: true,
        onboardingMaxAgeMs: 24 * 60 * 60 * 1000,
      });
      logger.info(`[CREATE-ORG] Session created`);

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
      const data = await switchWorkspaceData(currentUser.email, workspaceId);
      if (!data) {
        res.status(403).json({
          error: 'Forbidden',
          message: 'You do not have access to this workspace',
        });
        return;
      }
      const { targetUser, selfDmChannelId, workspace } = data;

      // The switch adds a grant (+ legacy row) to the caller's existing session rather than
      // minting a second login; `user_session_id` is left as the login row. Writes the target
      // workspace token and the hint. Session failures propagate.
      const existingSession = existingSessionFromRequest(req);
      if (!existingSession?.sessionId && !existingSession?.legacySessionId) {
        logger.warn(`[SWITCH-WORKSPACE] No valid session found for workspace switch`);
      } else {
        logger.info(`[SWITCH-WORKSPACE] Reusing existing session: ${existingSession.sessionId ?? existingSession.legacySessionId}`);
      }
      const login = await completeLogin({
        req,
        res,
        workspaceUser: targetUser,
        loginMethod: 'WORKSPACE_SWITCH',
        platform: platformFromRequest(req),
        sameSite: 'strict',
        isNewUser: false,
        existingSession,
      });

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
        workspaceId: login.workspaceId,
        sessionId: login.legacySessionId,
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
      if (!req.cookies?.[PENDING_AUTH_COOKIE]) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Pending auth data not found or expired'
        });
        return;
      }

      const oauthUserData = readPendingAuth(req);
      if (!oauthUserData) {
        res.status(401).json({
          error: 'Invalid auth data',
          message: 'Pending auth data is corrupted or expired'
        });
        return;
      }
      const provider = oauthUserData.provider;
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

        const workspaceRecord = await getWorkspaceLandingChannelData(workspace.id);

        const isNewUser = !(await this.userService.hasCompletedOnboarding(userData.email));

        // Session + grant + cookies (+ onboarding cookie for 24h, + pending cookie clear).
        await completeLogin({
          req,
          res,
          workspaceUser,
          loginMethod: loginMethodForProvider(provider),
          platform: platformFromRequest(req),
          sameSite: 'strict',
          isNewUser,
          pending: true,
          onboardingMaxAgeMs: 24 * 60 * 60 * 1000,
        });

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

      const workspaceRecord = await getWorkspaceLandingChannelData(workspace.id);

      const isNewUser = !(await this.userService.hasCompletedOnboarding(fullUser.email));

      // Already signed in — a grant (+ legacy row) on the existing session for the workspace
      // they just created, never a second login row cloning the session's refresh token.
      await completeLogin({
        req,
        res,
        workspaceUser,
        loginMethod: 'WORKSPACE_CREATED',
        platform: platformFromRequest(req),
        sameSite: 'strict',
        isNewUser,
        existingSession: existingSessionFromRequest(req),
        onboardingMaxAgeMs: 24 * 60 * 60 * 1000,
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
}
