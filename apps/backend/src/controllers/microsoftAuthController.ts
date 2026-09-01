import { Request, Response } from 'express';
import { AuthorizationCode } from 'simple-oauth2';
import { logger } from '../utils/logger';
import { UserService } from '../services/userService';
import { UserSessionService } from '../services/userSessionService';
import { oauthStateServiceV2 } from '../services/oauthStateServiceV2';
import { pkceServiceV2 } from '../services/pkceServiceV2';

import '../types/express';
import { jwtService } from '../services/jwtService';
import { config } from '@/config/env';
import jwt from 'jsonwebtoken';
import { getFrontendUrl, resolveConfiguredOAuthRedirectUrl } from '@/utils/publicUrls';
import { jwtVerify, createRemoteJWKSet } from 'jose';
import { WorkspaceType, AuthProvider } from '@xyne/shared';
import {
  OrganizationDomainConflictError,
  PublicEmailDomainError,
  organizationDomainService,
} from '@/services/organizationDomainService';
import { migrateLegacyIdentity } from '@/services/legacyIdentityMigrationHelper';
import { signMicrosoftInvitationPendingAuthToken } from '@/utils/microsoftPendingAuth';
import { redisService } from '@/services/redisService';
import { randomUUID } from 'crypto';
import { setOnboardingCookie } from '@/utils/onboardingCookie';

const authTag = (flowId: string): string => `[AUTH][flow=${flowId}]`;
const workspaceOutcome = (count: number): string =>
  count === 0 ? 'no_workspace' : count === 1 ? 'single_workspace' : 'multi_workspace';

export class MicrosoftAuthController {
  private oauthClient: AuthorizationCode | undefined;
  private userService: UserService | undefined;
  private userSessionService: UserSessionService | undefined;
  private clientId: string | undefined;
  private tenantId: string = '';
  private msJwks!: ReturnType<typeof createRemoteJWKSet>;

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

  private getMicrosoftAuthScopes(): string[] {
    return ['openid', 'email', 'profile', 'User.Read', 'offline_access'];
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

  initiateLogin = async (req: Request, res: Response): Promise<void> => {
    const flowId = randomUUID();
    const tag = (): string => authTag(flowId);

    try {
      if (this.oauthClient) {
        // return an error that MS auth not setup
        logger.info(`${tag()} Microsoft OAuth login initiated`);

        const platformQuery = req.query.platform;
        const platform: 'mobile' | 'electron' | 'web' =
          platformQuery === 'mobile'
            ? 'mobile'
            : platformQuery === 'electron'
              ? 'electron'
              : 'web';
        logger.info(`${tag()} Platform detected: ${platform}`);

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

        const enterpriseLogin = req.query.enterpriseLogin === 'true';

        const state = await oauthStateServiceV2.generateState(
          platform,
          codeChallenge,
          validatedRedirectTo,
          'microsoft',
          undefined,
          invitationId,
          enterpriseLogin,
          flowId,
        );

        await pkceServiceV2.storeVerifier(state, codeVerifier);

        // The callback echoes this state back via the HttpOnly cookie. sameSite=lax lets the
        // cookie ride Microsoft's top-level callback redirect. Mirrors the Google flow; only
        // the web callback verifies it.
        const isProduction = process.env.NODE_ENV === 'production';
        res.cookie('oauth_state', state, {
          httpOnly: true,
          secure: isProduction,
          sameSite: 'lax' as const,
          maxAge: 10 * 60 * 1000,
          path: '/',
        });

        const redirectUri = this.getMicrosoftRedirectUri(req);

        logger.info(`${tag()} Redirect URI: ${redirectUri}`);

        const authorizationUri = this.oauthClient.authorizeURL({
          redirect_uri: redirectUri,
          scope: this.getMicrosoftAuthScopes(),
          state,
          code_challenge: codeChallenge,
          code_challenge_method: 'S256',
          prompt: 'select_account',
        } as Record<string, string | string[]>);

        logger.info(`${tag()} Redirecting to Microsoft OAuth`);
        res.redirect(authorizationUri);
      } else {
        logger.error(`${tag()} Microsoft OAuth not configured`);
        const frontendUrl = getFrontendUrl(req);
        res.redirect(
          `${frontendUrl}?error=microsoft_not_configured&message=${encodeURIComponent('Microsoft SSO is not configured')}`
        );
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`${tag()} Microsoft OAuth login initiate failed: ${errorMessage}`);

      const frontendUrl = getFrontendUrl(req);
      res.redirect(
        `${frontendUrl}?error=oauth_init_failed&message=${encodeURIComponent(errorMessage)}`
      );
    }
  };

  private async verifyMicrosoftIdToken(idToken: string) {
    const { payload } = await jwtVerify(idToken, this.msJwks, {
      audience: this.clientId,
      // issuer: `https://login.microsoftonline.com/${this.tenantId}/v2.0`, unpinned for multi-tenet
    });
    return payload as {
      email?: string;
      name?: string;
      preferred_username?: string;
      xms_edov?: boolean;
      oid?: string;
      sub?: string;
      tid?: string;
    };
  }

  handleCallback = async (req: Request, res: Response): Promise<void> => {
    let resolvedPlatform: string = 'web';
    let peekedState: Awaited<ReturnType<typeof oauthStateServiceV2.validateState>> = null;
    let flowId = 'web-login';
    const tag = (): string => authTag(flowId);

    try {
      if (this.oauthClient && this.userService && this.userSessionService) {
        const { code, state, error } = req.query;

        logger.info(`${tag()} Microsoft OAuth callback received`);

        // Peek at state early to determine platform for error redirects
        if (state) {
          peekedState = await oauthStateServiceV2.validateState(state as string, false);
          if (peekedState) {
            resolvedPlatform = peekedState.platform;
            flowId = peekedState.flowId ?? `${resolvedPlatform}-login`;
          }
        }
        logger.info(`${tag()} Microsoft OAuth state validated (platform=${resolvedPlatform}, stateFound=${!!peekedState}, invitationId=${peekedState?.invitationId || 'none'})`);

        if (error) {
          logger.error(`${tag()} Microsoft OAuth provider returned error: ${error}`);
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
          logger.error(`${tag()} Missing code or state`);
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
          logger.info(`${tag()} Microsoft OAuth login handed off to Electron (outcome=electron_handoff) — redirecting to launch page: ${launchUrl}`);
          res.redirect(launchUrl);
          return;
        }

        // The state must match the oauth_state cookie. Only the browser-driven path is
        // checked: electron returned above, and the mobile app posts code+state directly
        // rather than being redirected here. `resolvedPlatform` comes from the stored state
        // record.
        if (resolvedPlatform !== 'mobile') {
          const boundState = req.cookies?.oauth_state as string | undefined;
          res.clearCookie('oauth_state', { path: '/' });
          if (!boundState || boundState !== state) {
            logger.error(`${tag()} OAuth state cookie missing or mismatched — rejecting`);
            await oauthStateServiceV2.deleteState(state as string);
            res.redirect(
              this.getRedirectUrl(req, resolvedPlatform, {
                error: 'invalid_state',
                message: 'Login session expired or invalid. Please try signing in again.',
              })
            );
            return;
          }
        }

        // Now consume the state (delete it)
        await oauthStateServiceV2.deleteState(state as string);

        // Get and delete code verifier for PKCE (atomic operation)
        const codeVerifier = await pkceServiceV2.getAndDeleteVerifier(state as string);
        if (!codeVerifier) {
          logger.error(`${tag()} PKCE verifier not found`);
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
          scope: this.getMicrosoftAuthScopes().join(' '),
          code_verifier: codeVerifier,
        };

        logger.info(`${tag()} Exchanging code for tokens`);
        const tokenResult = await this.oauthClient.getToken(tokenParams);
        const { token } = tokenResult;

        const idToken = token.id_token as string;
        if (!idToken) {
          throw new Error('No ID token received from Microsoft');
        }
        const idTokenClaims = await this.verifyMicrosoftIdToken(idToken);
        const verifiedEmail = idTokenClaims.email;
        if (!verifiedEmail) {
          throw new Error('No email claim in ID token');
        }

        const accessToken = token.access_token as string;
        const accessTokenExpiry = this.getAccessTokenExpiry(token as Record<string, unknown>);

        if (!accessToken) {
          throw new Error('No access token received from Microsoft');
        }

        // Identity comes straight from the verified ID token — no Microsoft Graph
        // call needed. `sub` is the stable, app-scoped subject (like Google's sub)
        // and is what we persist as providerUserId; `oid` is tenant-scoped and only
        // kept here to migrate legacy rows off it (see below).
        if (!idTokenClaims.sub) {
          throw new Error('No sub claim in ID token');
        }

        const microsoftUserData = {
          provider: AuthProvider.MICROSOFT,
          providerUserId: idTokenClaims.sub,
          email: verifiedEmail,
          name: idTokenClaims.name ?? idTokenClaims.preferred_username ?? verifiedEmail,
          picture: undefined,
        };

        if (!microsoftUserData.email) {
          throw new Error('Email not available in Microsoft profile');
        }

        // MIGRATION: legacy Microsoft users were stored with the tenant-scoped `oid`
        // as providerUserId. Move any such rows for this email onto the stable `sub`
        // BEFORE the identity check, so those users match instead of being rejected.
        if (idTokenClaims.oid) {
          await this.userService.migrateProviderUserId(
            microsoftUserData.email,
            AuthProvider.MICROSOFT,
            idTokenClaims.oid,
            microsoftUserData.providerUserId,
          );
        }

        await migrateLegacyIdentity({
          email: microsoftUserData.email,
          authProvider: AuthProvider.MICROSOFT,
          providerUserId: microsoftUserData.providerUserId,
        });
        
        // SECURITY: reject provider mismatch before issuing any pending-auth cookie
        // or touching workspace state. Account linking is intentionally NOT done here
        // (it enables account takeover). If an account already exists for this email
        // under a different login method (providerUserId differs — e.g. Google), stop
        // and tell the UI to use the original method.
        const existingIdentity = await this.userService.findAuthIdentityByEmail(microsoftUserData.email);
        if (existingIdentity && existingIdentity.providerUserId !== microsoftUserData.providerUserId) {
          logger.warn(
            `${tag()} Provider mismatch for ${microsoftUserData.email}: account registered with ${existingIdentity.authProvider}, attempted login with MICROSOFT`,
          );
          res.redirect(
            this.getRedirectUrl(req, resolvedPlatform, {
              error: 'provider_mismatch',
              message: 'This account uses a different login method. Please continue with your original sign-in method.',
              existingProvider: existingIdentity.authProvider,
            })
          );
          return;
        }

        logger.info(`${tag()} Microsoft auth success for: ${microsoftUserData.email}`);
        const workspaces = this.getEnterpriseAwareWorkspaces(
          await this.userService.getWorkspacesByEmail(microsoftUserData.email),
          peekedState?.enterpriseLogin,
        );
        logger.info(`${tag()} User has ${workspaces.length} workspace(s) before invitation check`);

        const refreshToken = token.refresh_token as string | undefined;
        const isProduction = process.env.NODE_ENV === 'production';

        // Keep Microsoft provider tokens in Redis; the cookie contains identity
        // plus only the short-lived Redis lookup key.
        const cookieInvitationId = req.cookies?.pending_invitation_id as string | undefined;
        const pendingInvitationId = cookieInvitationId || peekedState?.invitationId;
        if (resolvedPlatform !== 'mobile' && pendingInvitationId) {
          const tokenKey = await this.storePendingOAuthTokens(
            refreshToken,
            accessToken,
            accessTokenExpiry,
          );
          res.cookie(
            'google_access_token',
            signMicrosoftInvitationPendingAuthToken(
              microsoftUserData,
              tokenKey,
              process.env.JWT_SECRET!,
            ),
            {
              httpOnly: true,
              secure: isProduction,
              sameSite: 'lax' as const,
              path: '/',
              maxAge: 10 * 60 * 1000,
            },
          );

          const frontendUrl = peekedState?.redirectTo ?? getFrontendUrl(req);
          logger.info(
            `${tag()} Microsoft OAuth login succeeded (platform=${resolvedPlatform}, outcome=pending_invitation, invitationId=${pendingInvitationId})`,
          );
          res.clearCookie('pending_invitation_id', { path: '/' });
          const inviteParams = new URLSearchParams({
            loginComplete: 'true',
            invitationId: pendingInvitationId,
            loggedInEmail: microsoftUserData.email,
          });
          res.redirect(`${frontendUrl}/invite?${inviteParams.toString()}`);
          return;
        }

        if (resolvedPlatform !== 'mobile' && workspaces.length === 0) {
          const userExistsButRemoved = await this.userService.userExistsButNoActiveWorkspaces(
            microsoftUserData.email,
          );


          let domainConflict = null;
          let domainConflictError = null;
          let publicEmailError = null;

          if (!userExistsButRemoved) {
            if (peekedState?.enterpriseLogin) {
              try {
                await organizationDomainService.assertCanCreateOrgForEmail(microsoftUserData.email);
              } catch (error) {
                if (error instanceof PublicEmailDomainError) {
                  publicEmailError = error;
                } else if (error instanceof OrganizationDomainConflictError) {
                  domainConflictError = error;
                }
              }
            }

            if (!domainConflictError && !publicEmailError) {
              domainConflict = await organizationDomainService.findEnterpriseWorkspaceByEmailDomain(microsoftUserData.email);
              domainConflictError = domainConflict
                ? new OrganizationDomainConflictError(domainConflict.domain, domainConflict)
                : null;
            }
          }

          const tokenKey = await this.storePendingOAuthTokens(
            refreshToken,
            accessToken,
            accessTokenExpiry,
          );
          res.cookie('google_access_token', jwt.sign({
            providerUserId: microsoftUserData.providerUserId,
            email: microsoftUserData.email,
            name: microsoftUserData.name,
            picture: microsoftUserData.picture,
            provider: AuthProvider.MICROSOFT,
            tokenKey,
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
            params.set('enterpriseJoinOrgName', domainConflict.name);
            params.set('enterpriseJoinWorkspaces', JSON.stringify(domainConflict.workspaces));
          }
          if (publicEmailError) {
            params.set('publicEmailDomainError', publicEmailError.message);
          }

          logger.info(
            `${tag()} Microsoft OAuth login succeeded (platform=${resolvedPlatform}, outcome=no_workspace, count=0) — redirecting for org creation`,
          );
          res.redirect(`${frontendUrl}?${params.toString()}`);
          return;
        }

        logger.info(`${tag()} Finding/creating user: ${microsoftUserData.email}`);
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
          `${tag()} User resolved: ${user.email} (ID: ${user.id}, isNew: ${isNewUser})`
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

        // Handle mobile platform: relay to app deep link with the token (no server session needed).
        if (resolvedPlatform === 'mobile') {
          const mobileParams = new URLSearchParams({
            success: 'true',
            token: customToken,
            user_id: user.id,
            email: user.email,
            name: user.name,
          });

          const mobileRedirectUrl = `xyne-spaces://auth/microsoft/callback?${mobileParams.toString()}`;
          logger.info(`${tag()} Microsoft OAuth login succeeded (platform=mobile, outcome=${workspaceOutcome(workspaces.length)}, count=${workspaces.length}) — redirecting to mobile app`);
          res.redirect(mobileRedirectUrl);
          return;
        }


        const cookieOptions = {
          httpOnly: true,
          secure: isProduction,
          sameSite: 'lax' as const,
          path: '/',
        };

        // Pending identity cookie (bridge for loginWorkspace / create-org) — set for BOTH paths.
        const tokenKey = await this.storePendingOAuthTokens(
          refreshToken,
          accessToken,
          accessTokenExpiry,
        );
        res.cookie('google_access_token', jwt.sign({
          providerUserId: microsoftUserData.providerUserId,
          email: microsoftUserData.email,
          name: microsoftUserData.name,
          picture: microsoftUserData.picture,
          provider: AuthProvider.MICROSOFT,
          tokenKey,
        }, process.env.JWT_SECRET!, { expiresIn: '10m' }), {
          ...cookieOptions,
          maxAge: 10 * 60 * 1000, // 10 minutes pending auth window
        });

        const frontendUrl = peekedState?.redirectTo ?? getFrontendUrl(req);
        const params = new URLSearchParams({
          success: 'true',
          email: microsoftUserData.email,
          name: microsoftUserData.name,
          picture: microsoftUserData.picture || '',
          workspaces: JSON.stringify(workspaces),
          userExistsButRemoved: 'false',
        });

        if (workspaces.length === 1) {
          const workspaceId = workspaces[0]!.id;
          let sessionId: string | null = null;
          try {
            const refreshTokenExpiry = new Date();
            refreshTokenExpiry.setDate(refreshTokenExpiry.getDate() + config.session.expiryDays);
            const session = await this.userSessionService.createSession({
              userId: user.id,
              refreshToken: refreshToken || randomUUID(),
              refreshTokenExpiry,
              accessToken,
              accessTokenExpiry,
              deviceInfo: JSON.stringify({
                userAgent: req.headers['user-agent'],
                acceptLanguage: req.headers['accept-language'],
                timestamp: new Date().toISOString(),
              }),
              ipAddress: req.ip || req.socket.remoteAddress || undefined,
            });
            sessionId = session.id;
            logger.info(`${tag()} Session created`);
          } catch (sessionError) {
            logger.error(`${tag()} Error creating user session:`, sessionError);
          }

          res.cookie(`xyne_ws_${workspaceId}_token`, customToken, {
            ...cookieOptions,
            maxAge: config.jwt.expirationSeconds * 1000,
          });
          res.cookie('xyne_last_workspace', workspaceId, {
            ...cookieOptions,
            maxAge: 30 * 24 * 60 * 60 * 1000,
          });
          if (sessionId) {
            res.cookie('user_session_id', sessionId, {
              ...cookieOptions,
              maxAge: config.session.expiryDays * 24 * 60 * 60 * 1000,
            });
          }
          setOnboardingCookie(res, isNewUser, {
            secure: isProduction,
            sameSite: 'lax' as const,
            maxAge: 24 * 60 * 60 * 1000,
          });

          params.set('autoLoginWorkspace', workspaceId);
          logger.info(`${tag()} Microsoft OAuth login succeeded (platform=web, outcome=single_workspace, count=1)`);
          res.redirect(`${frontendUrl}?${params.toString()}`);
          return;
        }
        logger.info(`${tag()} Microsoft OAuth login succeeded (platform=web, outcome=${workspaceOutcome(workspaces.length)}, count=${workspaces.length})`);
        res.redirect(`${frontendUrl}?${params.toString()}`);
      } else {
        logger.error(`${tag()} Microsoft OAuth not configured`);
        res.redirect(
          this.getRedirectUrl(req, resolvedPlatform, {
            error: 'microsoft_not_configured',
            message: 'Microsoft SSO is not configured',
          })
        );
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`${tag()} Microsoft OAuth login failed (platform=${resolvedPlatform}): ${errorMessage}`);

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
    let flowId = 'electron-login';
    const tag = (): string => authTag(flowId);

    try {
      if (!this.oauthClient || !this.userService || !this.userSessionService) {
        logger.error(`${tag()} Microsoft OAuth not configured`);
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

      logger.info(`${tag()} Microsoft OAuth callback received (electron exchange)`);

      if (!code || !state) {
        logger.error(`${tag()} Missing code or state`);
        res.status(400).json({
          success: false,
          error: 'missing_params',
          message: 'code and state are required',
        });
        return;
      }

      const isCodeUsed = await oauthStateServiceV2.isCodeUsed(code);
      if (isCodeUsed) {
        logger.error(`${tag()} Authorization code already used`);
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
        logger.error(`${tag()} Invalid or expired state`);
        res.status(401).json({
          success: false,
          error: 'invalid_state',
          message: 'State parameter is invalid or expired',
        });
        return;
      }

      flowId = stateData.flowId ?? 'electron-login';
      logger.info(`${tag()} Microsoft OAuth state validated (platform=${stateData.platform})`);

      if (stateData.platform !== 'electron') {
        logger.error(`${tag()} Invalid platform: ${stateData.platform}`);
        res.status(400).json({
          success: false,
          error: 'invalid_platform',
          message: 'This endpoint is only for Electron platform',
        });
        return;
      }

      const codeVerifier = await pkceServiceV2.getAndDeleteVerifier(state);
      if (!codeVerifier) {
        logger.error(`${tag()} PKCE verifier not found`);
        res.status(401).json({
          success: false,
          error: 'pkce_failed',
          message: 'PKCE verification failed',
        });
        return;
      }

      await oauthStateServiceV2.markCodeAsUsed(code);

      const redirectUri = this.getMicrosoftRedirectUri(req);

      logger.info(`${tag()} Exchanging code for tokens`);
      const tokenResult = await this.oauthClient.getToken({
        code,
        redirect_uri: redirectUri,
        scope: this.getMicrosoftAuthScopes().join(' '),
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
      const email = idTokenClaims.email;
      if (!email) {
        throw new Error('No email claim in ID token');
      }

      // Identity comes from the verified ID token — no Microsoft Graph call needed.
      // `sub` is the stable, app-scoped subject we persist as providerUserId; `oid`
      // is tenant-scoped and kept only to migrate legacy rows off it.
      if (!idTokenClaims.sub) {
        throw new Error('No sub claim in ID token');
      }
      const profile = {
        id: idTokenClaims.sub,
        displayName: idTokenClaims.name ?? idTokenClaims.preferred_username ?? email,
      };

      // MIGRATION: legacy Microsoft users stored the tenant-scoped `oid` as
      // providerUserId. Move any such rows for this email onto the stable `sub`
      // before we resolve/create the user, so multi-tenant logins line up.
      if (idTokenClaims.oid) {
        await this.userService.migrateProviderUserId(
          email,
          AuthProvider.MICROSOFT,
          idTokenClaims.oid,
          profile.id,
        );
      }

      await migrateLegacyIdentity({
        email: email,
        authProvider: AuthProvider.MICROSOFT,
        providerUserId: profile.id,
      });

      // SECURITY: reject provider mismatch (runs AFTER migration so legacy oid
      // rows are already on sub). Account linking is intentionally not done here
      // (it enables account takeover). Mirrors the web callback + Google/email.
      const existingIdentity = await this.userService.findAuthIdentityByEmail(email);
      if (existingIdentity && existingIdentity.providerUserId !== profile.id) {
        logger.warn(
          `${tag()} Provider mismatch for ${email}: account registered with ${existingIdentity.authProvider}, attempted login with MICROSOFT`,
        );
        res.status(403).json({
          success: false,
          error: 'provider_mismatch',
          message: 'This account uses a different login method. Please continue with your original sign-in method.',
          existingProvider: existingIdentity.authProvider,
        });
        return;
      }

      logger.info(`${tag()} Microsoft auth success for: ${email}`);
      const workspaces = this.getEnterpriseAwareWorkspaces(
        await this.userService.getWorkspacesByEmail(email),
        stateData.enterpriseLogin,
      );
      const userExistsButRemoved = await this.userService.userExistsButNoActiveWorkspaces(email);
      logger.info(`${tag()} User has ${workspaces.length} workspace(s) before invitation check`);

      const isProduction = process.env.NODE_ENV === 'production';

      // If user has no workspaces and is not invited (not in org_members), redirect to no-access.
      // Still set google_access_token so that AuthScreen's isCreatingOrg + pendingInvitationId
      // path can redirect to /invite and acceptInvitation will have the identity cookie.
      // This mirrors Google's exchangeElectronCode which always sets google_access_token (line 842).
      if (workspaces.length === 0 && !userExistsButRemoved && !stateData.invitationId && !bodyInvitationId) {
        logger.info(`${tag()} Microsoft OAuth login succeeded (platform=electron, outcome=no_workspace, count=0) — no workspaces/invitation, returning no-access`);
        const tokenKey = await this.storePendingOAuthTokens(
          token.refresh_token as string | undefined,
          accessToken,
          accessTokenExpiry,
        );
        res.cookie('google_access_token', jwt.sign({
          providerUserId: profile.id,
          email,
          name: profile.displayName,
          picture: undefined,
          provider: 'microsoft',
          tokenKey,
        }, process.env.JWT_SECRET!, { expiresIn: '10m' }), {
          httpOnly: true,
          secure: isProduction,
          sameSite: 'lax' as const,
          path: '/',
          maxAge: 10 * 60 * 1000,
        });
        logger.info(`${tag()} google_access_token set for potential invite redirect (sameSite=lax, maxAge=10min)`);
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
      logger.info(`${tag()} Invitation check: effectiveInvitationId=${effectiveInvitationId || 'none'} → path=${effectiveInvitationId ? 'INVITATION' : 'WORKSPACE_LOGIN'}`);
      if (effectiveInvitationId) {
        logger.info(`${tag()} Microsoft OAuth login succeeded (platform=electron, outcome=pending_invitation, invitationId=${effectiveInvitationId})`);
        // Use sameSite: 'lax' for Electron invitation flow - cookies need to be sent
        // from the renderer (localhost:5173) to backend (localhost:3001)
        const tokenKey = await this.storePendingOAuthTokens(
          token.refresh_token as string | undefined,
          accessToken,
          accessTokenExpiry,
        );
        res.cookie('google_access_token', jwt.sign({
          providerUserId: profile.id,
          email,
          name: profile.displayName,
          picture: undefined,
          provider: 'microsoft',
          tokenKey,
        }, process.env.JWT_SECRET!, { expiresIn: '10m' }), {
          httpOnly: true,
          secure: isProduction,
          sameSite: 'lax' as const,
          path: '/',
          maxAge: 10 * 60 * 1000,
        });
        logger.info(`${tag()} google_access_token set for invitation (provider=microsoft, hasRefreshToken=${!!(token.refresh_token)}, sameSite=lax, maxAge=10min)`);
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

      logger.info(`${tag()} No invitation — proceeding to workspace login (workspaces=${workspaces.length}, userExistsButRemoved=${userExistsButRemoved})`);
      
      /**
       * AUTO-LOGIN SINGLE WORKSPACE USERS (Electron)
       * Mirrors Google behavior - auto-login when user has exactly 1 workspace
       */
      if (workspaces.length === 1) {
        const workspaceId = workspaces[0]!.id;
        logger.info(`${tag()} Single workspace detected - auto-logging in to ${workspaceId}`);

        const { user, isNewUser } = await this.userService.findOrCreateOAuthUser({
          provider: AuthProvider.MICROSOFT,
          providerUserId: profile.id,
          email,
          name: profile.displayName,
          picture: undefined,
        }, workspaceId);

        await this.userService.ensureUserPresence(user.id, user.workspaceId);

        logger.info(
          `${tag()} User resolved: ${user.email} (ID: ${user.id}, isNew: ${isNewUser})`
        );

        const customToken = jwtService.generateToken({
          sub: user.id,
          email: user.email,
          name: user.name,
          picture: user.picture ?? undefined,
          workspaceId: user.workspaceId ?? undefined,
          memberId: user.orgMemberId ?? undefined,
        });

        // Always create a session (fall back to a generated refresh token if Microsoft omitted one)
        // so user_session_id is always issued.
        let sessionId: string | null = null;
        const refreshToken = token.refresh_token as string | undefined;

        try {
          const refreshTokenExpiry = new Date();
          refreshTokenExpiry.setDate(refreshTokenExpiry.getDate() + 30);

          const session = await this.userSessionService.createSession({
            userId: user.id,
            refreshToken: refreshToken || randomUUID(),
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
          logger.info(`${tag()} Session created`);
        } catch (sessionError) {
          logger.error(`${tag()} Error creating user session:`, sessionError);
          // Continue without session creation - not critical for login
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
          maxAge: config.jwt.expirationSeconds * 1000,
        });

        if (sessionId) {
          res.cookie('user_session_id', sessionId, {
            ...cookieOptions,
            maxAge: 30 * 24 * 60 * 60 * 1000,
          });
        }

        setOnboardingCookie(res, isNewUser, {
          secure: isProduction,
          sameSite: 'strict' as const,
          maxAge: 24 * 60 * 60 * 1000,
        });

        const tokenKey = await this.storePendingOAuthTokens(
          refreshToken,
          accessToken,
          accessTokenExpiry,
        );
        res.cookie('google_access_token', jwt.sign({
          providerUserId: profile.id,
          email,
          name: profile.displayName,
          picture: undefined,
          provider: 'microsoft',
          tokenKey,
        }, process.env.JWT_SECRET!, { expiresIn: '10m' }), {
          httpOnly: true,
          secure: isProduction,
          sameSite: 'lax' as const,
          path: '/',
          maxAge: 10 * 60 * 1000,
        });

        logger.info(`${tag()} Microsoft OAuth login succeeded (platform=electron, outcome=single_workspace, count=1) — auto-login, cookies set`);

        // Return JSON with workspaces (Electron expects this for renderer to handle)
        res.status(200).json({
          success: true,
          email: user.email,
          name: user.name,
          picture: user.picture ?? undefined,
          workspaces,
          userExistsButRemoved: false,
        });
        return;
      }

      // MULTIPLE workspaces (or removed user) → SELECTION (Path B): pending cookie ONLY. No session
      // and no user_session_id here — the renderer shows the picker and loginWorkspace mints the 3
      // cookies. Mirrors Google's exchangeElectronCode multi branch (no user creation either).
      const tokenKey = await this.storePendingOAuthTokens(
        token.refresh_token as string | undefined,
        accessToken,
        accessTokenExpiry,
      );
      res.cookie('google_access_token', jwt.sign({
        providerUserId: profile.id,
        email,
        name: profile.displayName,
        picture: undefined,
        provider: 'microsoft',
        tokenKey,
      }, process.env.JWT_SECRET!, { expiresIn: '10m' }), {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'lax' as const,
        path: '/',
        maxAge: 10 * 60 * 1000,
      });

      logger.info(`${tag()} Microsoft OAuth login succeeded (platform=electron, outcome=${workspaceOutcome(workspaces.length)}, count=${workspaces.length}) — returning to selector`);
      res.status(200).json({
        success: true,
        email,
        name: profile.displayName,
        picture: undefined,
        workspaces,
        userExistsButRemoved: workspaces.length === 0,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`${tag()} Microsoft OAuth login failed (platform=electron): ${errorMessage}`);
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
    const flowId = 'native-mobile';
    const tag = (): string => authTag(flowId);

    try {
      logger.info(`${tag()} Microsoft OAuth callback received (mobile exchange, native)`);
      if (!this.oauthClient || !this.userService || !this.userSessionService) {
        logger.error(`${tag()} Microsoft OAuth not configured`);
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
        logger.error(`${tag()} Missing code, code_verifier, or redirect_uri`);
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
      logger.info(`${tag()} Exchanging code for tokens`);
      const tokenParams = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: this.clientId!,
        code,
        redirect_uri: redirectUri,
        scope: this.getMicrosoftAuthScopes().join(' '),
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
          `${tag()} Microsoft token endpoint error: ${tokenResponse.status} ${msError} - ${msDesc}`
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
      logger.info(`${tag()} Verified Microsoft ID token claims`, { claims: idTokenClaims.xms_edov });

      // const emailIsDomainVerified = idTokenClaims.xms_edov === true;
      // if (!emailIsDomainVerified) {
      //   throw new Error('Email is not verified from Microsoft');
      // }

      const verifiedEmail = idTokenClaims.email;
      if (!verifiedEmail) {
        throw new Error('No email claim in ID token');
      }

      // Identity comes from the verified ID token — no Microsoft Graph call needed.
      // `sub` is the stable, app-scoped subject we persist as providerUserId; `oid`
      // is tenant-scoped and kept only to migrate legacy rows off it.
      if (!idTokenClaims.sub) {
        throw new Error('No sub claim in ID token');
      }
      const profile = {
        id: idTokenClaims.sub,
        displayName: idTokenClaims.name ?? idTokenClaims.preferred_username ?? verifiedEmail,
      };

      const email = verifiedEmail;

      // MIGRATION: legacy Microsoft users stored the tenant-scoped `oid` as
      // providerUserId. Move any such rows for this email onto the stable `sub`
      // before we resolve/create the user, so multi-tenant logins line up.
      if (idTokenClaims.oid) {
        await this.userService.migrateProviderUserId(
          email,
          AuthProvider.MICROSOFT,
          idTokenClaims.oid,
          profile.id,
        );
      }

      await migrateLegacyIdentity({
        email: email,
        authProvider: AuthProvider.MICROSOFT,
        providerUserId: profile.id,
      });

      // SECURITY: reject provider mismatch (runs AFTER migration so legacy oid
      // rows are already on sub). Account linking is intentionally not done here
      // (it enables account takeover). Mirrors the web callback + Google/email.
      const existingIdentity = await this.userService.findAuthIdentityByEmail(email);
      if (existingIdentity && existingIdentity.providerUserId !== profile.id) {
        logger.warn(
          `${tag()} Provider mismatch for ${email}: account registered with ${existingIdentity.authProvider}, attempted login with MICROSOFT`,
        );
        res.status(403).json({
          success: false,
          error: 'provider_mismatch',
          message: 'This account uses a different login method. Please continue with your original sign-in method.',
          existingProvider: existingIdentity.authProvider,
        });
        return;
      }

      logger.info(`${tag()} Microsoft auth success for: ${email}`);
      const workspaces = await this.userService.getWorkspacesByEmail(email);
      logger.info(`${tag()} User has ${workspaces.length} workspace(s)`);

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

      const refreshToken = token.refresh_token as string | undefined;
      const mobileExpiresIn = token.expires_in as number | undefined;
      const mobileAccessTokenExpiry = mobileExpiresIn
        ? new Date(Date.now() + mobileExpiresIn * 1000)
        : undefined;

      // Always set the pending identity cookie (bridge for loginWorkspace / create-org). Provider
      // tokens live in Redis; the cookie holds only the lookup key.
      const tokenKey = await this.storePendingOAuthTokens(
        refreshToken,
        accessToken,
        mobileAccessTokenExpiry,
      );
      res.cookie('google_access_token', jwt.sign({
        providerUserId: profile.id,
        email,
        name: profile.displayName,
        picture: undefined,
        provider: 'microsoft',
        tokenKey,
      }, process.env.JWT_SECRET!, { expiresIn: '10m' }), {
        ...cookieOptions,
        maxAge: 10 * 60 * 1000, // 10 minutes pending auth window
      });

      // SINGLE workspace → AUTO-LOGIN (Path A): create the session + set all 3 real cookies and
      // return userId, so the shared mobile resolver treats it as authenticated (no picker).
      if (workspaces.length === 1) {
        const workspaceId = workspaces[0]!.id;

        const { user, isNewUser } = await this.userService.findOrCreateOAuthUser({
          provider: AuthProvider.MICROSOFT,
          providerUserId: profile.id,
          email,
          name: profile.displayName,
          picture: undefined,
        }, workspaceId);
        await this.userService.ensureUserPresence(user.id, user.workspaceId);

        const customToken = jwtService.generateToken({
          sub: user.id,
          email: user.email,
          name: user.name,
          picture: user.picture ?? undefined,
          workspaceId: user.workspaceId ?? undefined,
          memberId: user.orgMemberId ?? undefined,
        });
        
        let sessionId: string | null = null;
        try {
          const refreshTokenExpiry = new Date();
          refreshTokenExpiry.setDate(refreshTokenExpiry.getDate() + 30);
          const session = await this.userSessionService.createSession({
            userId: user.id,
            refreshToken: refreshToken || randomUUID(),
            refreshTokenExpiry,
            accessToken,
            accessTokenExpiry: mobileAccessTokenExpiry,
            deviceInfo: JSON.stringify({
              userAgent: req.headers['user-agent'],
              acceptLanguage: req.headers['accept-language'],
              timestamp: new Date().toISOString(),
              platform: 'mobile',
            }),
            ipAddress: req.ip || req.socket.remoteAddress || undefined,
          });
          sessionId = session.id;
          logger.info(`${tag()} Session created`);
        } catch (sessionError) {
          logger.error(`${tag()} Error creating user session:`, sessionError);
        }

        res.cookie(`xyne_ws_${workspaceId}_token`, customToken, {
          ...cookieOptions,
          maxAge: config.jwt.expirationSeconds * 1000,
        });
        res.cookie('xyne_last_workspace', workspaceId, {
          ...cookieOptions,
          maxAge: 30 * 24 * 60 * 60 * 1000,
        });
        if (sessionId) {
          res.cookie('user_session_id', sessionId, {
            ...cookieOptions,
            maxAge: 30 * 24 * 60 * 60 * 1000,
          });
        }
        setOnboardingCookie(res, isNewUser, {
          secure: isProduction,
          sameSite: 'lax' as const,
          maxAge: 24 * 60 * 60 * 1000,
        });

        logger.info(`${tag()} Microsoft OAuth login succeeded (platform=mobile, outcome=single_workspace, count=1)`);
        res.json({
          success: true,
          userId: user.id,
          sessionId,
          isNewUser,
          email: user.email,
          name: user.name,
          workspaces,
          userExistsButRemoved: false,
        });
        return;
      }

      // 0 or MULTIPLE workspaces → SELECTION / ORG-CREATION (Path B): pending cookie only. Return the
      // workspaces list WITHOUT a userId or session so the shared mobile resolver shows the picker
      // (multi) or the create-org flow (0). loginWorkspace mints the real cookies after the pick.
      const userExistsButRemoved = await this.userService.userExistsButNoActiveWorkspaces(email);
      logger.info(`${tag()} Microsoft OAuth login succeeded (platform=mobile, outcome=${workspaceOutcome(workspaces.length)}, count=${workspaces.length})`);
      res.json({
        success: true,
        email,
        name: profile.displayName,
        workspaces,
        userExistsButRemoved,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`${tag()} Microsoft OAuth login failed (platform=mobile): ${errorMessage}`);
      res.status(500).json({
        success: false,
        error: 'exchange_failed',
        message: errorMessage,
      });
    }
  };
}
