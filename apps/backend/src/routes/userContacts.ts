/**
 * User Contacts routes
 *
 * Powers "Add from Google/Microsoft Workspace" in the invite dialog:
 *   GET  /provider        — which provider the signed-in user can import from
 *   GET  /                — the user's provider contacts (requires a stored grant)
 *   POST /oauth/init      — start the incremental contacts OAuth (new scopes)
 *   GET  /oauth/:provider/callback — public, state-bound OAuth callbacks
 *
 * Modeled on routes/calendarOAuth.ts (per-user re-auth to add scopes).
 */

import express, { type Request, type Response } from 'express';
import { AuthProvider, UserStatus } from '@xyne/shared';
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';
import { AuthorizationCode } from 'simple-oauth2';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { authMiddleware } from '@/middleware/auth';
import { repositories } from '@/database/repositories';
import {
  contactsOAuthStateService,
  type ContactsOAuthPlatform,
  type ContactsOAuthState,
} from '@/services/contactsOAuthStateService';
import {
  isUserContactsConnected,
  listUserContacts,
  persistUserContactsCredentials,
  providerFromAuthProvider,
} from '@/services/userContactsService';
import { appendQueryToReturnPath, sanitizeReturnPath } from '@/integrations/routes/urlHelpers';
import { logger } from '@/utils/logger';
import { getBackendUrl, getFrontendUrl } from '@/utils/publicUrls';

const router = express.Router();

const GOOGLE_CONTACTS_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/contacts.readonly',
  'https://www.googleapis.com/auth/contacts.other.readonly',
];
const MICROSOFT_CONTACTS_SCOPES = [
  'openid',
  'email',
  'profile',
  'offline_access',
  'Contacts.Read',
  'People.Read',
];

type MicrosoftIdTokenClaims = JWTPayload & {
  email?: string;
  preferred_username?: string;
  xms_edov?: boolean;
  tid?: string;
};

function getGoogleRedirectUri(req: Request): string {
  return `${getBackendUrl(req)}/api/user-contacts/oauth/google/callback`;
}

function getMicrosoftRedirectUri(req: Request): string {
  return `${getBackendUrl(req)}/api/user-contacts/oauth/microsoft/callback`;
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

function getPlatform(req: Request): ContactsOAuthPlatform {
  return req.body?.platform === 'electron' ? 'electron' : 'web';
}

function defaultReturnPath(workspaceId: string): string {
  return `/${workspaceId}/chat`;
}

function redirectWithResult(
  req: Request,
  res: Response,
  state: Pick<ContactsOAuthState, 'returnPath' | 'workspaceId' | 'platform'>,
  params: URLSearchParams
): void {
  const frontendUrl = getFrontendUrl(req);
  const path = appendQueryToReturnPath(
    state.returnPath ?? defaultReturnPath(state.workspaceId),
    params
  );
  if (state.platform === 'electron') {
    res.redirect(`${frontendUrl}/launch?path=${encodeURIComponent(path)}`);
    return;
  }
  res.redirect(`${frontendUrl}${path}`);
}

function redirectWithError(
  req: Request,
  res: Response,
  state: Pick<ContactsOAuthState, 'returnPath' | 'workspaceId' | 'platform'> | null,
  error: string
): void {
  const frontendUrl = getFrontendUrl(req);
  if (!state) {
    res.redirect(`${frontendUrl}/?contactsImportError=${encodeURIComponent(error)}`);
    return;
  }

  redirectWithResult(req, res, state, new URLSearchParams({ contactsImportError: error }));
}

async function loadActiveWorkspaceUser(userId: string, workspaceId: string | undefined) {
  const user = await repositories.users.findById(userId);
  if (
    !user ||
    user.status !== UserStatus.ACTIVE ||
    user.leftAt !== null ||
    user.workspaceId !== workspaceId
  ) {
    return null;
  }
  return user;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function validateBoundUser(state: ContactsOAuthState) {
  const user = await loadActiveWorkspaceUser(state.ownerUserId, state.workspaceId);
  if (
    !user ||
    normalizeEmail(user.email) !== normalizeEmail(state.expectedEmail) ||
    providerFromAuthProvider(user.authProvider as AuthProvider) !== state.provider
  ) {
    throw new Error('The contacts authorization no longer matches the active workspace user');
  }
  return user;
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

/** GET /provider — the provider the signed-in user can import contacts from. */
router.get('/provider', authMiddleware.authenticate, async (req: Request, res: Response) => {
  try {
    const authenticatedUserId = req.user?.id;
    if (!authenticatedUserId) {
      res.status(401).json({ success: false, error: 'authentication_required' });
      return;
    }

    const user = await repositories.users.findById(authenticatedUserId);
    const provider = user ? providerFromAuthProvider(user.authProvider as AuthProvider) : null;
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, provider });
  } catch (error) {
    logger.error('[USER_CONTACTS] Failed to resolve provider', error);
    res.status(500).json({ success: false, error: 'contacts_provider_lookup_failed' });
  }
});

/** GET / — the signed-in user's provider contacts. */
router.get('/', authMiddleware.authenticate, async (req: Request, res: Response) => {
  try {
    const authenticatedUserId = req.user?.id;
    if (!authenticatedUserId) {
      res.status(401).json({ success: false, error: 'authentication_required' });
      return;
    }

    const user = await repositories.users.findById(authenticatedUserId);
    if (!user) {
      res.status(403).json({ success: false, error: 'inactive_workspace_user' });
      return;
    }

    const provider = providerFromAuthProvider(user.authProvider as AuthProvider);
    if (!provider) {
      res.json({ success: true, provider: null, connected: false, contacts: [] });
      return;
    }

    const connected = await isUserContactsConnected(user.id, provider);
    if (!connected) {
      res.json({ success: true, provider, connected: false, contacts: [] });
      return;
    }

    const contacts = await listUserContacts(user.id, provider);
    // The response is user-specific at a fixed URL — caching it lets a browser
    // serve the previous user's contacts (and skip OAuth) after logout/login.
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, provider, connected: true, contacts });
  } catch (error) {
    logger.error('[USER_CONTACTS] Failed to list contacts', error);
    res.status(500).json({ success: false, error: 'contacts_list_failed' });
  }
});

/** POST /oauth/init — start the incremental contacts authorization. */
router.post('/oauth/init', authMiddleware.authenticate, async (req: Request, res: Response) => {
  try {
    const authenticatedUserId = req.user?.id;
    if (!authenticatedUserId) {
      res.status(401).json({ success: false, error: 'authentication_required' });
      return;
    }

    const user = await loadActiveWorkspaceUser(authenticatedUserId, req.user?.workspaceId);
    if (!user) {
      res.status(403).json({ success: false, error: 'inactive_workspace_user' });
      return;
    }

    const provider = providerFromAuthProvider(user.authProvider as AuthProvider);
    if (!provider) {
      res.status(400).json({ success: false, error: 'unsupported_contacts_provider' });
      return;
    }

    const platform = getPlatform(req);
    const returnPath = sanitizeReturnPath(req.body?.returnPath);
    const { state, codeChallenge } = await contactsOAuthStateService.create({
      provider,
      ownerUserId: user.id,
      workspaceId: user.workspaceId,
      expectedEmail: user.email,
      ...(returnPath ? { returnPath } : {}),
      platform,
    });

    let authUrl: string;
    if (provider === 'GOOGLE') {
      authUrl = createGoogleClient(req).generateAuthUrl({
        access_type: 'offline',
        scope: GOOGLE_CONTACTS_SCOPES,
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
        scope: MICROSOFT_CONTACTS_SCOPES,
        state,
        prompt: 'consent',
        login_hint: user.email,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      } as Record<string, string | string[]>);
    }

    logger.info('[USER_CONTACTS][OAUTH] Authorization initialized', {
      provider,
      ownerUserId: user.id,
      workspaceId: user.workspaceId,
      platform,
    });
    res.json({ success: true, provider, authUrl });
  } catch (error) {
    logger.error('[USER_CONTACTS][OAUTH] Failed to initialize authorization', error);
    res.status(500).json({ success: false, error: 'contacts_oauth_init_failed' });
  }
});

router.get('/oauth/google/callback', async (req: Request, res: Response) => {
  const stateParam = typeof req.query.state === 'string' ? req.query.state : '';
  let peekedState: ContactsOAuthState | null = null;

  try {
    // Always validate: peek on an empty/unknown state returns null, which the
    // guard below rejects — the check must not depend on the query param.
    peekedState = await contactsOAuthStateService.peek(stateParam);
    if (req.query.error) {
      await contactsOAuthStateService.delete(stateParam);
      redirectWithError(req, res, peekedState, 'authorization_denied');
      return;
    }

    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (!code || !peekedState) {
      await contactsOAuthStateService.delete(stateParam);
      redirectWithError(req, res, peekedState, 'missing_or_expired_state');
      return;
    }

    const state = await contactsOAuthStateService.consume(stateParam);
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
      throw new Error('Google did not return the required contacts credentials');
    }

    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (
      !payload?.email ||
      payload.email_verified !== true ||
      normalizeEmail(payload.email) !== normalizeEmail(state.expectedEmail)
    ) {
      throw new Error('Google account does not match the signed-in user');
    }

    const sourceId = await persistUserContactsCredentials({
      provider: 'GOOGLE',
      email: payload.email,
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token,
      ...(tokens.expiry_date ? { accessTokenExpiry: new Date(tokens.expiry_date) } : {}),
      ownerUserId: user.id,
    });

    logger.info('[USER_CONTACTS][GOOGLE][OAUTH] Authorization completed', {
      ownerUserId: user.id,
      workspaceId: state.workspaceId,
      sourceId,
    });
    redirectWithResult(req, res, state, new URLSearchParams({ contactsImport: 'success' }));
  } catch (error) {
    logger.error('[USER_CONTACTS][GOOGLE][OAUTH] Callback failed', error);
    redirectWithError(req, res, peekedState, 'google_contacts_oauth_failed');
  }
});

router.get('/oauth/microsoft/callback', async (req: Request, res: Response) => {
  const stateParam = typeof req.query.state === 'string' ? req.query.state : '';
  let peekedState: ContactsOAuthState | null = null;

  try {
    // Always validate: peek on an empty/unknown state returns null, which the
    // guard below rejects — the check must not depend on the query param.
    peekedState = await contactsOAuthStateService.peek(stateParam);
    if (req.query.error) {
      await contactsOAuthStateService.delete(stateParam);
      redirectWithError(req, res, peekedState, 'authorization_denied');
      return;
    }

    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (!code || !peekedState) {
      await contactsOAuthStateService.delete(stateParam);
      redirectWithError(req, res, peekedState, 'missing_or_expired_state');
      return;
    }

    const state = await contactsOAuthStateService.consume(stateParam);
    if (!state || state.provider !== 'MICROSOFT') {
      redirectWithError(req, res, peekedState, 'invalid_oauth_state');
      return;
    }

    const user = await validateBoundUser(state);
    const microsoftClient = createMicrosoftClient();
    const tokenResult = await microsoftClient.getToken({
      code,
      redirect_uri: getMicrosoftRedirectUri(req),
      scope: MICROSOFT_CONTACTS_SCOPES.join(' '),
      code_verifier: state.codeVerifier,
    } as Parameters<typeof microsoftClient.getToken>[0]);
    const token = tokenResult.token as Record<string, unknown>;
    const idToken = typeof token.id_token === 'string' ? token.id_token : '';
    const accessToken = typeof token.access_token === 'string' ? token.access_token : '';
    const refreshToken = typeof token.refresh_token === 'string' ? token.refresh_token : '';
    if (!idToken || !accessToken || !refreshToken) {
      throw new Error('Microsoft did not return the required contacts credentials');
    }

    const claims = await verifyMicrosoftIdToken(idToken);
    const providerEmail = claims.email ?? claims.preferred_username;
    if (
      !providerEmail ||
      normalizeEmail(providerEmail) !== normalizeEmail(state.expectedEmail)
    ) {
      throw new Error('Microsoft account does not match the signed-in user');
    }

    const sourceId = await persistUserContactsCredentials({
      provider: 'MICROSOFT',
      email: providerEmail,
      refreshToken,
      accessToken,
      ...(getTokenExpiry(token) ? { accessTokenExpiry: getTokenExpiry(token) } : {}),
      ownerUserId: user.id,
    });

    logger.info('[USER_CONTACTS][MICROSOFT][OAUTH] Authorization completed', {
      ownerUserId: user.id,
      workspaceId: state.workspaceId,
      sourceId,
    });
    redirectWithResult(req, res, state, new URLSearchParams({ contactsImport: 'success' }));
  } catch (error) {
    logger.error('[USER_CONTACTS][MICROSOFT][OAUTH] Callback failed', error);
    redirectWithError(req, res, peekedState, 'microsoft_contacts_oauth_failed');
  }
});

export default router;
