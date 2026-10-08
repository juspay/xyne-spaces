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
import { ensureSelfDmForUserData, getWorkspaceLandingChannelData } from '@/bypassAcl/authServices';
import { adoptDeviceKey, findMembership, findOrgMember } from '@/bypassAcl/authSessionServices';
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
import { completeLogin, logoutSession } from '@/auth/loginCompletion';
import { readPendingAuth, setPendingAuthCookie, type PendingAuthIdentity } from '@/auth/pendingAuth';
import { platformFromRequest, responsePlatform, sameSiteFor, toSessionPlatform } from '@/auth/platform';
import { failure, grantWorkspaceForRequest, resolveSessionFromRequest } from '@/auth/sessionResolver';
import { applyCookies } from '@/auth/sessionCookies';
import { getClientSessionFingerprint } from '@/auth/sessionTokens';
import { deviceIdFromHeaders } from '@/auth/deviceKey';
import { PENDING_AUTH_COOKIE } from '@/auth/constants';
import { recordAuthResolve } from '@/services/otel/authMetrics';
import type {
  CompleteLoginResult,
  CookieSameSite,
  MembershipUser,
  OrgMemberRef,
  RequestPlatform,
} from '@/auth/types';

const authTag = (flowId: string): string => `[AUTH][flow=${flowId}]`;

const workspaceOutcome = (count: number): string =>
  count === 0 ? 'no_workspace' : count === 1 ? 'single_workspace' : 'multi_workspace';

/**
 * Request-supplied id for a log field: clamped so an oversized body value cannot bloat the log,
 * and only ever passed as structured metadata (never interpolated into the message).
 */
const logSafeId = (value: unknown): string =>
  typeof value === 'string' ? value.slice(0, 64) : value === undefined || value === null ? 'MISSING' : 'INVALID';

/**
 * Result of a single-workspace auto-login: the workspace user plus the completed session login.
 */
type AutoLoginResult = {
  workspaceUser: MembershipUser;
  login: CompleteLoginResult;
  isNewUser: boolean;
};

const ONBOARDING_COOKIE_ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Non-web clients (mobile, Electron) read these from JSON instead of a cookie jar: `sessionId`
 * is the opaque `xs1_` session token (legacy key name kept for the mobile builds), `token` the
 * workspace JWT. Web gets neither — the browser holds them as the httpOnly `xs` / `xw_<ws>` cookies.
 */
const nonWebAuthFields = (login: CompleteLoginResult): { sessionId?: string | null; token?: string } =>
  // `responsePlatform`, not the row's platform: a session row can say MOBILE because a legacy user
  // agent contained "Mobile", and handing the opaque session token to a mobile BROWSER in a readable
  // JSON body would undo httpOnly. Native clients announce themselves with `x-platform`.
  login.responsePlatform === 'WEB' ? {} : { sessionId: login.sessionToken, token: login.token };

/** Pending (pre-workspace) identity for the `google_access_token` cookie. Identity only, never tokens. */
const pendingIdentityFromGoogle = (g: { googleId: string; email: string; name: string; picture?: string }): PendingAuthIdentity => ({
  email: g.email,
  name: g.name,
  picture: g.picture,
  provider: AuthProvider.GOOGLE,
  providerUserId: g.googleId,
});

/**
 * SameSite for cookies written outside the OAuth redirect: the mobile jar needs `none`, else
 * `strict`. Routed through `responsePlatform` for the same reason as `nonWebAuthFields` — a
 * session whose stored platform is MOBILE but whose caller is a plain browser must not be handed
 * cross-site cookies.
 */
const sameSiteForLogin = (req: Request, platform: RequestPlatform): CookieSameSite =>
  sameSiteFor(responsePlatform(req, req.authSession?.platform ?? toSessionPlatform(platform)));

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
   * Performs single-workspace auto-login (core logic shared across web, mobile, electron):
   * creates/gets the workspace user and completes the login (session row, cookies, workspace JWT).
   */
  private async performSingleWorkspaceAutoLogin(
    googleUserData: {
      googleId: string;
      email: string;
      name: string;
      picture?: string;
    },
    workspaceId: string,
    req: Request,
    res: Response,
    platform: RequestPlatform
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

    const orgMember = await this.orgMemberFor(workspaceUser.orgMemberId);
    if (!orgMember) {
      throw new Error('Organization membership not found for user');
    }

    // sameSite=lax on web: the OAuth callback is a cross-site navigation from Google.
    const login = await completeLogin({
      req,
      res,
      workspaceUser,
      orgMember,
      platform,
      loginMethod: AuthProvider.GOOGLE,
      sameSite: platform === 'web' ? 'lax' : platform === 'mobile' ? 'none' : 'strict',
      isNewUser,
    });

    return { workspaceUser, login, isNewUser };
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

  /** Org membership behind a workspace user (the session principal); null when missing or left. */
  private async orgMemberFor(memberId: string | null | undefined): Promise<OrgMemberRef | null> {
    if (!memberId) return null;
    const orgMember = await findOrgMember(memberId);
    return orgMember && !orgMember.leftAt ? orgMember : null;
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
      const platform = platformQuery || platformFromRequest(req);
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

      // Identity only (openid/email/profile), no offline access: provider refresh tokens are never
      // requested or stored. `select_account` lets multi-account users pick explicitly.
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

      // Pending identity (10 min) for loginWorkspace / createOrg / acceptInvitation. Identity only:
      // no provider tokens are requested or stored any more.
      setPendingAuthCookie(res, pendingIdentityFromGoogle(googleUserData), 'strict');

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

        // Issues the device session + cookies (`xs`, `xw_<ws>`, `xyne_last_workspace`).
        // sameSite=lax: the redirect comes from Google (cross-site navigation).
        await this.performSingleWorkspaceAutoLogin(googleUserData, workspaceId, req, res, 'web');

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

  /**
   * Explicit access-token refresh for every platform (the middleware also refreshes inline).
   * Resolves the opaque session (`xs`, legacy names still read), then hands it to the resolver's
   * shared workspace-grant step: workspace claim (`x-workspace-id`, fallback
   * `xyne_last_workspace`), membership check, `xw_<ws>` mint bound to the session (`sid`), and the
   * response cookies — including the legacy -> new switch-over set for a request that arrived on a
   * legacy credential, or the mirrored legacy set for an old mobile build under the version gate.
   * That step is the SAME code the auth middleware runs, so this endpoint and the inline refresh
   * can never disagree about what gets minted or which cookies change; it also owns the
   * `auth_resolve_total` / `auth_legacy_credential_total` accounting for everything it returns.
   *
   * The JWT is also returned in the body for clients that read JSON instead of a cookie jar
   * (mobile, Electron).
   *
   * What stays here is what the grant step does not own: when the client sends `x-device-id` and
   * it differs from the row's `deviceKey`, the row adopts it (Electron and mobile own a stable
   * device id; other ACTIVE rows holding that key are revoked by the repository).
   */
  refreshSession = async (req: Request, res: Response): Promise<void> => {
    const requestId = `REFRESH_${Date.now()}`;

    try {
      logger.info(`[${requestId}] Refresh session endpoint called`);

      const resolved = await resolveSessionFromRequest(req);
      if (!resolved.ok) {
        logger.warn(`[${requestId}] Session refresh rejected (reason=${resolved.reason})`);
        recordAuthResolve({ path: 'none', outcome: 'fail', reason: resolved.reason, middleware: 'refresh' });
        res.status(resolved.status).json(resolved.body);
        return;
      }
      const { session } = resolved.session;

      // Workspace hint, membership, mint and cookies all come from the resolver's grant step,
      // which also records the metrics and the switch-over log for both outcomes.
      const granted = await grantWorkspaceForRequest(req, resolved.session, { middleware: 'refresh' });
      if (!granted.ok) {
        logger.warn(`[${requestId}] Session refresh rejected (reason=${granted.reason}, sessionId=${session.id})`);
        res.status(granted.status).json(granted.body);
        return;
      }
      const { workspaceId, accessToken, cookies, legacyConversion } = granted.auth;
      const platform = session.platform;
      applyCookies(res, cookies);

      // Device adoption: a client that owns a stable device id (Electron clientSessionId, mobile
      // deviceRegistry) binds its session row to it; the repository revokes other rows on that key.
      const deviceId = deviceIdFromHeaders(req);
      if (deviceId && deviceId !== session.deviceKey) {
        const adopted = await adoptDeviceKey(session.id, session.accountId, deviceId);
        logger.info(`[${requestId}] Device key adopted from x-device-id (sessionId=${session.id}, adopted=${adopted})`, {
          sessionId: session.id,
          accountId: session.accountId,
          platform,
          adopted,
        });
      }

      logger.info(`[${requestId}] Access token refreshed (platform=${platform}, workspaceId=${workspaceId}, sessionId=${session.id}, legacyCredential=${!!legacyConversion})`);

      res.status(200).json({
        success: true,
        token: accessToken,
        workspaceId,
        sessionId: resolved.session.credential,
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
      // later call acceptInvitation + loginWorkspace, then return a hasInvitation signal. The renderer
      // will navigate to /invite?loginComplete=true inside the app — no browser involvement.
      const effectiveInvitationId = stateData.invitationId || invitationId;
      if (effectiveInvitationId) {
        logger.info(`${tag()} Google OAuth login succeeded (platform=electron, outcome=pending_invitation, invitationId=${effectiveInvitationId})`);
        setPendingAuthCookie(res, pendingIdentityFromGoogle(googleUserData), 'strict');
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

        // Issues the device session + the cookie set Electron reads from its jar
        // (`xs`, `xw_<ws>`, `xyne_last_workspace`), sameSite=strict.
        const { login } = await this.performSingleWorkspaceAutoLogin(googleUserData, workspaceId, req, res, 'electron');

        logger.info(`${tag()} Google OAuth login succeeded (platform=electron, outcome=${workspaceOutcome(workspaces.length)}, count=${workspaces.length})`);

        // Return JSON with workspaces (Electron expects this for renderer to handle)
        res.status(200).json({
          success: true,
          email: googleUserData.email,
          name: googleUserData.name,
          picture: googleUserData.picture,
          workspaces,
          userExistsButRemoved,
          workspaceId,
          ...nonWebAuthFields(login),
        });
        return;
      }

      // Pending identity for the later loginWorkspace/createOrg call (multi-workspace case)
      setPendingAuthCookie(res, pendingIdentityFromGoogle(googleUserData), 'strict');

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

      // Pending identity for workspace selection. The native jar needs sameSite=none (Secure is
      // forced by the helper); the browser-driven branch keeps strict.
      setPendingAuthCookie(res, pendingIdentityFromGoogle(googleUserData), isMobileNative ? 'none' : 'strict');
      logger.info(`${tag()} Stored pending auth data for workspace selection`);

      /**
       * AUTO-LOGIN SINGLE WORKSPACE USERS (Mobile)
       * Mirrors web behavior exactly - auto-login when user has exactly 1 workspace
       */
      if (isMobileNative && workspaces.length === 1) {
        const workspaceId = workspaces[0]!.id;
        logger.info(`${tag()} Single workspace detected - auto-logging in to ${workspaceId}`);

        // Issues the device session + the cookie set the mobile builds read from their jar
        // (`xs`, `xw_<ws>`, `xyne_last_workspace`; old builds under the version gate also get
        // the legacy names), sameSite=none.
        const { workspaceUser, login } = await this.performSingleWorkspaceAutoLogin(googleUserData, workspaceId, req, res, 'mobile');

        logger.info(`${tag()} Google OAuth login succeeded (platform=mobile, outcome=${workspaceOutcome(workspaces.length)}, count=${workspaces.length})`);

        // Return JSON instead of redirect (mobile expects this). `sessionId` is the opaque
        // session token (same value as the `xs` cookie), `token` the workspace JWT.
        res.status(200).json({
          success: true,
          sessionId: login.sessionToken,
          token: login.token,
          workspaceId,
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

      // The encryption key store is keyed by the client fingerprint; read it before the cookies go.
      const fingerprint = getClientSessionFingerprint(req);

      // Revokes the device session (auth_sessions) and clears every auth cookie (never `xd`).
      const { sessionId } = await logoutSession(req, res, 'USER_LOGOUT');
      if (sessionId) {
        // Email is request-derived (JWT claim): a structured field, never interpolated, so a
        // newline in it cannot forge a second log line.
        logger.info(`[${requestId}] Revoked session ${sessionId}`, { sessionId, email: req.user?.email });
      }

      if (req.user && fingerprint) {
        await getEncryptionProvider().revokeSessionKey(fingerprint);
      }

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
    const platform = platformFromRequest(req);
    try {
      const { workspaceId } = req.body;

      // `workspaceId` is raw request body: a structured field (and clamped), never interpolated,
      // so it cannot inject a line break into the log stream.
      logger.info(`[LOGIN-WORKSPACE] Workspace login received (platform=${platform}, hasPendingCookie=${!!req.cookies?.[PENDING_AUTH_COOKIE]})`, {
        platform,
        workspaceId: logSafeId(workspaceId),
      });

      if (!workspaceId) {
        logger.warn(`[LOGIN-WORKSPACE] Workspace login rejected (platform=${platform}, reason=missing_workspaceId)`);
        res.status(400).json({
          error: 'Missing required fields',
          message: 'workspaceId is required'
        });
        return;
      }

      // Identity: the pending OAuth cookie (fresh sign-in picking a workspace) or, failing that,
      // the live device session (auto-login: single-workspace redirect / already signed in).
      const pending = readPendingAuth(req);

      let identity: { email: string; name: string; providerUserId: string; picture?: string };
      let provider: string;
      let isAutoLogin = false;

      if (pending) {
        const providerUserId = pending.providerUserId;
        if (!providerUserId) {
          logger.warn(`[LOGIN-WORKSPACE] Workspace login rejected (platform=${platform}, reason=missing_provider_identity)`);
          res.status(401).json({
            error: 'Invalid auth data',
            message: 'Pending auth data is missing provider identity'
          });
          return;
        }
        identity = { email: pending.email, name: pending.name, providerUserId, picture: pending.picture };
        provider = pending.provider;
      } else {
        /**
         * AUTO-LOGIN FLOW: the request carries a live session (cookies already set). The account
         * behind the session must already be a member of the requested workspace.
         */
        const resolved = await resolveSessionFromRequest(req);
        if (!resolved.ok) {
          const reason = resolved.reason === 'no_credentials' ? 'no_auth' : 'session_invalid';
          logger.warn(`[LOGIN-WORKSPACE] Workspace login rejected (platform=${platform}, reason=${reason})`);
          res.status(401).json(
            reason === 'no_auth'
              ? { error: 'Unauthorized', message: 'Pending auth data not found or expired' }
              : { error: 'Invalid session', message: 'Session not found or expired' },
          );
          return;
        }
        const { session } = resolved.session;
        logger.info(`[LOGIN-WORKSPACE] No pending auth cookie, but session ${session.id} found - using auto-login flow (platform=${platform})`);

        const membership = await findMembership(session.accountId, workspaceId);
        if (!membership) {
          const f = failure('workspace_forbidden');
          logger.warn(`[LOGIN-WORKSPACE] Workspace login rejected (platform=${platform}, reason=${f.reason})`, { workspaceId: logSafeId(workspaceId) });
          res.status(f.status).json(f.body);
          return;
        }
        identity = {
          email: membership.email,
          name: membership.name || '',
          providerUserId: membership.providerUserId,
          picture: membership.picture || undefined,
        };
        provider = membership.authProvider || AuthProvider.GOOGLE;
        isAutoLogin = true;
      }

      logger.info(`[LOGIN-WORKSPACE] User ${identity.email} logging in via ${provider} (platform=${platform})`, { workspaceId: logSafeId(workspaceId) });

      // Create workspace-scoped user (or get existing)
      const { user: workspaceUser, isNewUser } = await this.userService.createOrGetWorkspaceUser({
        providerUserId: identity.providerUserId,
        email: identity.email,
        name: identity.name,
        picture: identity.picture,
        workspaceId,
        authProvider: provider,
      });

      // Check if user is inactive or has left the workspace
      if (workspaceUser.status === UserStatus.INACTIVE || workspaceUser.leftAt !== null) {
        logger.warn(`[LOGIN-WORKSPACE] Workspace login rejected (platform=${platform}, provider=${provider}, reason=user_inactive)`, { workspaceId: logSafeId(workspaceId) });
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

      const orgMember = await this.orgMemberFor(workspaceUser.orgMemberId);
      if (!orgMember) {
        logger.warn(`[LOGIN-WORKSPACE] Workspace login rejected (platform=${platform}, provider=${provider}, reason=org_member_missing)`, { workspaceId: logSafeId(workspaceId) });
        res.status(403).json({
          error: 'User inactive',
          message: 'Your account has been deactivated or you have left this workspace'
        });
        return;
      }

      // Session (reused when the request already carries one of this account), cookies per
      // platform, onboarding cookie, pending-cookie clear, login tracking.
      const login = await completeLogin({
        req,
        res,
        workspaceUser,
        orgMember,
        platform,
        loginMethod: isAutoLogin ? 'AUTO_LOGIN' : (provider as LoginMethod),
        sameSite: sameSiteForLogin(req, platform),
        isNewUser,
        clearPending: true,
      });
      if (isNewUser) {
        logger.info(`[LOGIN-WORKSPACE] Set is_new_user cookie for new user: ${workspaceUser.email}`);
      }

      const orgRole = (await this.userService.getOrgRole(orgMember.memberId)) ?? '';

      logger.info(`[LOGIN-WORKSPACE] Workspace login succeeded (platform=${platform}, provider=${provider}, isNewUser=${isNewUser}, sessionId=${login.sessionId}, reused=${login.reused})`, { workspaceId: logSafeId(workspaceId) });
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
        ...nonWebAuthFields(login),
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
      const platform = platformFromRequest(req);

      // Pending identity from the OAuth cookie (missing, tampered or expired all read as null)
      const pending = readPendingAuth(req);
      if (!pending) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Pending auth data not found or expired'
        });
        return;
      }
      const providerUserId = pending.providerUserId;
      if (!providerUserId) {
        res.status(401).json({
          error: 'Invalid auth data',
          message: 'Pending auth data is missing provider identity'
        });
        return;
      }
      const provider = pending.provider;

      logger.info(`[CREATE-ORG] User ${pending.email} creating an org via ${provider}`, { orgName: logSafeId(orgName), workspaceName: logSafeId(workspaceName) });

      const userData = {
        providerUserId,
        email: pending.email,
        name: pending.name,
        picture: pending.picture,
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

      const orgMember = await this.orgMemberFor(workspaceUser.orgMemberId);
      if (!orgMember) {
        throw new Error('Organization membership not found after organization creation');
      }

      const login = await completeLogin({
        req,
        res,
        workspaceUser,
        orgMember,
        platform,
        loginMethod: provider as LoginMethod,
        sameSite: sameSiteForLogin(req, platform),
        isNewUser,
        clearPending: true,
        onboardingMaxAgeMs: ONBOARDING_COOKIE_ONE_DAY_MS,
      });

      logger.info(`[CREATE-ORG] Created org ${organization.orgId} with workspace ${workspace.id} (sessionId=${login.sessionId})`);

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
        ...nonWebAuthFields(login),
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
   * The caller's ACCOUNT must hold a membership (`users` row) in the target workspace — the same
   * check the resolver applies per request. No session row is written and `xs` is left
   * untouched: the one device session serves every workspace. A fresh `xw_<newWs>` access JWT
   * is minted and set (other `xw_*` cookies stay, so other tabs keep their workspace) and the
   * `xyne_last_workspace` hint moves to the target.
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

      const targetUser = await findMembership(currentUser.memberId, workspaceId);
      if (!targetUser) {
        logger.warn(`[SWITCH-WORKSPACE] ${currentUser.email} has no membership in the requested workspace`, { workspaceId: logSafeId(workspaceId) });
        res.status(403).json({
          error: 'Forbidden',
          message: 'You do not have access to this workspace',
          code: 'WORKSPACE_FORBIDDEN',
        });
        return;
      }

      await this.userService.ensureUserPresence(targetUser.id, workspaceId);
      const selfDmChannelId = await this.ensureSelfDmForUser(targetUser.id, workspaceId);

      const workspace = await getWorkspaceLandingChannelData(workspaceId);

      const orgMember = await this.orgMemberFor(currentUser.memberId);
      if (!orgMember) {
        res.status(403).json({
          error: 'Forbidden',
          message: 'You have been removed from this organization',
        });
        return;
      }

      // Reuse path: the request's own session (same account) is kept; cookies move to the
      // target workspace; the workspace JWT is minted bound to that session.
      const platform = platformFromRequest(req);
      const login = await completeLogin({
        req,
        res,
        workspaceUser: targetUser,
        orgMember,
        platform,
        loginMethod: 'WORKSPACE_SWITCHED',
        sameSite: sameSiteForLogin(req, platform),
        isNewUser: false,
      });

      logger.info(`[SWITCH-WORKSPACE] User ${currentUser.email} switched workspace (sessionId=${login.sessionId}, reused=${login.reused})`, { workspaceId: logSafeId(workspaceId) });

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
        ...nonWebAuthFields(login),
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
      const platform = platformFromRequest(req);

      // Pending identity from the OAuth cookie (missing, tampered or expired all read as null)
      const pending = readPendingAuth(req);
      if (!pending) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Pending auth data not found or expired'
        });
        return;
      }
      const providerUserId = pending.providerUserId;
      if (!providerUserId) {
        res.status(401).json({
          error: 'Invalid auth data',
          message: 'Pending auth data is missing provider identity'
        });
        return;
      }
      const provider = pending.provider;

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

        logger.info(`[CREATE-WORKSPACE-PENDING] User ${pending.email} creating a workspace via ${provider}`, { workspaceName: logSafeId(workspaceName) });

        const userData = {
          providerUserId,
          email: pending.email.toLowerCase(),
          name: pending.name,
          picture: pending.picture,
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

        const orgMember = await this.orgMemberFor(workspaceUser.orgMemberId);
        if (!orgMember) {
          throw new Error('Organization membership not found after workspace creation');
        }

        const isNewUser = !(await this.userService.hasCompletedOnboarding(userData.email));

        const login = await completeLogin({
          req,
          res,
          workspaceUser,
          orgMember,
          platform,
          loginMethod: provider as LoginMethod,
          sameSite: sameSiteForLogin(req, platform),
          isNewUser,
          clearPending: true,
          onboardingMaxAgeMs: ONBOARDING_COOKIE_ONE_DAY_MS,
        });

        logger.info(`[CREATE-WORKSPACE-PENDING] Created a workspace for ${pending.email} in org ${organization.orgId} (sessionId=${login.sessionId})`, { workspaceName: logSafeId(workspaceName) });

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
          ...nonWebAuthFields(login),
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

      const orgMember = await this.orgMemberFor(workspaceUser.orgMemberId);
      if (!orgMember) {
        throw new Error('Organization membership not found after workspace creation');
      }

      const isNewUser = !(await this.userService.hasCompletedOnboarding(fullUser.email));

      // Already signed in: the caller's session is reused; cookies move to the new workspace.
      const platform = platformFromRequest(req);
      const login = await completeLogin({
        req,
        res,
        workspaceUser,
        orgMember,
        platform,
        loginMethod: 'WORKSPACE_CREATED',
        sameSite: sameSiteForLogin(req, platform),
        isNewUser,
        onboardingMaxAgeMs: ONBOARDING_COOKIE_ONE_DAY_MS,
      });

      logger.info(`[CREATE-WORKSPACE-AUTH] Created org ${organization.orgId} / workspace ${workspace.id} for ${currentUser.email} (sessionId=${login.sessionId}, reused=${login.reused})`);

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
        ...nonWebAuthFields(login),
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
