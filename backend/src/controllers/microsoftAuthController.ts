import { Request, Response } from 'express';
import { AuthorizationCode } from 'simple-oauth2';
import { logger } from '../utils/logger';
import { UserService } from '../services/userService';
import { UserSessionService } from '../services/userSessionService';
import { jwtService } from '../services/jwtService';
import { oauthStateServiceV2 } from '../services/oauthStateServiceV2';
import { pkceServiceV2 } from '../services/pkceServiceV2';
import { AuthProvider } from '@prisma/client';
import '../types/express';
import { config } from '@/config/env';

export class MicrosoftAuthController {
  private oauthClient: AuthorizationCode | undefined;
  private userService: UserService | undefined;
  private userSessionService: UserSessionService | undefined;

  constructor() {
    const clientId = process.env.MICROSOFT_CLIENT_ID;
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
    const tenantId = process.env.MICROSOFT_TENANT_ID || 'common';

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
      },
    });

    this.userService = new UserService();
    this.userSessionService = new UserSessionService();
  }

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

  initiateLogin = async (req: Request, res: Response): Promise<void> => {
    const requestId = `MS_LOGIN_${Date.now()}`;

    try {
      if (this.oauthClient) {
        // return an error that MS auth not setup
        logger.info(`[${requestId}] Initiating Microsoft OAuth login`);

        const codeVerifier = pkceServiceV2.generateCodeVerifier();
        const codeChallenge = pkceServiceV2.generateCodeChallenge(codeVerifier);

        const state = await oauthStateServiceV2.generateState('web', codeChallenge);

        await pkceServiceV2.storeVerifier(state, codeVerifier);

        const redirectUri = `${this.getBackendUrl(req)}/api/v2/auth/microsoft/callback`;

        logger.info('[X-Original-Host] : Redirect URI:', redirectUri);

        const authorizationUri = this.oauthClient.authorizeURL({
          redirect_uri: redirectUri,
          scope: ['openid', 'email', 'profile', 'User.Read'],
          state,
          code_challenge: codeChallenge,
          code_challenge_method: 'S256',
          prompt: 'select_account',
        } as Record<string, string | string[]>);

        logger.info(`[${requestId}] Redirecting to Microsoft OAuth`);
        res.redirect(authorizationUri);
      } else {
        logger.error(`[${requestId}] Microsoft OAuth client not configured`);
        const frontendUrl = this.getFrontendUrl(req);
        res.redirect(
          `${frontendUrl}?error=microsoft_not_configured&message=${encodeURIComponent('Microsoft SSO is not configured')}`
        );
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`[${requestId}] Error initiating Microsoft login: ${errorMessage}`);

      const frontendUrl = this.getFrontendUrl(req);
      res.redirect(
        `${frontendUrl}?error=oauth_init_failed&message=${encodeURIComponent(errorMessage)}`
      );
    }
  };

  handleCallback = async (req: Request, res: Response): Promise<void> => {
    const requestId = `MS_CALLBACK_${Date.now()}`;

    try {
      if (this.oauthClient && this.userService && this.userSessionService) {
        const { code, state, error } = req.query;

        logger.info(`[${requestId}] Microsoft OAuth callback received`);

        if (error) {
          logger.error(`[${requestId}] Microsoft OAuth error: ${error}`);
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

        // Validate state
        const stateData = await oauthStateServiceV2.validateState(state as string);
        if (!stateData) {
          logger.error(`[${requestId}] Invalid or expired state`);
          const frontendUrl = this.getFrontendUrl(req);
          res.redirect(
            `${frontendUrl}?error=invalid_state&message=${encodeURIComponent('Invalid or expired session state')}`
          );
          return;
        }

        // Get and delete code verifier for PKCE (atomic operation)
        const codeVerifier = await pkceServiceV2.getAndDeleteVerifier(state as string);
        if (!codeVerifier) {
          logger.error(`[${requestId}] Code verifier not found`);
          const frontendUrl = this.getFrontendUrl(req);
          res.redirect(
            `${frontendUrl}?error=pkce_error&message=${encodeURIComponent('PKCE verification failed')}`
          );
          return;
        }

        const redirectUri = `${this.getBackendUrl(req)}/api/v2/auth/microsoft/callback`;

        // Exchange code for tokens
        const tokenParams = {
          code: code as string,
          redirect_uri: redirectUri,
          scope: 'openid email profile User.Read',
          code_verifier: codeVerifier,
        };

        logger.info(`[${requestId}] Exchanging code for tokens`);
        const tokenResult = await this.oauthClient.getToken(tokenParams);
        const { token } = tokenResult;

        const accessToken = token.access_token as string;

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
          email: profile.mail || profile.userPrincipalName,
          name: profile.displayName,
          picture: undefined, // Microsoft Graph requires separate call for photo
        };

        if (!microsoftUserData.email) {
          throw new Error('Email not available in Microsoft profile');
        }

        logger.info(`[${requestId}] Finding/creating user: ${microsoftUserData.email}`);
        const { user, isNewUser } = await this.userService.findOrCreateOAuthUser({
          provider: AuthProvider.MICROSOFT,
          providerUserId: microsoftUserData.providerUserId,
          email: microsoftUserData.email,
          name: microsoftUserData.name,
          picture: microsoftUserData.picture,
        });

        // Ensure user presence entry exists
        await this.userService.ensureUserPresence(user.id);

        logger.info(
          `[${requestId}] User resolved: ${user.email} (ID: ${user.id}, isNew: ${isNewUser})`
        );

        // Generate custom JWT token
        const customToken = jwtService.generateToken({
          sub: user.id,
          email: user.email,
          name: user.name,
          picture: user.picture ?? undefined,
        });

        // Create user session
        let sessionId = null;
        const refreshToken = token.refresh_token as string | undefined;

        if (refreshToken) {
          try {
            logger.info(`[${requestId}] Creating user session with refresh token`);

            const refreshTokenExpiry = new Date();
            refreshTokenExpiry.setDate(refreshTokenExpiry.getDate() + 30); // 30 days

            const session = await this.userSessionService.createSession({
              userId: user.id,
              refreshToken: refreshToken,
              refreshTokenExpiry,
              accessToken: accessToken,
              accessTokenExpiry: token.expires_at ? new Date(token.expires_at as string) : undefined,
              deviceInfo: JSON.stringify({
                userAgent: req.headers['user-agent'],
                acceptLanguage: req.headers['accept-language'],
                timestamp: new Date().toISOString(),
              }),
              ipAddress: req.ip || req.socket.remoteAddress || undefined,
            });

            sessionId = session.id;
            logger.info(`[${requestId}] Session created: ${sessionId}`);
          } catch (sessionError) {
            logger.error(`[${requestId}] Error creating user session:`, sessionError);
            // Continue without session creation - not critical for login
          }
        }

        // Set HTTP-only cookies
        const isProduction = process.env.NODE_ENV === 'production';
        const cookieOptions: {
          httpOnly: boolean;
          secure: boolean;
          sameSite: 'strict' | 'lax' | 'none';
          path: string;
        } = {
          httpOnly: true,
          secure: isProduction,
          sameSite: 'strict',
          path: '/',
        };

        // Set auth token cookie
        res.cookie('google_access_token', customToken, {
          ...cookieOptions,
          maxAge: config.jwt.expirationSeconds * 1000,
        });

        // Set session ID cookie
        if (sessionId) {
          res.cookie('user_session_id', sessionId, {
            ...cookieOptions,
            maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
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
        const params = new URLSearchParams({
          success: 'true',
        });

        const frontendUrl = this.getFrontendUrl(req);
        logger.info(`[${requestId}] Redirecting to frontend: ${frontendUrl}?${params.toString()}`);
        res.redirect(`${frontendUrl}?${params.toString()}`);
      } else {
        logger.error(`[${requestId}] Microsoft OAuth client not configured`);
        const frontendUrl = this.getFrontendUrl(req);
        res.redirect(
          `${frontendUrl}?error=microsoft_not_configured&message=${encodeURIComponent('Microsoft SSO is not configured')}`
        );
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`[${requestId}] Microsoft OAuth callback failed: ${errorMessage}`);

      const frontendUrl = this.getFrontendUrl(req);
      res.redirect(`${frontendUrl}?error=auth_failed&message=${encodeURIComponent(errorMessage)}`);
    }
  };
}
