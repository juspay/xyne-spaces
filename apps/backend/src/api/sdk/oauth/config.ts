/**
 * OAuth configuration for the SDK authorization server.
 *
 * The backend is both AS and RS: it mints RS256 JWTs and verifies them locally.
 * No external auth service dependency.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface OAuthClientRegistry {
  readonly [clientId: string]: readonly string[];
}

export const oauthConfig = {
  /** Master switch. OAuth endpoints are not mounted when false. */
  get enabled(): boolean {
    return process.env['SDK_OAUTH_ENABLED'] === 'true';
  },

  /**
   * RSA private key in PEM format (or base64-encoded PEM).
   * Generate with: openssl genrsa -out sdk-jwt.pem 2048
   */
  get privateKey(): string | undefined {
    const raw = process.env['SDK_JWT_PRIVATE_KEY'];
    if (raw) {
      // Support both raw PEM and base64-encoded PEM.
      return raw.includes('BEGIN') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    }

    const file = process.env['SDK_JWT_PRIVATE_KEY_FILE'];
    if (!file) return undefined;
    return readFileSync(resolve(process.cwd(), file), 'utf8');
  },

  /** Key ID published in the JWKS. Change when rotating keys. */
  get keyId(): string {
    return process.env['SDK_JWT_KEY_ID'] ?? 'sdk-key-1';
  },

  get issuer(): string {
    return process.env['SDK_TOKEN_ISSUER'] ?? 'xyne-spaces';
  },

  get audience(): string {
    return process.env['SDK_TOKEN_AUDIENCE'] ?? 'xyne-spaces-api';
  },

  /** Access token lifetime in seconds (default 15 minutes). */
  get accessTokenTtlSeconds(): number {
    return Number(process.env['SDK_ACCESS_TOKEN_TTL_SECONDS'] ?? 900);
  },

  /** Refresh token lifetime in days (default 30 days). */
  get refreshTokenTtlDays(): number {
    return Number(process.env['SDK_REFRESH_TOKEN_TTL_DAYS'] ?? 30);
  },

  /** Authorization code lifetime in seconds (default 10 minutes). */
  get authCodeTtlSeconds(): number {
    return Number(process.env['SDK_AUTH_CODE_TTL_SECONDS'] ?? 600);
  },

  /** Public clients and their exact redirect URI allowlists. */
  get clients(): OAuthClientRegistry {
    const raw = process.env['SDK_OAUTH_CLIENTS'];
    if (!raw) {
      return {
        'xyne-spaces-sdk': [],
        'xyne-cli': [],
      };
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('SDK_OAUTH_CLIENTS must be a JSON object of client ids to redirect URI arrays.');
    }

    const clients: Record<string, readonly string[]> = {};
    for (const [clientId, redirectUris] of Object.entries(parsed)) {
      if (
        !clientId ||
        !Array.isArray(redirectUris) ||
        !redirectUris.every((uri) => typeof uri === 'string' && uri.length > 0)
      ) {
        throw new Error(`Invalid SDK_OAUTH_CLIENTS entry for "${clientId}".`);
      }
      clients[clientId] = redirectUris;
    }
    return clients;
  },

  isKnownClient(clientId: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.clients, clientId);
  },

  isRedirectAllowed(clientId: string, redirectUri: string): boolean {
    const allowed = this.clients[clientId];
    if (!allowed) return false;
    if (allowed.length > 0) return allowed.includes(redirectUri);

    // Backward-compatible local development default. Deployments should set
    // SDK_OAUTH_CLIENTS so redirects are matched exactly.
    const url = new URL(redirectUri);
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  },

  /** Check if OAuth is properly configured (has required keys). */
  get isConfigured(): boolean {
    return this.enabled && !!this.privateKey && !!this.keyId;
  },
} as const;
