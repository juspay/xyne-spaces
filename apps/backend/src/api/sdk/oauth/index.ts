/**
 * OAuth routes for the SDK authorization server.
 *
 * The backend is both AS and RS: these endpoints mint tokens that the same
 * process verifies on /api/sdk requests. No external auth service dependency.
 *
 * Flow:
 * 1. SDK opens browser to GET /authorize?client_id=...&redirect_uri=...&scope=...
 * 2. User sees consent page (must be logged in via Spaces session)
 * 3. User clicks "Authorize"
 * 4. Backend redirects to redirect_uri with ?code=...
 * 5. SDK exchanges code via POST /token → access_token + refresh_token
 * 6. SDK uses access_token for API calls
 * 7. SDK refreshes via POST /token with grant_type=refresh_token
 */

import { Router, type Request, type Response } from 'express';
import { ALL_SCOPES, SCOPE_CATALOG, isScope, type Scope } from '@xyne/spaces-contract';
import { authMiddleware } from '@/middleware/auth';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { oauthConfig } from './config';
import { getPublicJwks, mintAccessToken, type SdkPrincipalClaims } from './tokens';
import { issueRefreshToken, consumeRefreshToken, revokeRefreshToken } from './refresh';
import { issueAuthorizationCode, consumeAuthorizationCode } from './authorization';
import { renderAuthorizePage, renderErrorPage, renderSuccessPage } from './pages';

const log = logger.child({ module: 'sdk-oauth' });
const router = Router();

// OAuth consent pages are intentionally served over plain HTTP in local
// development. Helmet's default `upgrade-insecure-requests` directive rewrites
// the form POST to HTTPS, which changes its origin and then conflicts with
// `form-action 'self'`. Override only this router with a tighter page policy
// that permits same-origin form submissions without upgrading localhost.
function oauthContentSecurityPolicy(): string {
  // Chromium applies `form-action` across the redirect chain. The consent
  // form posts to this origin, then redirects to the client's callback, so the
  // exact registered callback origins must be permitted as form destinations.
  const callbackOrigins = new Set<string>();
  for (const redirectUris of Object.values(oauthConfig.clients)) {
    for (const redirectUri of redirectUris) {
      callbackOrigins.add(new URL(redirectUri).origin);
    }
  }

  const formAction = ["'self'", ...callbackOrigins].join(' ');
  return [
    "default-src 'none'",
    "base-uri 'none'",
    `form-action ${formAction}`,
    "frame-ancestors 'none'",
    "style-src 'unsafe-inline'",
  ].join('; ');
}

router.use((_req, res, next) => {
  res.setHeader('Content-Security-Policy', oauthContentSecurityPolicy());
  next();
});

/** Check if OAuth is enabled and configured. */
function requireEnabled(_req: Request, res: Response, next: () => void): void {
  if (!oauthConfig.isConfigured) {
    res.status(404).json({
      error: 'not_supported',
      error_description: 'SDK OAuth is not enabled on this deployment.',
    });
    return;
  }
  next();
}

router.use(requireEnabled);

/**
 * Public keys for token verification.
 * Cacheable - jose refetches automatically when it sees an unknown `kid`.
 */
router.get('/jwks.json', async (_req: Request, res: Response) => {
  try {
    const jwks = await getPublicJwks();
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json(jwks);
  } catch (err) {
    log.error({ msg: 'failed to export JWKS', err });
    res.status(500).json({ error: 'server_error' });
  }
});

/** Discovery document for OAuth clients. */
router.get('/.well-known/oauth-authorization-server', (req: Request, res: Response) => {
  const base = `${req.protocol}://${req.get('host')}/api/sdk/oauth`;
  res.json({
    issuer: oauthConfig.issuer,
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: `${base}/token`,
    revocation_endpoint: `${base}/revoke`,
    jwks_uri: `${base}/jwks.json`,
    grant_types_supported: ['authorization_code', 'refresh_token'],
    response_types_supported: ['code'],
    scopes_supported: ALL_SCOPES,
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
  });
});

/**
 * Authorization endpoint - shows the consent page.
 * Requires user to be logged in via Spaces session.
 */
router.get('/authorize', authMiddleware.authenticate, async (req: Request, res: Response) => {
  try {
    const clientId = req.query['client_id'] as string | undefined;
    const redirectUri = req.query['redirect_uri'] as string | undefined;
    const scope = req.query['scope'] as string | undefined;
    const state = req.query['state'] as string | undefined;
    const codeChallenge = req.query['code_challenge'] as string | undefined;
    const codeChallengeMethod = req.query['code_challenge_method'] as string | undefined;

    // Validate client_id
    if (!clientId || !oauthConfig.isKnownClient(clientId)) {
      res.status(400).send(renderErrorPage('Invalid Client', 'Unknown or invalid client_id.'));
      return;
    }

    // Validate redirect_uri (must be localhost for SDK)
    if (!redirectUri) {
      res.status(400).send(renderErrorPage('Missing Redirect URI', 'redirect_uri is required.'));
      return;
    }

    if (!oauthConfig.isRedirectAllowed(clientId, redirectUri)) {
      res.status(400).send(
        renderErrorPage('Invalid Redirect URI', 'This redirect URI is not registered for the client.'),
      );
      return;
    }

    if (
      codeChallengeMethod !== 'S256' ||
      !codeChallenge ||
      !/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)
    ) {
      res.status(400).send(
        renderErrorPage('PKCE Required', 'A valid S256 code challenge is required.'),
      );
      return;
    }

    // Parse and validate scopes
    const requestedScopes = scope ? scope.split(' ').filter(isScope) : [...ALL_SCOPES];
    if (requestedScopes.length === 0) {
      requestedScopes.push(...ALL_SCOPES);
    }

    const user = req.user!;
    const scopeDescriptions = SCOPE_CATALOG.filter((s) => requestedScopes.includes(s.scope));

    // Render the consent page
    res.send(
      renderAuthorizePage({
        clientId,
        redirectUri,
        state,
        codeChallenge,
        scopes: requestedScopes,
        scopeDescriptions,
        user: {
          name: user.name || user.email,
          email: user.email,
        },
      }),
    );
  } catch (err) {
    log.error({ msg: 'authorize endpoint error', err });
    res.status(500).send(renderErrorPage('Server Error', 'An unexpected error occurred.'));
  }
});

/**
 * Authorization form submission - issues an authorization code.
 */
router.post('/authorize', authMiddleware.authenticate, async (req: Request, res: Response) => {
  try {
    const {
      client_id,
      redirect_uri,
      scope,
      state,
      action,
      code_challenge,
      code_challenge_method,
    } = req.body;

    if (!client_id || !oauthConfig.isKnownClient(client_id)) {
      res.status(400).send(renderErrorPage('Invalid Client', 'Unknown or invalid client_id.'));
      return;
    }

    if (!redirect_uri || !oauthConfig.isRedirectAllowed(client_id, redirect_uri)) {
      res.status(400).send(
        renderErrorPage('Invalid Redirect URI', 'This redirect URI is not registered for the client.'),
      );
      return;
    }

    if (
      code_challenge_method !== 'S256' ||
      typeof code_challenge !== 'string' ||
      !/^[A-Za-z0-9_-]{43,128}$/.test(code_challenge)
    ) {
      res.status(400).send(
        renderErrorPage('PKCE Required', 'A valid S256 code challenge is required.'),
      );
      return;
    }

    // Handle deny action
    if (action === 'deny') {
      const redirectUrl = new URL(redirect_uri);
      redirectUrl.searchParams.set('error', 'access_denied');
      redirectUrl.searchParams.set('error_description', 'User denied the authorization request.');
      if (state) redirectUrl.searchParams.set('state', state);
      res.redirect(redirectUrl.toString());
      return;
    }

    const redirectUrl = new URL(redirect_uri);

    // Parse scopes
    const requestedScopes: Scope[] = scope
      ? scope.split(' ').filter(isScope)
      : ([...ALL_SCOPES] as Scope[]);

    const user = req.user!;

    // Issue authorization code
    const { code } = await issueAuthorizationCode({
      userId: user.id,
      workspaceId: user.workspaceId!,
      memberId: user.memberId!,
      clientId: client_id,
      scopes: requestedScopes,
      redirectUri: redirect_uri,
      codeChallenge: code_challenge,
    });

    // Redirect with code
    redirectUrl.searchParams.set('code', code);
    if (state) redirectUrl.searchParams.set('state', state);
    res.redirect(redirectUrl.toString());
  } catch (err) {
    log.error({ msg: 'authorize POST error', err });
    res.status(500).send(renderErrorPage('Server Error', 'An unexpected error occurred.'));
  }
});

/**
 * Token endpoint - exchanges authorization codes or refresh tokens.
 */
router.post('/token', async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const grantType = typeof body['grant_type'] === 'string' ? body['grant_type'] : '';
  const clientId = typeof body['client_id'] === 'string' ? body['client_id'] : '';

  if (!oauthConfig.isKnownClient(clientId)) {
    res.status(400).json({ error: 'invalid_client' });
    return;
  }

  try {
    if (grantType === 'authorization_code') {
      await handleAuthorizationCodeGrant(res, clientId, body);
      return;
    }
    if (grantType === 'refresh_token') {
      await handleRefreshTokenGrant(res, clientId, body);
      return;
    }
    res.status(400).json({ error: 'unsupported_grant_type' });
  } catch (err) {
    log.error({ msg: 'token endpoint error', err });
    res.status(500).json({ error: 'server_error' });
  }
});

async function handleAuthorizationCodeGrant(
  res: Response,
  clientId: string,
  body: Record<string, unknown>,
): Promise<void> {
  const code = typeof body['code'] === 'string' ? body['code'] : '';
  const redirectUri = typeof body['redirect_uri'] === 'string' ? body['redirect_uri'] : undefined;
  const codeVerifier = typeof body['code_verifier'] === 'string' ? body['code_verifier'] : undefined;

  if (!code) {
    res.status(400).json({ error: 'invalid_request', error_description: 'code is required.' });
    return;
  }

  const consumed = await consumeAuthorizationCode(code, clientId, redirectUri, codeVerifier);
  if (!consumed.ok) {
    const descriptions: Record<string, string> = {
      invalid: 'Authorization code is invalid.',
      expired: 'Authorization code has expired.',
      already_used: 'Authorization code has already been used.',
      client_mismatch: 'Client ID does not match the authorization.',
      redirect_mismatch: 'Redirect URI does not match the authorization.',
      pkce_mismatch: 'PKCE code verifier is missing or invalid.',
    };
    res.status(400).json({
      error: 'invalid_grant',
      error_description: descriptions[consumed.reason] ?? 'Invalid authorization code.',
    });
    return;
  }

  // Get user info for token claims
  const user = await db.user.findUnique({
    where: { id: consumed.userId },
    select: { id: true, email: true, name: true, displayName: true, orgMemberId: true },
  });

  if (!user) {
    res.status(400).json({
      error: 'invalid_grant',
      error_description: 'User no longer exists.',
    });
    return;
  }

  const principal: SdkPrincipalClaims = {
    userId: user.id,
    email: user.email,
    name: user.displayName || user.name,
    workspaceId: consumed.workspaceId,
    memberId: consumed.memberId,
  };

  const access = await mintAccessToken(principal, consumed.scopes as Scope[], clientId);
  const refresh = await issueRefreshToken({
    userId: consumed.userId,
    workspaceId: consumed.workspaceId,
    clientId,
    scopes: consumed.scopes,
  });

  log.info({
    msg: 'issued tokens via authorization_code',
    userId: user.id,
    clientId,
    scopeCount: consumed.scopes.length,
  });

  res.json({
    access_token: access.accessToken,
    token_type: 'Bearer',
    expires_in: access.expiresIn,
    refresh_token: refresh.refreshToken,
    scope: consumed.scopes.join(' '),
  });
}

async function handleRefreshTokenGrant(
  res: Response,
  clientId: string,
  body: Record<string, unknown>,
): Promise<void> {
  const raw = typeof body['refresh_token'] === 'string' ? body['refresh_token'] : '';
  if (!raw) {
    res.status(400).json({
      error: 'invalid_request',
      error_description: 'refresh_token is required.',
    });
    return;
  }

  const consumed = await consumeRefreshToken(raw);
  if (!consumed.ok) {
    const descriptions: Record<string, string> = {
      invalid: 'Refresh token is invalid.',
      expired: 'Refresh token has expired.',
      revoked: 'Refresh token has been revoked.',
      reused:
        'This refresh token was already used. All sessions in its family have been revoked; sign in again.',
    };
    res.status(400).json({
      error: 'invalid_grant',
      error_description: descriptions[consumed.reason] ?? 'Invalid refresh token.',
    });
    return;
  }

  if (consumed.clientId !== clientId) {
    res.status(400).json({ error: 'invalid_client' });
    return;
  }

  // Get user info for token claims
  const user = await db.user.findUnique({
    where: { id: consumed.userId },
    select: { id: true, email: true, name: true, displayName: true, orgMemberId: true },
  });

  if (!user) {
    res.status(400).json({
      error: 'invalid_grant',
      error_description: 'User no longer exists.',
    });
    return;
  }

  const principal: SdkPrincipalClaims = {
    userId: user.id,
    email: user.email,
    name: user.displayName || user.name,
    workspaceId: consumed.workspaceId,
    memberId: user.orgMemberId,
  };

  const access = await mintAccessToken(principal, consumed.scopes as Scope[], clientId);

  // Rotation: issue new refresh token in same family
  const refresh = await issueRefreshToken({
    userId: consumed.userId,
    workspaceId: consumed.workspaceId,
    clientId,
    scopes: consumed.scopes,
    familyId: consumed.familyId,
  });

  res.json({
    access_token: access.accessToken,
    token_type: 'Bearer',
    expires_in: access.expiresIn,
    refresh_token: refresh.refreshToken,
    scope: consumed.scopes.join(' '),
  });
}

/** Revoke a refresh token without requiring the user's browser session. */
router.post('/revoke', async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const token = typeof body['token'] === 'string' ? body['token'] : '';
    const clientId = typeof body['client_id'] === 'string' ? body['client_id'] : '';
    if (!token || !oauthConfig.isKnownClient(clientId)) {
      // RFC 7009 deliberately avoids revealing whether a token exists.
      res.status(200).end();
      return;
    }
    await revokeRefreshToken(token, clientId);
    res.status(200).end();
  } catch (err) {
    log.error({ msg: 'revoke endpoint error', err });
    res.status(500).json({ error: 'server_error' });
  }
});

/**
 * Success page shown after authorization (when SDK doesn't redirect).
 */
router.get('/success', (_req: Request, res: Response) => {
  res.send(renderSuccessPage());
});

export { router as oauthRouter };
