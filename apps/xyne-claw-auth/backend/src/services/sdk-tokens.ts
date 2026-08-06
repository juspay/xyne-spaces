/**
 * Token service for the public Spaces SDK.
 *
 * claw-auth is the authorization server: it mints short-lived RS256 access JWTs
 * that the Spaces backend verifies statelessly through JWKS, plus long-lived
 * rotating refresh tokens which are the only revocation point.
 *
 * RS256 rather than a shared HMAC secret on purpose — the resource server holds
 * only the public key, so a compromise there cannot forge tokens, and keys can
 * rotate by `kid` without redeploying both services in lockstep.
 */

import { createHash, randomBytes, randomUUID, createPrivateKey, createPublicKey } from "node:crypto";
import { SignJWT, exportJWK, type JWK } from "jose";
import { prisma } from "../db.js";
import { createLogger } from "../logger.js";

const log = createLogger("sdk-tokens");

export const REFRESH_TOKEN_PREFIX = "xyne_rt_";

export const SDK_TOKEN_ISSUER = process.env["SDK_TOKEN_ISSUER"] ?? "xyne-claw-auth";
export const SDK_TOKEN_AUDIENCE = process.env["SDK_TOKEN_AUDIENCE"] ?? "xyne-spaces-api";

const ACCESS_TOKEN_TTL_SECONDS = Number(process.env["SDK_ACCESS_TOKEN_TTL_SECONDS"] ?? 900);
const REFRESH_TOKEN_TTL_DAYS = Number(process.env["SDK_REFRESH_TOKEN_TTL_DAYS"] ?? 30);

/** Whether the SDK OAuth surface is configured well enough to serve requests. */
export function sdkTokensEnabled(): boolean {
  return (
    process.env["SDK_OAUTH_ENABLED"] === "true" &&
    !!process.env["SDK_JWT_PRIVATE_KEY"] &&
    !!process.env["SDK_JWT_KEY_ID"]
  );
}

interface SigningKey {
  readonly privateKey: ReturnType<typeof createPrivateKey>;
  readonly kid: string;
}

let cachedKey: SigningKey | null = null;

function getSigningKey(): SigningKey {
  if (cachedKey) return cachedKey;
  const pem = process.env["SDK_JWT_PRIVATE_KEY"];
  const kid = process.env["SDK_JWT_KEY_ID"];
  if (!pem || !kid) {
    throw new Error("SDK_JWT_PRIVATE_KEY and SDK_JWT_KEY_ID must be set to mint SDK tokens");
  }
  // Support both a raw PEM and a base64-encoded one, since multi-line secrets
  // are awkward in some deployment systems.
  const normalized = pem.includes("BEGIN") ? pem : Buffer.from(pem, "base64").toString("utf8");
  cachedKey = { privateKey: createPrivateKey(normalized), kid };
  return cachedKey;
}

/** The JWKS document served to the resource server. Public key material only. */
export async function getPublicJwks(): Promise<{ keys: JWK[] }> {
  const { privateKey, kid } = getSigningKey();
  const jwk = await exportJWK(createPublicKey(privateKey));
  return { keys: [{ ...jwk, kid, use: "sig", alg: "RS256" }] };
}

export interface SdkPrincipalClaims {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  readonly workspaceId: string;
  readonly memberId: string;
  readonly orgId: string;
}

export interface AccessTokenResult {
  readonly accessToken: string;
  readonly expiresIn: number;
}

/**
 * Mint an access token.
 *
 * Note what is NOT in here: roles. The resource server re-reads role and orgRole
 * from the database on every request, so a demotion takes effect immediately
 * rather than at the end of this token's lifetime.
 */
export async function mintAccessToken(
  principal: SdkPrincipalClaims,
  scopes: readonly string[],
  clientId: string,
): Promise<AccessTokenResult> {
  const { privateKey, kid } = getSigningKey();
  const now = Math.floor(Date.now() / 1000);

  const accessToken = await new SignJWT({
    email: principal.email,
    name: principal.name,
    workspace_id: principal.workspaceId,
    member_id: principal.memberId,
    org_id: principal.orgId,
    client_id: clientId,
    scope: scopes.join(" "),
    token_use: "access",
  })
    .setProtectedHeader({ alg: "RS256", kid, typ: "JWT" })
    .setSubject(principal.userId)
    .setIssuer(SDK_TOKEN_ISSUER)
    .setAudience(SDK_TOKEN_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + ACCESS_TOKEN_TTL_SECONDS)
    .setJti(randomUUID())
    .sign(privateKey);

  return { accessToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
}

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export interface IssuedRefreshToken {
  readonly refreshToken: string;
  readonly familyId: string;
  readonly expiresAt: Date;
}

export async function issueRefreshToken(input: {
  userId: string;
  orgId: string;
  clientId: string;
  scopes: readonly string[];
  familyId?: string;
}): Promise<IssuedRefreshToken> {
  const raw = `${REFRESH_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  const familyId = input.familyId ?? randomUUID();
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  await prisma.sdkRefreshToken.create({
    data: {
      userId: input.userId,
      orgId: input.orgId,
      clientId: input.clientId,
      familyId,
      tokenHash: hashToken(raw),
      prefix: raw.slice(0, 12),
      scopes: [...input.scopes],
      expiresAt,
    },
  });

  return { refreshToken: raw, familyId, expiresAt };
}

export type RefreshResult =
  | { ok: true; userId: string; orgId: string; clientId: string; scopes: string[]; familyId: string }
  | { ok: false; reason: "invalid" | "expired" | "revoked" | "reused" };

/**
 * Consume a refresh token, single-use.
 *
 * Presenting an already-rotated token means either a replay or a stolen token
 * being used alongside the legitimate client. Both are answered the same way:
 * revoke the entire family, which forces a fresh device authorization.
 */
export async function consumeRefreshToken(raw: string): Promise<RefreshResult> {
  const tokenHash = hashToken(raw);
  const row = await prisma.sdkRefreshToken.findUnique({ where: { tokenHash } });

  if (!row) return { ok: false, reason: "invalid" };
  if (row.revokedAt) return { ok: false, reason: "revoked" };

  if (row.rotatedAt) {
    log.warn(
      `[sdk-tokens] refresh token reuse detected; revoking family userId=${row.userId} family=${row.familyId}`,
    );
    await revokeFamily(row.familyId);
    return { ok: false, reason: "reused" };
  }

  if (row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };

  await prisma.sdkRefreshToken.update({
    where: { id: row.id },
    data: { rotatedAt: new Date(), lastUsedAt: new Date() },
  });

  return {
    ok: true,
    userId: row.userId,
    orgId: row.orgId,
    clientId: row.clientId,
    scopes: row.scopes,
    familyId: row.familyId,
  };
}

export async function revokeFamily(familyId: string): Promise<number> {
  const result = await prisma.sdkRefreshToken.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

export async function revokeAllForUser(userId: string, clientId?: string): Promise<number> {
  const result = await prisma.sdkRefreshToken.updateMany({
    where: { userId, revokedAt: null, ...(clientId ? { clientId } : {}) },
    data: { revokedAt: new Date() },
  });
  return result.count;
}
