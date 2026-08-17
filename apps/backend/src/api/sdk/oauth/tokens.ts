/**
 * JWT token service for SDK OAuth.
 *
 * Mints RS256 access tokens that the backend verifies locally.
 * The resource server (same process) re-reads roles from the DB on every
 * request, so demotions take effect immediately.
 */

import { createPrivateKey, createPublicKey, randomUUID } from 'node:crypto';
import { SignJWT, exportJWK, type JWK } from 'jose';
import type { Scope } from '@xyne/spaces-contract';
import { oauthConfig } from './config';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'sdk-oauth-tokens' });

export const REFRESH_TOKEN_PREFIX = 'xyne_rt_';

interface SigningKey {
  readonly privateKey: ReturnType<typeof createPrivateKey>;
  readonly publicKey: ReturnType<typeof createPublicKey>;
  readonly kid: string;
}

let cachedKey: SigningKey | null = null;

function getSigningKey(): SigningKey {
  if (cachedKey) return cachedKey;

  const pem = oauthConfig.privateKey;
  const kid = oauthConfig.keyId;

  if (!pem || !kid) {
    throw new Error('SDK_JWT_PRIVATE_KEY and SDK_JWT_KEY_ID must be set to mint SDK tokens');
  }

  const privateKey = createPrivateKey(pem);
  const publicKey = createPublicKey(privateKey);

  cachedKey = { privateKey, publicKey, kid };
  return cachedKey;
}

/**
 * Get the public key for local token verification.
 * Used by authn middleware instead of remote JWKS fetch.
 */
export function getPublicKey(): ReturnType<typeof createPublicKey> {
  return getSigningKey().publicKey;
}

export function getKeyId(): string {
  return getSigningKey().kid;
}

/** The JWKS document for SDK clients and the discovery endpoint. */
export async function getPublicJwks(): Promise<{ keys: JWK[] }> {
  const { publicKey, kid } = getSigningKey();
  const jwk = await exportJWK(publicKey);
  return { keys: [{ ...jwk, kid, use: 'sig', alg: 'RS256' }] };
}

export interface SdkPrincipalClaims {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  readonly workspaceId: string;
  readonly memberId: string;
}

export interface AccessTokenResult {
  readonly accessToken: string;
  readonly expiresIn: number;
}

/**
 * Mint an access token.
 *
 * Note: roles are NOT in the token. The resource server re-reads role and
 * orgRole from the database on every request, so demotions take effect
 * immediately rather than at token expiry.
 */
export async function mintAccessToken(
  principal: SdkPrincipalClaims,
  scopes: readonly Scope[],
  clientId: string,
): Promise<AccessTokenResult> {
  const { privateKey, kid } = getSigningKey();
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = oauthConfig.accessTokenTtlSeconds;

  const accessToken = await new SignJWT({
    email: principal.email,
    name: principal.name,
    workspace_id: principal.workspaceId,
    member_id: principal.memberId,
    client_id: clientId,
    scope: scopes.join(' '),
    token_use: 'access',
  })
    .setProtectedHeader({ alg: 'RS256', kid, typ: 'JWT' })
    .setSubject(principal.userId)
    .setIssuer(oauthConfig.issuer)
    .setAudience(oauthConfig.audience)
    .setIssuedAt(now)
    .setExpirationTime(now + expiresIn)
    .setJti(randomUUID())
    .sign(privateKey);

  log.info({
    msg: 'minted access token',
    userId: principal.userId,
    clientId,
    scopeCount: scopes.length,
    expiresIn,
  });

  return { accessToken, expiresIn };
}
