import express, { type Request, type Response } from 'express';
import { AuthProvider, UserStatus } from '@xyne/shared';
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';
import { AuthorizationCode } from 'simple-oauth2';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { authMiddleware } from '@/middleware/auth';
import { repositories } from '@/database/repositories';
import { persistCalendarOAuthCredentials } from '@/services/calendarTokenRefresh';
import {
  calendarOAuthStateService,
  type CalendarOAuthPlatform,
  type CalendarOAuthState,
} from '@/services/calendarOAuthStateService';
import {
  buildCalendarOAuthRedirect,
  isCalendarOAuthStateBoundToUser,
  normalizeCalendarOAuthEmail,
  providerFromAuthProvider,
} from '@/services/calendarOAuthFlow';
import { logger } from '@/utils/logger';
import { getBackendUrl, getFrontendUrl } from '@/utils/publicUrls';

const router = express.Router();

const GOOGLE_CALENDAR_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
];
const MICROSOFT_CALENDAR_SCOPES = [
  'openid',
  'email',
  'profile',
  'User.Read',
  'offline_access',
  'Calendars.Read',
];

type MicrosoftIdTokenClaims = JWTPayload & {
  email?: string;
  preferred_username?: string;
  xms_edov?: boolean;
  tid?: string;
};

function getGoogleRedirectUri(req: Request): string {
  return `${getBackendUrl(req)}/api/calendar/oauth/google/callback`;
}

function getMicrosoftRedirectUri(req: Request): string {
  return `${getBackendUrl(req)}/api/calendar/oauth/microsoft/callback`;
}

function createGoogleClient(req: Request): OAuth2Client {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth is not configured');
  }

  return new OAuth2Client(clientId, clientSecret, getGoogleRedirectUri(req));
}

function createMicrosoftClient(): AuthorizationCode {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  const tenantId = process.env.MICROSOFT_TENANT_ID || 'common';
  if (!clientId || !clientSecret) {
    throw new Error('Microsoft OAuth is not configured');
  }

  return new AuthorizationCode({
    client: { id: clientId, secret: clientSecret },
    auth: {
      authorizeHost: 'https://login.microsoftonline.com',
      authorizePath: `/${tenantId}/oauth2/v2.0/authorize`,
      tokenHost: 'https://login.microsoftonline.com',
      tokenPath: `/${tenantId}/oauth2/v2.0/token`,
    },
    options: {
      authorizationMethod: 'body',
      bodyFormat: 'form',
    },
  });
}

function getPlatform(req: Request): CalendarOAuthPlatform {
  return req.body?.platform === 'electron' ? 'electron' : 'web';
}

function redirectWithError(
  req: Request,
  res: Response,
  state: Pick<CalendarOAuthState, 'workspaceId' | 'platform'> | null,
  error: string
): void {
  const frontendUrl = getFrontendUrl(req);
  if (!state) {
    res.redirect(`${frontendUrl}/?calendarOAuthError=${encodeURIComponent(error)}`);
    return;
  }

  res.redirect(buildCalendarOAuthRedirect(frontendUrl, state, { calendarOAuthError: error }));
}

async function validateBoundUser(state: CalendarOAuthState) {
  const user = (await repositories.users.findById(
    state.ownerUserId,
  )) as Parameters<typeof isCalendarOAuthStateBoundToUser>[1];
  if (!isCalendarOAuthStateBoundToUser(state, user)) {
    throw new Error('The calendar authorization no longer matches the active workspace user');
  }
  return user;
}

function getTokenExpiry(token: Record<string, unknown>): Date | undefined {
  const expiresAt = token.expires_at;
  if (expiresAt instanceof Date) return expiresAt;
  if (typeof expiresAt === 'string' || typeof expiresAt === 'number') {
    const parsed = new Date(expiresAt);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  const expiresIn = Number(token.expires_in);
  return Number.isFinite(expiresIn) && expiresIn > 0
    ? new Date(Date.now() + expiresIn * 1000)
    : undefined;
}

async function verifyMicrosoftIdToken(idToken: string): Promise<MicrosoftIdTokenClaims> {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const configuredTenant = process.env.MICROSOFT_TENANT_ID || 'common';
  if (!clientId) throw new Error('Microsoft OAuth is not configured');

  const jwksTenant = configuredTenant === 'common' ? 'common' : configuredTenant;
  const jwks = createRemoteJWKSet(
    new URL(`https://login.microsoftonline.com/${jwksTenant}/discovery/v2.0/keys`)
  );
  const { payload } = await jwtVerify(idToken, jwks, { audience: clientId });
  const claims = payload as MicrosoftIdTokenClaims;
  const tenantId = claims.tid;
  const expectedIssuerTenant = configuredTenant === 'common' ? tenantId : configuredTenant;
  if (
    !expectedIssuerTenant ||
    claims.iss !== `https://login.microsoftonline.com/${expectedIssuerTenant}/v2.0`
  ) {
    throw new Error('Microsoft ID token has an invalid issuer');
  }
  if (claims.xms_edov !== true) {
    throw new Error('Microsoft account email is not verified');
  }
  return claims;
}

router.post('/init', authMiddleware.authenticate, async (req: Request, res: Response) => {
  try {
    const authenticatedUserId = req.user?.id;
    if (!authenticatedUserId) {
      res.status(401).json({ success: false, error: 'authentication_required' });
      return;
    }

    const user = await repositories.users.findById(authenticatedUserId);
    if (
      !user ||
      user.status !== UserStatus.ACTIVE ||
      user.leftAt !== null ||
      user.workspaceId !== req.user?.workspaceId
    ) {
      res.status(403).json({ success: false, error: 'inactive_workspace_user' });
      return;
    }

    const provider = providerFromAuthProvider(user.authProvider as AuthProvider);
    if (!provider) {
      res.status(400).json({ success: false, error: 'unsupported_calendar_provider' });
      return;
    }

    const platform = getPlatform(req);
    const { state, codeChallenge } = await calendarOAuthStateService.create({
      provider,
      ownerUserId: user.id,
      workspaceId: user.workspaceId,
      expectedEmail: user.email,
      platform,
    });

    let authUrl: string;
    if (provider === 'GOOGLE') {
      authUrl = createGoogleClient(req).generateAuthUrl({
        access_type: 'offline',
        scope: GOOGLE_CALENDAR_SCOPES,
        prompt: 'consent',
        include_granted_scopes: true,
        login_hint: user.email,
        redirect_uri: getGoogleRedirectUri(req),
        state,
        code_challenge: codeChallenge,
        code_challenge_method: CodeChallengeMethod.S256,
      });
    } else {
      authUrl = createMicrosoftClient().authorizeURL({
        redirect_uri: getMicrosoftRedirectUri(req),
        scope: MICROSOFT_CALENDAR_SCOPES,
        state,
        prompt: 'consent',
        login_hint: user.email,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      } as Record<string, string | string[]>);
    }

    logger.info('[CALENDAR_SYNC][OAUTH] Authorization initialized', {
      provider,
      ownerUserId: user.id,
      workspaceId: user.workspaceId,
      platform,
    });
    res.json({ success: true, provider, authUrl });
  } catch (error) {
    logger.error('[CALENDAR_SYNC][OAUTH] Failed to initialize authorization', error);
    res.status(500).json({ success: false, error: 'calendar_oauth_init_failed' });
  }
});

router.get('/google/callback', async (req: Request, res: Response) => {
  const stateParam = typeof req.query.state === 'string' ? req.query.state : '';
  let peekedState: CalendarOAuthState | null = null;

  try {
    peekedState = stateParam ? await calendarOAuthStateService.peek(stateParam) : null;
    if (req.query.error) {
      if (stateParam) await calendarOAuthStateService.delete(stateParam);
      redirectWithError(req, res, peekedState, 'authorization_denied');
      return;
    }

    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (!code || !stateParam || !peekedState) {
      if (stateParam) await calendarOAuthStateService.delete(stateParam);
      redirectWithError(req, res, peekedState, 'missing_or_expired_state');
      return;
    }

    const state = await calendarOAuthStateService.consume(stateParam);
    if (!state || state.provider !== 'GOOGLE') {
      redirectWithError(req, res, peekedState, 'invalid_oauth_state');
      return;
    }

    const user = await validateBoundUser(state);
    const client = createGoogleClient(req);
    const { tokens } = await client.getToken({
      code,
      redirect_uri: getGoogleRedirectUri(req),
      codeVerifier: state.codeVerifier,
    });
    if (!tokens.id_token || !tokens.access_token || !tokens.refresh_token) {
      throw new Error('Google did not return the required calendar credentials');
    }

    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (
      !payload?.email ||
      payload.email_verified !== true ||
      normalizeCalendarOAuthEmail(payload.email) !==
        normalizeCalendarOAuthEmail(state.expectedEmail)
    ) {
      throw new Error('Google account does not match the signed-in user');
    }

    const sourceId = await persistCalendarOAuthCredentials({
      provider: AuthProvider.GOOGLE,
      email: payload.email,
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token,
      accessTokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
      ownerUserId: user.id,
    });
    if (!sourceId) throw new Error('Failed to persist Google Calendar credentials');

    logger.info('[CALENDAR_SYNC][GOOGLE][OAUTH] Authorization completed', {
      ownerUserId: user.id,
      workspaceId: state.workspaceId,
      sourceId,
    });
    res.redirect(
      buildCalendarOAuthRedirect(getFrontendUrl(req), state, {
        calendarOAuth: 'success',
        syncCalendar: 'true',
      })
    );
  } catch (error) {
    logger.error('[CALENDAR_SYNC][GOOGLE][OAUTH] Callback failed', error);
    redirectWithError(req, res, peekedState, 'google_calendar_oauth_failed');
  }
});

router.get('/microsoft/callback', async (req: Request, res: Response) => {
  const stateParam = typeof req.query.state === 'string' ? req.query.state : '';
  let peekedState: CalendarOAuthState | null = null;

  try {
    peekedState = stateParam ? await calendarOAuthStateService.peek(stateParam) : null;
    if (req.query.error) {
      if (stateParam) await calendarOAuthStateService.delete(stateParam);
      redirectWithError(req, res, peekedState, 'authorization_denied');
      return;
    }

    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (!code || !stateParam || !peekedState) {
      if (stateParam) await calendarOAuthStateService.delete(stateParam);
      redirectWithError(req, res, peekedState, 'missing_or_expired_state');
      return;
    }

    const state = await calendarOAuthStateService.consume(stateParam);
    if (!state || state.provider !== 'MICROSOFT') {
      redirectWithError(req, res, peekedState, 'invalid_oauth_state');
      return;
    }

    const user = await validateBoundUser(state);
    const microsoftClient = createMicrosoftClient();
    const tokenResult = await microsoftClient.getToken({
      code,
      redirect_uri: getMicrosoftRedirectUri(req),
      scope: MICROSOFT_CALENDAR_SCOPES.join(' '),
      code_verifier: state.codeVerifier,
    } as Parameters<typeof microsoftClient.getToken>[0]);
    const token = tokenResult.token as Record<string, unknown>;
    const idToken = typeof token.id_token === 'string' ? token.id_token : '';
    const accessToken = typeof token.access_token === 'string' ? token.access_token : '';
    const refreshToken = typeof token.refresh_token === 'string' ? token.refresh_token : '';
    if (!idToken || !accessToken || !refreshToken) {
      throw new Error('Microsoft did not return the required calendar credentials');
    }

    const claims = await verifyMicrosoftIdToken(idToken);
    const providerEmail = claims.email ?? claims.preferred_username;
    if (
      !providerEmail ||
      normalizeCalendarOAuthEmail(providerEmail) !==
        normalizeCalendarOAuthEmail(state.expectedEmail)
    ) {
      throw new Error('Microsoft account does not match the signed-in user');
    }

    const sourceId = await persistCalendarOAuthCredentials({
      provider: AuthProvider.MICROSOFT,
      email: providerEmail,
      refreshToken,
      accessToken,
      accessTokenExpiry: getTokenExpiry(token),
      ownerUserId: user.id,
    });
    if (!sourceId) throw new Error('Failed to persist Microsoft Calendar credentials');

    logger.info('[CALENDAR_SYNC][MICROSOFT][OAUTH] Authorization completed', {
      ownerUserId: user.id,
      workspaceId: state.workspaceId,
      sourceId,
    });
    res.redirect(
      buildCalendarOAuthRedirect(getFrontendUrl(req), state, {
        calendarOAuth: 'success',
        syncCalendar: 'true',
      })
    );
  } catch (error) {
    logger.error('[CALENDAR_SYNC][MICROSOFT][OAUTH] Callback failed', error);
    redirectWithError(req, res, peekedState, 'microsoft_calendar_oauth_failed');
  }
});

export default router;
