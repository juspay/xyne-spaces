/**
 * MCP Gateway JWT Utilities
 * Sign and verify JWTs for gateway-to-backend authentication using RS256.
 * Uses the `jose` library (already a dependency of this package).
 */

import { importPKCS8, importSPKI, SignJWT, jwtVerify } from "jose";

// ============================================================================
// Types
// ============================================================================

export interface GatewayJwtPayload {
  sub: string;
  tenantId: string;
  serviceName: string;
  backendId: string;
  email: string;
}

export interface SignOptions {
  issuer: string;
  audience: string;
  privateKeyPem: string;
  /** publicKeyPem accepted for API symmetry but not used during signing */
  publicKeyPem: string;
  ttlSeconds: number;
  privateKeyId?: string;
}

export interface SignResult {
  token: string;
  expiresAt: Date;
}

export interface VerifyOptions {
  publicKeyPem: string;
  issuer: string;
  audience: string;
}

// ============================================================================
// Sign
// ============================================================================

/**
 * Sign a gateway JWT using the configured RSA private key.
 * Returns a Promise<{ token, expiresAt }>. Callers must await this.
 */
export async function signGatewayJwt(
  payload: GatewayJwtPayload,
  options: SignOptions
): Promise<SignResult> {
  const { issuer, audience, privateKeyPem, ttlSeconds, privateKeyId } = options;

  // Normalise escaped newlines so PEM values stored in env vars work as-is
  const normalizedPem = privateKeyPem.replace(/\\n/g, "\n");
  const privateKey = await importPKCS8(normalizedPem, "RS256");

  const now = Math.floor(Date.now() / 1000);
  const exp = now + ttlSeconds;

  const token = await new SignJWT({
    email: payload.email,
    tenantId: payload.tenantId,
    serviceName: payload.serviceName,
    backendId: payload.backendId,
  })
    .setProtectedHeader({
      alg: "RS256",
      ...(privateKeyId ? { kid: privateKeyId } : {}),
    })
    .setSubject(payload.sub)
    .setIssuedAt(now)
    .setIssuer(issuer)
    .setAudience(audience)
    .setExpirationTime(exp)
    .sign(privateKey);

  return { token, expiresAt: new Date(exp * 1000) };
}

// ============================================================================
// Verify
// ============================================================================

/**
 * Verify a gateway-signed JWT using the RSA public key.
 * Throws if the token is invalid, expired, or issuer/audience mismatch.
 */
export async function verifyGatewayJwt(
  token: string,
  options: VerifyOptions
): Promise<GatewayJwtPayload> {
  const { publicKeyPem, issuer, audience } = options;

  const normalizedPem = publicKeyPem.replace(/\\n/g, "\n");
  const publicKey = await importSPKI(normalizedPem, "RS256");

  const { payload } = await jwtVerify(token, publicKey, { issuer, audience });

  return {
    sub: typeof payload.sub === "string" ? payload.sub : "",
    email: typeof payload["email"] === "string" ? (payload["email"] as string) : "",
    tenantId: typeof payload["tenantId"] === "string" ? (payload["tenantId"] as string) : "",
    serviceName: typeof payload["serviceName"] === "string" ? (payload["serviceName"] as string) : "",
    backendId: typeof payload["backendId"] === "string" ? (payload["backendId"] as string) : "",
  };
}
