import { Request, Response } from 'express';
import { AuthorizationCode } from 'simple-oauth2';
import { logger } from '../utils/logger';
import { UserService } from '../services/userService';
import { UserSessionService } from '../services/userSessionService';
import { oauthStateServiceV2 } from '../services/oauthStateServiceV2';
import { pkceServiceV2 } from '../services/pkceServiceV2';

import { AuthProvider } from '@prisma/client';
import '../types/express';
import { jwtService } from '../services/jwtService';
import { config } from '@/config/env';
import jwt from 'jsonwebtoken';
import { getFrontendUrl, resolveConfiguredOAuthRedirectUrl } from '@/utils/publicUrls';
import { persistCalendarOAuthCredentials } from '@/services/calendarTokenRefresh';
import { jwtVerify, createRemoteJWKSet } from 'jose';
import { WorkspaceType } from '@xyne/shared';
import {
  OrganizationDomainConflictError,
  organizationDomainService,
} from '@/services/organizationDomainService';

export class MicrosoftAuthController {
  private oauthClient: AuthorizationCode | undefined;
  private userService: UserService | undefined;
  private userSessionService: UserSessionService | undefined;
  private clientId: string | undefined;
  private tenantId: string = '';
  private msJwks!: ReturnType<typeof createRemoteJWKSet>;

  constructor() {
    const clientId = process.env.MICROSOFT_CLIENT_ID;
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
    const tenantId = process.env.MICROSOFT_TENANT_ID || undefined;

    if (!clientId || !clientSecret) {
      logger.info(`MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET environment variables not set`);
      return;
    }

    // Microsoft OAuth2 endpoints
    // Note: tenantId must be in the path, not the host, because simple-oauth2
    // strips path segments from authorizeHost/tokenHost.
    const authServer = {
      authorizeHost: 'https://login.microsoftonline.com',
      authorizePath: `/${tenantId}/oauth2/v2.0/authorize`,
      tokenHost: 'https://login.microsoftonline.com',
      tokenPath: `/${tenantId}/oauth2/v2.0/token`,
    };

    this.oauthClient = new AuthorizationCode({
      client: {
        id: clientId,
        secret: clientSecret,
      },
      auth: {
        authorizeHost: authServer.authorizeHost,
        authorizePath: authServer.authorizePath,
        tokenHost: authServer.tokenHost,
        tokenPath: authServer.tokenPath,
      },
      options: {
        authorizationMethod: 'body',
        bodyFormat: 'form',
      },
    });

    this.clientId = clientId;
    this.tenantId = tenantId ?? '';
    this.userService = new UserService();
    this.userSessionService = new UserSessionService();
    const jwksTenant = tenantId ?? 'common';
    this.msJwks = createRemoteJWKSet(
      new URL(`https://login.microsoftonline.com/${jwksTenant}/discovery/v2.0/keys`)
    );
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

  private getRedirectUrl(req: Request, platform: string, params: Record<string, string>): string {
    const query = new URLSearchParams(params).toString();
    if (platform === 'mobile') {
      return `xyne-spaces://auth/microsoft/callback?${query}`;
    }
    const frontendUrl = getFrontendUrl(req);
    return `${frontendUrl}?${query}`;
  }

  private getMicrosoftRedirectUri(req: Request): string {
    return resolveConfiguredOAuthRedirectUrl(
      config.microsoftAuthRedirectUri,
      config.backendUrl,
      '/api/v2/auth/microsoft/callback',
      'MICROSOFT_AUTH_REDIRECT_URI',
      req,
    );
  }

  private getMicrosoftAuthScopes(connectCalendar?: boolean): string[] {
    return [
      'openid',
      'email',
      'profile',
      'User.Read',
      'offline_access',
      ...(connectCalendar ? ['Calendars.Read'] : []),
    ];
  }

  private getAccessTokenExpiry(token: Record<string, unknown>): Date | undefined {
    const expiresAt = token.expires_at;
    if (expiresAt instanceof Date) return expiresAt;

    if (typeof expiresAt === 'string' || typeof expiresAt === 'number') {
      const date = new Date(expiresAt);
      if (!Number.isNaN(date.getTime())) return date;
    }

    const expiresIn = token.expires_in;
    const expiresInSeconds =
      typeof expiresIn === 'number'
        ? expiresIn
        : typeof expiresIn === 'string'
          ? Number(expiresIn)
          : null;

    if (expiresInSeconds && !Number.isNaN(expiresInSeconds)) {
      return new Date(Date.now() + expiresInSeconds * 1000);
    }

    return undefined;
  }

  private async persistMicrosoftCalendarCredentials(
    email: string,
    refreshToken: string | null | undefined,
    accessToken: string | null | undefined,
    accessTokenExpiry?: Date,
    ownerUserId?: string,
  ): Promise<boolean> {
    const sourceId = await persistCalendarOAuthCredentials({
      provider: AuthProvider.MICROSOFT,
      email,
      refreshToken,
      accessToken,
      accessTokenExpiry,
      ownerUserId,
    });

    if (!sourceId) {
      logger.warn('[MicrosoftAuth] Calendar reauth did not include a refresh token', {
        email,
      });
      return false;
    }

    logger.info('[MicrosoftAuth] Calendar credentials persisted', {
      email,
      sourceId,
      ownerUserId,
    });
    return true;
  }

  initiateLogin = async (req: Request, res: Response): Promise<void> => {
    const requestId = `MS_LOGIN_${Date.now()}`;

    try {
      if (this.oauthClient) {
        // return an error that MS auth not setup
        logger.info(`[${requestId}] Initiating Microsoft OAuth login`);

        const platformQuery = req.query.platform;
        const platform: 'mobile' | 'electron' | 'web' =
          platformQuery === 'mobile'
            ? 'mobile'
            : platformQuery === 'electron'
              ? 'electron'
              : 'web';

        const codeVerifier = pkceServiceV2.generateCodeVerifier();
        const codeChallenge = pkceServiceV2.generateCodeChallenge(codeVerifier);

        let validatedRedirectTo: string | undefined;
        const redirectToParam = req.query['redirect_to'] as string | undefined;
        if (redirectToParam) {
          const allowedOrigins = (process.env.ALLOWED_REDIRECT_ORIGINS ?? '')
            .split(',')
            .map((origin) => origin.trim())
            .filter(Boolean);
          try {
            const origin = new URL(redirectToParam).origin;
            const frontendOrigin = new URL(getFrontendUrl(req)).origin;
            if (allowedOrigins.includes(origin) || origin === frontendOrigin) {
              validatedRedirectTo = redirectToParam;
            }
          } catch (_error) {
            // Ignore malformed redirect targets; only configured/current frontend origins are allowed.
          }
        }

        // Get invitationId from query (for invitation flow)
        const invitationId = req.query.invitationId as string | undefined;

        const connectCalendar = req.query.connectCalendar === 'true';
        const enterpriseLogin = req.query.enterpriseLogin === 'true';

        const state = await oauthStateServiceV2.generateState(
          platform,
          codeChallenge,
          validatedRedirectTo,
          'microsoft',
          undefined,
          invitationId,
          connectCalendar,
          enterpriseLogin,
        );

        await pkceServiceV2.storeVerifier(state, codeVerifier);

        const redirectUri = this.getMicrosoftRedirectUri(req);

        logger.info('[OAuth] Redirect URI:', redirectUri);

        const authorizationUri = this.oauthClient.authorizeURL({
          redirect_uri: redirectUri,
          scope: this.getMicrosoftAuthScopes(connectCalendar),
          state,
          code_challenge: codeChallenge,
          code_challenge_method: 'S256',
          prompt: 'select_account',
        } as Record<string, string | string[]>);

        logger.info(`[${requestId}] Redirecting to Microsoft OAuth`);
        res.redirect(authorizationUri);
      } else {
        logger.error(`[${requestId}] Microsoft OAuth client not configured`);
        const frontendUrl = getFrontendUrl(req);
        res.redirect(
          `${frontendUrl}?error=microsoft_not_configured&message=${encodeURIComponent('Microsoft SSO is not configured')}`
        );
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`[${requestId}] Error initiating Microsoft login: ${errorMessage}`);

      const frontendUrl = getFrontendUrl(req);
      res.redirect(
        `${frontendUrl}?error=oauth_init_failed&message=${encodeURIComponent(errorMessage)}`
      );
    }
  };

  private async verifyMicrosoftIdToken(idToken: string) {
    const { payload } = await jwtVerify(idToken, this.msJwks, {
      audience: this.clientId,
      issuer: `https://login.microsoftonline.com/${this.tenantId}/v2.0`,
    });
    return payload as { email?: string; xms_edov?: boolean; oid?: string; tid?: string };
  }

  handleCallback = async (req: Request, res: Response): Promise<void> => {
    const requestId = `MS_CALLBACK_${Date.now()}`;
    let resolvedPlatform: string = 'web';
    let peekedState: Awaited<ReturnType<typeof oauthStateServiceV2.validateState>> = null;

    try {
      if (this.oauthClient && this.userService && this.userSessionService) {
        const { code, state, error } = req.query;

        logger.info(`[${requestId}] Microsoft OAuth callback received`);

        // Peek at state early to determine platform for error redirects
        if (state) {
          peekedState = await oauthStateServiceV2.validateState(state as string, false);
          if (peekedState) {
            resolvedPlatform = peekedState.platform;
          }
        }
        logger.info(`[${requestId}] STATE_PEEK: platform=${peekedState?.platform || 'NULL'}, provider=${peekedState?.provider || 'NULL'}, invitationId=${peekedState?.invitationId || 'NULL'}, stateFound=${!!peekedState}`);

        if (error) {
          logger.error(`[${requestId}] Microsoft OAuth error: ${error}`);
          if (state) await oauthStateServiceV2.deleteState(state as string);
          res.redirect(
            this.getRedirectUrl(req, resolvedPlatform, {
              error: 'oauth_error',
              message: error as string,
            })
          );
          return;
        }

        if (!code || !state) {
          logger.error(`[${requestId}] Missing code or state`);
          res.redirect(
            this.getRedirectUrl(req, resolvedPlatform, {
              error: 'missing_params',
              message: 'Missing authorization code or state',
            })
          );
          return;
        }

        // Electron: defer the MS code exchange to the desktop app.
        // Redirect the browser to the launch page, which triggers the unified
        // xyne-spaces://auth/callback deep link. The Electron app then POSTs
        // to /api/auth/exchange-electron with the original authorization code
        // + state; the dispatcher there reads the provider off the OAuth state
        // record and routes Microsoft states to the Microsoft exchange handler.
        // State and PKCE verifier must remain intact until that exchange.
        if (resolvedPlatform === 'electron') {
          const frontendUrl = getFrontendUrl(req);
          const launchParams = new URLSearchParams({
            code: code as string,
            state: state as string,
          });
          if (peekedState?.invitationId) {
            launchParams.set('invitationId', peekedState.invitationId);
          }
          const launchUrl = `${frontendUrl}/launch?${launchParams.toString()}`;
          logger.info(`[${requestId}] ELECTRON_REDIRECT: invitationId_appended=${!!peekedState?.invitationId}, invitationId=${peekedState?.invitationId || 'NULL'}, launchUrl=${launchUrl}`);
          res.redirect(launchUrl);
          return;
        }

        // Now consume the state (delete it)
        await oauthStateServiceV2.deleteState(state as string);

        // Get and delete code verifier for PKCE (atomic operation)
        const codeVerifier = await pkceServiceV2.getAndDeleteVerifier(state as string);
        if (!codeVerifier) {
          logger.error(`[${requestId}] Code verifier not found`);
          res.redirect(
            this.getRedirectUrl(req, resolvedPlatform, {
              error: 'pkce_error',
              message: 'PKCE verification failed',
            })
          );
          return;
        }

        const redirectUri = this.getMicrosoftRedirectUri(req);

        // Exchange code for tokens
        const tokenParams = {
          code: code as string,
          redirect_uri: redirectUri,
          scope: this.getMicrosoftAuthScopes(peekedState?.connectCalendar).join(' '),
          code_verifier: codeVerifier,
        };

        logger.info(`[${requestId}] Exchanging code for tokens`);
        const tokenResult = await this.oauthClient.getToken(tokenParams);
        const { token } = tokenResult;

        const idToken = token.id_token as string;
        if (!idToken) {
          throw new Error('No ID token received from Microsoft');
        }
        const idTokenClaims = await this.verifyMicrosoftIdToken(idToken);
        logger.info(`[${requestId}] Verified Microsoft ID token claims`, { claims: idTokenClaims.xms_edov });
        const emailIsDomainVerified = idTokenClaims.xms_edov === true;

        if (!emailIsDomainVerified) {
          throw new Error('Email is not verified from Microsoft');
        }

        const verifiedEmail = idTokenClaims.email;
        if (!verifiedEmail) {
          throw new Error('No email claim in ID token');
        }

        const accessToken = token.access_token as string;
        const accessTokenExpiry = this.getAccessTokenExpiry(token as Record<string, unknown>);

        if (!accessToken) {
          throw new Error('No access token received from Microsoft');
        }

        // Fetch user profile from Microsoft Graph API
        logger.info(`[${requestId}] Fetching user profile from Microsoft Graph`);
        const graphResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        if (!graphResponse.ok) {
          throw new Error(
            `Microsoft Graph API error: ${graphResponse.status} ${graphResponse.statusText}`
          );
        }

        const profile = (await graphResponse.json()) as {
          id: string;
          mail?: string;
          userPrincipalName?: string;
          displayName: string;
        };

        // Extract user data from Microsoft profile
        const microsoftUserData = {
          provider: AuthProvider.MICROSOFT,
          providerUserId: profile.id,
          email: verifiedEmail,
          name: profile.displayName,
          picture: undefined, // Microsoft Graph requires separate call for photo
        };

        if (!microsoftUserData.email) {
          throw new Error('Email not available in Microsoft profile');
        }

        const workspaces = this.getEnterpriseAwareWorkspaces(
          await this.userService.getWorkspacesByEmail(microsoftUserData.email),
          peekedState?.enterpriseLogin,
        );
        logger.info(`[${requestId}] User has ${workspaces.length} workspace(s)`);

        const refreshToken = token.refresh_token as string | undefined;
        const isProduction = process.env.NODE_ENV === 'production';

        if (resolvedPlatform !== 'mobile' && workspaces.length === 0) {
          const userExistsButRemoved = await this.userService.userExistsButNoActiveWorkspaces(
            microsoftUserData.email,
          );
          const domainConflict = !userExistsButRemoved
            ? await organizationDomainService.findEnterpriseWorkspaceByEmailDomain(microsoftUserData.email)
            : null;
          const domainConflictError = domainConflict
            ? new OrganizationDomainConflictError(domainConflict.domain, domainConflict)
            : null;

          res.cookie('google_access_token', jwt.sign({
            providerUserId: microsoftUserData.providerUserId,
            email: microsoftUserData.email,
            name: microsoftUserData.name,
            picture: microsoftUserData.picture,
            provider: AuthProvider.MICROSOFT,
            refreshToken: refreshToken ?? null,
            connectCalendar: peekedState?.connectCalendar,
          }, process.env.JWT_SECRET!, { expiresIn: '10m' }), {
            httpOnly: true,
            secure: isProduction,
            sameSite: 'lax' as const,
            path: '/',
            maxAge: 10 * 60 * 1000,
          });

          const frontendUrl = peekedState?.redirectTo ?? getFrontendUrl(req);
          const params = new URLSearchParams({
            success: 'true',
            email: microsoftUserData.email,
            name: microsoftUserData.name,
            picture: microsoftUserData.picture || '',
            workspaces: JSON.stringify([]),
            userExistsButRemoved: String(userExistsButRemoved),
          });
          if (domainConflictError && domainConflict) {
            params.set('domainConflictError', domainConflictError.message);
            params.set('enterpriseJoinWorkspaceId', domainConflict.workspace.id);
            params.set('enterpriseJoinWorkspaceName', domainConflict.workspace.name);
            params.set('enterpriseJoinOrgName', domainConflict.name);
          }

          logger.info(
            `[${requestId}] No workspace found for ${microsoftUserData.email}; redirecting with pending auth for org creation`,
          );
          res.redirect(`${frontendUrl}?${params.toString()}`);
          return;
        }

        logger.info(`[${requestId}] Finding/creating user: ${microsoftUserData.email}`);
        const { user, isNewUser } = await this.userService.findOrCreateOAuthUser({
          provider: AuthProvider.MICROSOFT,
          providerUserId: microsoftUserData.providerUserId,
          email: microsoftUserData.email,
          name: microsoftUserData.name,
          picture: microsoftUserData.picture,
        }, workspaces[0]?.id ?? '');

        // Ensure user presence entry exists
        await this.userService.ensureUserPresence(user.id, user.workspaceId);

        logger.info(
          `[${requestId}] User resolved: ${user.email} (ID: ${user.id}, isNew: ${isNewUser})`
        );

        // Generate custom JWT token
        const customToken = jwtService.generateToken({
          sub: user.id,
          email: user.email,
          name: user.name,
          picture: user.picture ?? undefined,
          workspaceId: user.workspaceId ?? undefined,
          memberId: user.orgMemberId ?? undefined,
        });

        // Create user session
        let sessionId = null;

        if (refreshToken) {
          try {
            logger.info(`[${requestId}] Creating user session with refresh token`);

            const refreshTokenExpiry = new Date();
            refreshTokenExpiry.setDate(refreshTokenExpiry.getDate() + config.session.expiryDays);

            const session = await this.userSessionService.createSession({
              userId: user.id,
              refreshToken: refreshToken,
              refreshTokenExpiry,
              accessToken: accessToken,
              accessTokenExpiry,
              deviceInfo: JSON.stringify({
                userAgent: req.headers['user-agent'],
                acceptLanguage: req.headers['accept-language'],
                timestamp: new Date().toISOString(),
              }),
              ipAddress: req.ip || req.socket.remoteAddress || undefined,
            });

            sessionId = session.id;
            logger.info(`[${requestId}] Session created`);
          } catch (sessionError) {
            logger.error(`[${requestId}] Error creating user session:`, sessionError);
            // Continue without session creation - not critical for login
          }
        }

        let calendarReauthRequired = false;
        if (peekedState?.connectCalendar) {
          calendarReauthRequired = !(await this.persistMicrosoftCalendarCredentials(
            microsoftUserData.email,
            refreshToken,
            accessToken,
            accessTokenExpiry,
            user.id,
          ));
        }

        // Handle mobile platform: redirect to app deep link with token
        if (resolvedPlatform === 'mobile') {
          const mobileParams = new URLSearchParams({
            success: 'true',
            token: customToken,
            user_id: user.id,
            email: user.email,
            name: user.name,
          });

          const mobileRedirectUrl = `xyne-spaces://auth/microsoft/callback?${mobileParams.toString()}`;
          logger.info(`[${requestId}] Redirecting to mobile app: xyne-spaces://auth/microsoft/callback`);
          res.redirect(mobileRedirectUrl);
          return;
        }

        const userExistsButRemoved = workspaces.length === 0
          ? await this.userService.userExistsButNoActiveWorkspaces(microsoftUserData.email)
          : false;

        const cookieOptions = {
          httpOnly: true,
          secure: isProduction,
          sameSite: 'lax' as const,
          path: '/',
        };

        // Set pending-auth cookie. This must be a pending-auth JWT (not the
        // session customToken): loginWorkspace/createOrg read it via
        // parsePendingAuthCookie, which needs providerUserId AND provider — the
        // session token has neither, so it would mislabel the user as GOOGLE and
        // drop the refresh token. Mirrors Google's web callback + MS electron.
        res.cookie('google_access_token', jwt.sign({
          providerUserId: microsoftUserData.providerUserId,
          email: microsoftUserData.email,
          name: microsoftUserData.name,
          picture: microsoftUserData.picture,
          provider: AuthProvider.MICROSOFT,
          refreshToken: refreshToken ?? null,
          accessToken: accessToken ?? null,
          accessTokenExpiry: accessTokenExpiry?.toISOString(),
          connectCalendar: peekedState?.connectCalendar,
        }, process.env.JWT_SECRET!, { expiresIn: '10m' }), {
          ...cookieOptions,
          maxAge: 10 * 60 * 1000, // 10 minutes pending auth window
        });

        // Set session ID cookie
        if (sessionId) {
          res.cookie('user_session_id', sessionId, {
            ...cookieOptions,
            maxAge: config.session.expiryDays * 24 * 60 * 60 * 1000,
          });
        }

        // Set new user cookie for onboarding
        if (isNewUser) {
          res.cookie('is_new_user', 'true', {
            ...cookieOptions,
            maxAge: 24 * 60 * 60 * 1000, // 24 hours
          });
        }

        // Redirect to frontend with success
        const frontendUrl = peekedState?.redirectTo ?? getFrontendUrl(req);

        // If this was a "connect calendar" re-auth, redirect straight to the calls page
        if (peekedState?.connectCalendar && user.workspaceId) {
          const params = new URLSearchParams({
            tab: 'upcoming',
            syncCalendar: 'true',
          });
          if (calendarReauthRequired) {
            params.set('calendarReauthRequired', 'true');
          }
          res.redirect(`${frontendUrl}/${user.workspaceId}/calls?${params.toString()}`);
          return;
        }

        const params = new URLSearchParams({
          success: 'true',
          email: microsoftUserData.email,
          name: microsoftUserData.name,
          picture: microsoftUserData.picture || '',
          workspaces: JSON.stringify(workspaces),
          userExistsButRemoved: String(userExistsButRemoved),
        });
        if (workspaces.length === 1) {
          params.set('autoLoginWorkspace', workspaces[0]!.id);
        }

        res.redirect(`${frontendUrl}?${params.toString()}`);
      } else {
        logger.error(`[${requestId}] Microsoft OAuth client not configured`);
        res.redirect(
          this.getRedirectUrl(req, resolvedPlatform, {
            error: 'microsoft_not_configured',
            message: 'Microsoft SSO is not configured',
          })
        );
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`[${requestId}] Microsoft OAuth callback failed: ${errorMessage}`);

      if (resolvedPlatform !== 'mobile' && peekedState?.redirectTo) {
        const params = new URLSearchParams({
          error: 'auth_failed',
          message: errorMessage,
        });
        res.redirect(`${peekedState.redirectTo}?${params.toString()}`);
        return;
      }

      res.redirect(
        this.getRedirectUrl(req, resolvedPlatform, {
          error: 'auth_failed',
          message: errorMessage,
        })
      );
    }
  };

  /**
   * Electron code-exchange handler for Microsoft login.
   *
   * Invoked by the unified /api/auth/exchange-electron dispatcher when the
   * OAuth state record has provider === 'microsoft'. The Electron app reaches
   * this after the frontend /launch page triggers xyne-spaces://auth/callback
   * and the deep-link handler POSTs the MS authorization code + state. This
   * method runs the MS token exchange, user/session creation, and returns
   * Set-Cookie headers that Electron applies to its session.
   */
  exchangeElectron = async (req: Request, res: Response): Promise<void> => {
    const requestId = `MS_EXCHANGE_ELECTRON_${Date.now()}`;

    try {
      if (!this.oauthClient || !this.userService || !this.userSessionService) {
        logger.error(`[${requestId}] Microsoft OAuth client not configured`);
        res.status(500).json({
          success: false,
          error: 'microsoft_not_configured',
          message: 'Microsoft SSO is not configured',
        });
        return;
      }

      const code = (req.body?.code as string | undefined)?.trim();
      const state = (req.body?.state as string | undefined)?.trim();
      const bodyInvitationId = (req.body?.invitationId as string | undefined)?.trim();

      logger.info(`[${requestId}] EXCHANGE_ELECTRON_BODY: code=${code ? code.substring(0, 12) + '...' : 'NULL'}, state=${state ? state.substring(0, 12) + '...' : 'NULL'}, bodyInvitationId=${bodyInvitationId || 'NULL'}`);

      if (!code || !state) {
        logger.error(`[${requestId}] Missing code or state`);
        res.status(400).json({
          success: false,
          error: 'missing_params',
          message: 'code and state are required',
        });
        return;
      }

      const isCodeUsed = await oauthStateServiceV2.isCodeUsed(code);
      if (isCodeUsed) {
        logger.error(`[${requestId}] Authorization code already used`);
        res.status(409).json({
          success: false,
          error: 'code_already_used',
          message: 'Authorization code has already been exchanged',
        });
        return;
      }

      // Validate + consume state
      const stateData = await oauthStateServiceV2.validateState(state);
      if (!stateData) {
        logger.error(`[${requestId}] Invalid or expired state`);
        res.status(401).json({
          success: false,
          error: 'invalid_state',
          message: 'State parameter is invalid or expired',
        });
        return;
      }

      if (stateData.platform !== 'electron') {
        logger.error(`[${requestId}] Invalid platform: ${stateData.platform}`);
        res.status(400).json({
          success: false,
          error: 'invalid_platform',
          message: 'This endpoint is only for Electron platform',
        });
        return;
      }

      logger.info(`[${requestId}] STATE_DATA: platform=${stateData.platform}, provider=${stateData.provider || 'NULL'}, invitationId=${stateData.invitationId || 'NULL'}`);



      const codeVerifier = await pkceServiceV2.getAndDeleteVerifier(state);
      if (!codeVerifier) {
        logger.error(`[${requestId}] PKCE verifier not found`);
        res.status(401).json({
          success: false,
          error: 'pkce_failed',
          message: 'PKCE verification failed',
        });
        return;
      }

      await oauthStateServiceV2.markCodeAsUsed(code);

      const redirectUri = this.getMicrosoftRedirectUri(req);

      logger.info(`[${requestId}] Exchanging code for tokens`);
      const tokenResult = await this.oauthClient.getToken({
        code,
        redirect_uri: redirectUri,
        scope: this.getMicrosoftAuthScopes(stateData.connectCalendar).join(' '),
        ...( codeVerifier ? { code_verifier: codeVerifier } : {}),
      } as Parameters<typeof this.oauthClient.getToken>[0]);
      const { token } = tokenResult;
      const accessToken = token.access_token as string;
      const accessTokenExpiry = this.getAccessTokenExpiry(token as Record<string, unknown>);
      if (!accessToken) {
        throw new Error('No access token received from Microsoft');
      }

      const idToken = token.id_token as string;
      if (!idToken) {
        throw new Error('No ID token received from Microsoft');
      }
      const idTokenClaims = await this.verifyMicrosoftIdToken(idToken);
      logger.info(`[${requestId}] Verified Microsoft ID token claims`, { claims: idTokenClaims.xms_edov });

      const emailIsDomainVerified = idTokenClaims.xms_edov === true;
      if (!emailIsDomainVerified) {
        throw new Error('Email is not verified from Microsoft');
      }

      const email = idTokenClaims.email;
      if (!email) {
        throw new Error('No email claim in ID token');
      }

      logger.info(`[${requestId}] Fetching user profile from Microsoft Graph`);
      const graphResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!graphResponse.ok) {
        throw new Error(
          `Microsoft Graph API error: ${graphResponse.status} ${graphResponse.statusText}`
        );
      }

      const profile = (await graphResponse.json()) as {
        id: string;
        mail?: string;
        userPrincipalName?: string;
        displayName: string;
      };

      // Email was already verified from the ID token above.

      const workspaces = this.getEnterpriseAwareWorkspaces(
        await this.userService.getWorkspacesByEmail(email),
        stateData.enterpriseLogin,
      );
      const userExistsButRemoved = await this.userService.userExistsButNoActiveWorkspaces(email);
      logger.info(`[${requestId}] User has ${workspaces.length} workspace(s), userExistsButRemoved: ${userExistsButRemoved}`);
      logger.info(`[${requestId}] PROFILE: email=${email}, msId=${profile.id}, verifiedOid=${idTokenClaims.oid ?? 'NULL'}, workspaceCount=${workspaces.length}`);

      const isProduction = process.env.NODE_ENV === 'production';

      // If user has no workspaces and is not invited (not in org_members), redirect to no-access.
      // Still set google_access_token so that AuthScreen's isCreatingOrg + pendingInvitationId
      // path can redirect to /invite and acceptInvitation will have the identity cookie.
      // This mirrors Google's exchangeElectronCode which always sets google_access_token (line 842).
      if (workspaces.length === 0 && !userExistsButRemoved && !stateData.invitationId && !bodyInvitationId) {
        logger.info(`[${requestId}] User has no workspaces and no invitation - setting google_access_token and returning no-access`);
        res.cookie('google_access_token', jwt.sign({
          providerUserId: profile.id,
          email,
          name: profile.displayName,
          picture: undefined,
          provider: 'microsoft',
          refreshToken: (token.refresh_token as string | undefined) ?? null,
        }, process.env.JWT_SECRET!, { expiresIn: '10m' }), {
          httpOnly: true,
          secure: isProduction,
          sameSite: 'lax' as const,
          path: '/',
          maxAge: 10 * 60 * 1000,
        });
        logger.info(`[${requestId}] NO_WORKSPACE_COOKIE_SET: google_access_token set for potential invite redirect (sameSite=lax, maxAge=10min)`);
        res.status(200).json({
          success: true,
          workspaces: [],
          userExistsButRemoved: false,
          email,
          name: profile.displayName,
          picture: undefined,
        });
        return;
      }

      // If an invitation is pending: set google_access_token so the Electron renderer can later
      // call acceptInvitation + loginWorkspace, then return a hasInvitation signal. The renderer
      // will navigate to /invite?loginComplete=true inside the app — no browser involvement.
      // Combine state and body invitation IDs (same as Google flow)
      const effectiveInvitationId = stateData.invitationId || bodyInvitationId;
      logger.info(`[${requestId}] INVITATION_CHECK: stateData.invitationId=${stateData.invitationId || 'NULL'}, bodyInvitationId=${bodyInvitationId || 'NULL'}, effectiveInvitationId=${effectiveInvitationId || 'NULL'} → path=${effectiveInvitationId ? 'INVITATION' : 'WORKSPACE_LOGIN'}`);
      if (effectiveInvitationId) {
        logger.info(`[${requestId}] Invitation detected (${effectiveInvitationId}) — returning hasInvitation signal to Electron`);
        // Use sameSite: 'lax' for Electron invitation flow - cookies need to be sent
        // from the renderer (localhost:5173) to backend (localhost:3001)
        res.cookie('google_access_token', jwt.sign({
          providerUserId: profile.id,
          email,
          name: profile.displayName,
          picture: undefined,
          provider: 'microsoft',
          refreshToken: (token.refresh_token as string | undefined) ?? null,
        }, process.env.JWT_SECRET!, { expiresIn: '10m' }), {
          httpOnly: true,
          secure: isProduction,
          sameSite: 'lax' as const,
          path: '/',
          maxAge: 10 * 60 * 1000,
        });
        logger.info(`[${requestId}] INVITATION_COOKIE_SET: google_access_token set (provider=microsoft, hasRefreshToken=${!!(token.refresh_token)}, hasAccessToken=${!!accessToken}, sameSite=lax, maxAge=10min)`);
        res.status(200).json({
          success: true,
          hasInvitation: true,
          invitationId: effectiveInvitationId,
          loggedInEmail: email,
          email,
          name: profile.displayName,
          picture: undefined,
        });
        return;
      }

      logger.info(`[${requestId}] NO_INVITATION: falling through to workspace login (workspaces=${workspaces.length}, userExistsButRemoved=${userExistsButRemoved})`);
      
      /**
       * AUTO-LOGIN SINGLE WORKSPACE USERS (Electron)
       * Mirrors Google behavior - auto-login when user has exactly 1 workspace
       */
      if (workspaces.length === 1) {
        const workspaceId = workspaces[0]!.id;
        logger.info(`[${requestId}] Single workspace detected - auto-logging in to ${workspaceId}`);
        
        const { user, isNewUser } = await this.userService.findOrCreateOAuthUser({
          provider: AuthProvider.MICROSOFT,
          providerUserId: profile.id,
          email,
          name: profile.displayName,
          picture: undefined,
        }, workspaceId);

        await this.userService.ensureUserPresence(user.id, user.workspaceId);

        logger.info(
          `[${requestId}] User resolved: ${user.email} (ID: ${user.id}, isNew: ${isNewUser})`
        );

        const customToken = jwtService.generateToken({
          sub: user.id,
          email: user.email,
          name: user.name,
          picture: user.picture ?? undefined,
          workspaceId: user.workspaceId ?? undefined,
          memberId: user.orgMemberId ?? undefined,
        });

        let sessionId: string | null = null;
        const refreshToken = token.refresh_token as string | undefined;

        if (refreshToken) {
          try {
            const refreshTokenExpiry = new Date();
            refreshTokenExpiry.setDate(refreshTokenExpiry.getDate() + 30);

            const session = await this.userSessionService.createSession({
              userId: user.id,
              refreshToken,
              refreshTokenExpiry,
              accessToken,
              accessTokenExpiry,
              deviceInfo: JSON.stringify({
                userAgent: req.headers['user-agent'],
                acceptLanguage: req.headers['accept-language'],
                timestamp: new Date().toISOString(),
                platform: 'electron',
              }),
              ipAddress: req.ip || req.socket.remoteAddress || undefined,
            });

            sessionId = session.id;
            logger.info(`[${requestId}] Session created`);
          } catch (sessionError) {
            logger.error(`[${requestId}] Error creating user session:`, sessionError);
            // Continue without session creation - not critical for login
          }
        }

        let calendarReauthRequired = false;
        if (stateData.connectCalendar) {
          calendarReauthRequired = !(await this.persistMicrosoftCalendarCredentials(
            email,
            refreshToken,
            accessToken,
            accessTokenExpiry,
            user.id,
          ));
        }

        const cookieOptions = {
          httpOnly: true,
          secure: isProduction,
          sameSite: 'strict' as const,
          path: '/',
        };

        res.cookie('xyne_last_workspace', workspaceId, {
          ...cookieOptions,
          maxAge: 30 * 24 * 60 * 60 * 1000,
        });

        res.cookie(`xyne_ws_${workspaceId}_token`, customToken, {
          ...cookieOptions,
          maxAge: 24 * 60 * 60 * 1000,
        });

        if (sessionId) {
          res.cookie('user_session_id', sessionId, {
            ...cookieOptions,
            maxAge: 30 * 24 * 60 * 60 * 1000,
          });
        }

        if (isNewUser) {
          res.cookie('is_new_user', 'true', {
            httpOnly: false,
            secure: isProduction,
            sameSite: 'strict',
            path: '/',
            maxAge: 24 * 60 * 60 * 1000,
          });
        }

        res.cookie('google_access_token', jwt.sign({
          providerUserId: profile.id,
          email,
          name: profile.displayName,
          picture: undefined,
          provider: 'microsoft',
          refreshToken: refreshToken ?? null,
          accessToken,
          accessTokenExpiry: accessTokenExpiry?.toISOString(),
          connectCalendar: stateData.connectCalendar,
        }, process.env.JWT_SECRET!, { expiresIn: '10m' }), {
          httpOnly: true,
          secure: isProduction,
          sameSite: 'lax' as const,
          path: '/',
          maxAge: 10 * 60 * 1000,
        });

        logger.info(`[${requestId}] Electron auto-login complete - cookies set: user_session_id, google_access_token`);

        // Return JSON with workspaces (Electron expects this for renderer to handle)
        res.status(200).json({
          success: true,
          email: user.email,
          name: user.name,
          picture: user.picture ?? undefined,
          workspaces,
          userExistsButRemoved: false,
          ...(stateData.connectCalendar ? { connectCalendar: true, workspaceId, calendarReauthRequired } : {}),
        });
        return;
      }

      // Multiple workspaces (or new user): create user without workspace assignment
      // Return workspaces array so Electron can show workspace selector
      const { user, isNewUser } = await this.userService.findOrCreateOAuthUser({
        provider: AuthProvider.MICROSOFT,
        providerUserId: profile.id,
        email,
        name: profile.displayName,
        picture: undefined,
      }, workspaces[0]?.id ?? '');

      await this.userService.ensureUserPresence(user.id, user.workspaceId);

      logger.info(
        `[${requestId}] User resolved: ${user.email} (ID: ${user.id}, isNew: ${isNewUser}, workspaces: ${workspaces.length})`
      );

      // Create session for multi-workspace users too (same as single workspace)
      let sessionId: string | null = null;
      const refreshToken = token.refresh_token as string | undefined;

      if (refreshToken) {
        try {
          const refreshTokenExpiry = new Date();
          refreshTokenExpiry.setDate(refreshTokenExpiry.getDate() + 30);

          const session = await this.userSessionService.createSession({
            userId: user.id,
            refreshToken,
            refreshTokenExpiry,
            accessToken,
            accessTokenExpiry,
            deviceInfo: JSON.stringify({
              userAgent: req.headers['user-agent'],
              acceptLanguage: req.headers['accept-language'],
              timestamp: new Date().toISOString(),
              platform: 'electron',
            }),
            ipAddress: req.ip || req.socket.remoteAddress || undefined,
          });

          sessionId = session.id;
          logger.info(`[${requestId}] Session created`);
        } catch (sessionError) {
          logger.error(`[${requestId}] Error creating user session:`, sessionError);
          // Continue without session creation - not critical for login
        }
      }

      // Store pending auth data for later loginWorkspace / acceptInvitation call
      res.cookie('google_access_token', jwt.sign({
        providerUserId: profile.id,
        email,
        name: profile.displayName,
        picture: undefined,
        provider: 'microsoft',
        refreshToken: refreshToken ?? null,
        accessToken,
        accessTokenExpiry: accessTokenExpiry?.toISOString(),
        connectCalendar: stateData.connectCalendar,
      }, process.env.JWT_SECRET!, { expiresIn: '10m' }), {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'lax' as const,
        path: '/',
        maxAge: 10 * 60 * 1000,
      });

      if (sessionId) {
        res.cookie('user_session_id', sessionId, {
          httpOnly: true,
          secure: isProduction,
          sameSite: 'strict',
          path: '/',
          maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        });
      }

      if (isNewUser) {
        res.cookie('is_new_user', 'true', {
          httpOnly: false,
          secure: isProduction,
          sameSite: 'strict',
          path: '/',
          maxAge: 24 * 60 * 60 * 1000,
        });
      }

      logger.info(`[${requestId}] Multiple workspaces (${workspaces.length}) detected - returning to selector`);
      res.status(200).json({
        success: true,
        email: user.email,
        name: user.name,
        picture: user.picture ?? undefined,
        workspaces,
        userExistsButRemoved: workspaces.length === 0,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`[${requestId}] Microsoft electron exchange failed: ${errorMessage}`);
      res.status(500).json({
        success: false,
        error: 'exchange_failed',
        message: errorMessage,
      });
    }
  };

  /**
   * Mobile-native exchange endpoint for Microsoft login.
   *
   * The mobile app runs the OAuth authorization step via react-native-app-auth
   * (with `skipCodeExchange: true`), obtains an authorization code from
   * Microsoft, and POSTs the code + PKCE verifier here. The backend performs
   * the code→token exchange with Microsoft server-side (mirrors the Google
   * flow where `serverAuthCode` is exchanged by the backend), calls Graph to
   * resolve the user, creates a session, and returns Set-Cookie headers.
   *
   * Body: { code: string, code_verifier: string, redirect_uri: string }
   */
  exchangeMobile = async (req: Request, res: Response): Promise<void> => {
    const requestId = `MS_EXCHANGE_MOBILE_${Date.now()}`;

    try {
      if (!this.oauthClient || !this.userService || !this.userSessionService) {
        logger.error(`[${requestId}] Microsoft OAuth client not configured`);
        res.status(500).json({
          success: false,
          error: 'microsoft_not_configured',
          message: 'Microsoft SSO is not configured',
        });
        return;
      }

      const code = (req.body?.code as string | undefined)?.trim();
      const codeVerifier = (req.body?.code_verifier as string | undefined)?.trim();
      const redirectUri = (req.body?.redirect_uri as string | undefined)?.trim();

      if (!code || !codeVerifier || !redirectUri) {
        logger.error(`[${requestId}] Missing code, code_verifier, or redirect_uri`);
        res.status(400).json({
          success: false,
          error: 'missing_params',
          message: 'code, code_verifier, and redirect_uri are required',
        });
        return;
      }

      // Exchange the authorization code for tokens with Microsoft (server-side).
      // Bypass simple-oauth2 here and call Microsoft's token endpoint directly
      // with application/x-www-form-urlencoded which is what Microsoft requires.
      // simple-oauth2 defaults to JSON body which causes a 401 from Microsoft.
      logger.info(`[${requestId}] Exchanging code for tokens`);
      const tokenParams = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: this.clientId!,
        code,
        redirect_uri: redirectUri,
        scope: this.getMicrosoftAuthScopes(req.body?.connectCalendar === true).join(' '),
        code_verifier: codeVerifier,
      });

      const tokenResponse = await fetch(
        `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: tokenParams.toString(),
        }
      );

      const tokenBody = await tokenResponse.json() as Record<string, unknown>;
      if (!tokenResponse.ok) {
        const msError = tokenBody.error as string | undefined;
        const msDesc = tokenBody.error_description as string | undefined;
        logger.error(
          `[${requestId}] Microsoft token endpoint error: ${tokenResponse.status} ${msError} - ${msDesc}`
        );
        throw new Error(`Microsoft token exchange failed: ${msError} - ${msDesc}`);
      }

      const accessToken = tokenBody.access_token as string;
      if (!accessToken) {
        throw new Error('No access token received from Microsoft');
      }
      const token = tokenBody;

      const idToken = tokenBody.id_token as string;
      if (!idToken) {
        throw new Error('No ID token received from Microsoft');
      }

      const idTokenClaims = await this.verifyMicrosoftIdToken(idToken);
      logger.info(`[${requestId}] Verified Microsoft ID token claims`, { claims: idTokenClaims.xms_edov });

      const emailIsDomainVerified = idTokenClaims.xms_edov === true;
      if (!emailIsDomainVerified) {
        throw new Error('Email is not verified from Microsoft');
      }

      const verifiedEmail = idTokenClaims.email;
      if (!verifiedEmail) {
        throw new Error('No email claim in ID token');
      }

      // Verify the user's profile via Microsoft Graph using the access token
      logger.info(`[${requestId}] Fetching user profile from Microsoft Graph`);
      const graphResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!graphResponse.ok) {
        logger.error(
          `[${requestId}] Microsoft Graph API error: ${graphResponse.status} ${graphResponse.statusText}`
        );
        res.status(401).json({
          success: false,
          error: 'graph_api_error',
          message: `Microsoft Graph API error: ${graphResponse.status}`,
        });
        return;
      }

      const profile = (await graphResponse.json()) as {
        id: string;
        mail?: string;
        userPrincipalName?: string;
        displayName: string;
      };

      const email = verifiedEmail;

      const workspaces = await this.userService.getWorkspacesByEmail(email);
      logger.info(`[${requestId}] User has ${workspaces.length} workspace(s)`);

      logger.info(`[${requestId}] Finding/creating user: ${email}`);
      const { user, isNewUser } = await this.userService.findOrCreateOAuthUser({
        provider: AuthProvider.MICROSOFT,
        providerUserId: profile.id,
        email,
        name: profile.displayName,
        picture: undefined,
      }, workspaces[0]?.id ?? '');

      await this.userService.ensureUserPresence(user.id, user.workspaceId);

      logger.info(
        `[${requestId}] User resolved: ${user.email} (ID: ${user.id}, isNew: ${isNewUser})`
      );

      // Create a user session with the Microsoft refresh token (held on the
      // backend so it can refresh access tokens without involving the mobile app).
      let sessionId: string | null = null;
      const refreshToken = token.refresh_token as string | undefined;
      if (refreshToken) {
        try {
          const refreshTokenExpiry = new Date();
          refreshTokenExpiry.setDate(refreshTokenExpiry.getDate() + 30);

          const expiresIn = token.expires_in as number | undefined;
          const session = await this.userSessionService.createSession({
            userId: user.id,
            refreshToken,
            refreshTokenExpiry,
            accessToken,
            accessTokenExpiry: expiresIn
              ? new Date(Date.now() + expiresIn * 1000)
              : undefined,
            deviceInfo: JSON.stringify({
              userAgent: req.headers['user-agent'],
              acceptLanguage: req.headers['accept-language'],
              timestamp: new Date().toISOString(),
              platform: 'mobile',
            }),
            ipAddress: req.ip || req.socket.remoteAddress || undefined,
          });

          sessionId = session.id;
          logger.info(`[${requestId}] Session created`);
        } catch (sessionError) {
          logger.error(`[${requestId}] Error creating user session:`, sessionError);
          // Continue without session creation - not critical for login
        }
      }

      // Set the same cookies that the Google mobile exchange endpoint sets
      const isProduction = process.env.NODE_ENV === 'production';
      const cookieOptions: {
        httpOnly: boolean;
        secure: boolean;
        sameSite: 'strict' | 'lax' | 'none';
        path: string;
      } = {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'lax',
        path: '/',
      };

      // Pending-auth cookie must carry provider identity (providerUserId +
      // provider) so a later loginWorkspace / createOrg / acceptInvitation call
      // resolves the Microsoft user correctly. Mirrors Google's mobile exchange.
      const mobileExpiresIn = token.expires_in as number | undefined;
      res.cookie('google_access_token', jwt.sign({
        providerUserId: profile.id,
        email,
        name: profile.displayName,
        picture: undefined,
        provider: 'microsoft',
        refreshToken: refreshToken ?? null,
        accessToken: accessToken ?? null,
        accessTokenExpiry: mobileExpiresIn
          ? new Date(Date.now() + mobileExpiresIn * 1000).toISOString()
          : undefined,
        connectCalendar: req.body?.connectCalendar === true,
      }, process.env.JWT_SECRET!, { expiresIn: '10m' }), {
        ...cookieOptions,
        maxAge: 10 * 60 * 1000, // 10 minutes pending auth window
      });

      if (sessionId) {
        res.cookie('user_session_id', sessionId, {
          ...cookieOptions,
          maxAge: 30 * 24 * 60 * 60 * 1000,
        });
      }

      if (isNewUser) {
        res.cookie('is_new_user', 'true', {
          ...cookieOptions,
          maxAge: 24 * 60 * 60 * 1000,
        });
      }

      res.json({
        success: true,
        userId: user.id,
        sessionId,
        isNewUser,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`[${requestId}] Microsoft mobile exchange failed: ${errorMessage}`);
      res.status(500).json({
        success: false,
        error: 'exchange_failed',
        message: errorMessage,
      });
    }
  };
}