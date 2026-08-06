/**
 * OAuth configuration for the SDK authorization server.
 *
 * The backend is both AS and RS: it mints RS256 JWTs and verifies them locally.
 * No external auth service dependency.
 */

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
    if (!raw) return undefined;
    // Support both raw PEM and base64-encoded PEM
    return raw.includes('BEGIN') ? raw : Buffer.from(raw, 'base64').toString('utf8');
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

  /** First-party clients that don't need registration. */
  knownClients: new Set(['xyne-spaces-sdk', 'xyne-cli']),

  /** Check if OAuth is properly configured (has required keys). */
  get isConfigured(): boolean {
    return this.enabled && !!this.privateKey && !!this.keyId;
  },
} as const;
