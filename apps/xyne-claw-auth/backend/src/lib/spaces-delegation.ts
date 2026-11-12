/**
 * Spaces delegation tokens: how claw-auth learns WHICH user a Spaces backend
 * call is for, without trusting a caller-chosen header.
 *
 * The Spaces backend signs a short-lived ES256 JWT for one user and one action
 * with a private key only it holds; claw-auth verifies it with the matching
 * public key (SPACES_DELEGATION_PUBLIC_KEYS). Holding the shared S2S key, or
 * this service's own config, is not enough to produce one.
 *
 * Claims:
 *   iss  "xyne-spaces"
 *   aud  "xyne-claw-auth"
 *   sub  Spaces user id the call is for
 *   ws   Spaces workspace id (optional)
 *   prp  what the call is for, e.g. "agent-chat:messages" (logged, not enforced yet)
 *   iat / exp  at most MAX_LIFETIME_SECONDS apart
 *   jti  unique id (logged)
 */

import { importSPKI, jwtVerify, decodeProtectedHeader, type CryptoKey } from "jose";
import { CONFIG } from "../config.js";

export const DELEGATION_HEADER = "x-spaces-delegation";
export const DELEGATION_ISSUER = "xyne-spaces";
export const DELEGATION_AUDIENCE = "xyne-claw-auth";
const MAX_LIFETIME_SECONDS = 600;
const CLOCK_TOLERANCE_SECONDS = 30;

export interface SpacesDelegation {
  spacesUserId: string;
  workspaceId?: string;
  purpose?: string;
  jti?: string;
  keyId: string;
}

export type DelegationError =
  | "not-configured"
  | "malformed"
  | "unknown-key"
  | "invalid"
  | "lifetime-too-long";

const keyCache = new Map<string, Promise<CryptoKey>>();

/** kid -> PEM (SPKI). Parsed once; rotation means adding a kid, then removing the old one. */
function publicKeyPem(kid: string): string | undefined {
  return CONFIG.spacesDelegationPublicKeys[kid];
}

function publicKey(kid: string): Promise<CryptoKey> | undefined {
  const pem = publicKeyPem(kid);
  if (!pem) return undefined;
  let key = keyCache.get(kid);
  if (!key) {
    key = importSPKI(pem, "ES256");
    keyCache.set(kid, key);
  }
  return key;
}

export async function verifySpacesDelegation(raw: unknown): Promise<SpacesDelegation | DelegationError> {
  if (Object.keys(CONFIG.spacesDelegationPublicKeys).length === 0) return "not-configured";
  if (typeof raw !== "string" || !raw.trim()) return "malformed";
  const token = raw.trim();

  let kid: string | undefined;
  let typ: string | undefined;
  try {
    ({ kid, typ } = decodeProtectedHeader(token));
  } catch {
    return "malformed";
  }
  // Event tokens share the issuer and audience; they authenticate one event
  // delivery (verifySpacesEvent), never a user on other routes.
  if (typ === EVENT_TYP) return "invalid";
  const key = kid ? publicKey(kid) : undefined;
  if (!kid || !key) return "unknown-key";

  try {
    const { payload } = await jwtVerify(token, await key, {
      algorithms: ["ES256"],
      issuer: DELEGATION_ISSUER,
      audience: DELEGATION_AUDIENCE,
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
      requiredClaims: ["sub", "iat", "exp"],
    });
    if (typeof payload.exp !== "number" || typeof payload.iat !== "number") return "invalid";
    if (payload.exp - payload.iat > MAX_LIFETIME_SECONDS) return "lifetime-too-long";
    const spacesUserId = typeof payload.sub === "string" ? payload.sub.trim() : "";
    if (!spacesUserId) return "invalid";
    return {
      spacesUserId,
      ...(typeof payload["ws"] === "string" && payload["ws"].trim() ? { workspaceId: payload["ws"].trim() } : {}),
      ...(typeof payload["prp"] === "string" ? { purpose: payload["prp"] } : {}),
      ...(typeof payload.jti === "string" ? { jti: payload.jti } : {}),
      keyId: kid,
    };
  } catch {
    return "invalid";
  }
}

// ── Event tokens (Spaces → claw-auth events for agent principals) ────────────

export const EVENT_HEADER = "x-spaces-event";
const EVENT_TYP = "claw-event+jwt";

/** Purpose of the event token on a flow-card click (Spaces claw/events.ts postAgentFlowAction). */
export const FLOW_ACTION_PURPOSE = "event:flow_action";

export interface SpacesEvent {
  /** The user who caused the event (sender), or the agent's own bot for system events. */
  spacesUserId: string;
  workspaceId: string;
  principalId: string;
  purpose?: string;
  jti: string;
  /** The raw token: usable once more as live-interaction proof when asking Spaces for an agent token. */
  token: string;
}

/**
 * Verify an event token for `principalId` over the exact request body. Checks
 * signature (Spaces' key), typ, issuer, audience, lifetime, principal, and that
 * `bh` is the SHA-256 of `rawBody`. Replay is checked by the caller (jti).
 */
export async function verifySpacesEvent(
  raw: unknown,
  principalId: string,
  rawBody: Buffer,
): Promise<SpacesEvent | DelegationError | "wrong-principal" | "body-mismatch"> {
  if (Object.keys(CONFIG.spacesDelegationPublicKeys).length === 0) return "not-configured";
  if (typeof raw !== "string" || !raw.trim()) return "malformed";
  const token = raw.trim();
  let header: { kid?: string; typ?: string };
  try {
    header = decodeProtectedHeader(token);
  } catch {
    return "malformed";
  }
  if (header.typ !== EVENT_TYP) return "invalid";
  const key = header.kid ? publicKey(header.kid) : undefined;
  if (!header.kid || !key) return "unknown-key";
  try {
    const { payload } = await jwtVerify(token, await key, {
      algorithms: ["ES256"],
      issuer: DELEGATION_ISSUER,
      audience: DELEGATION_AUDIENCE,
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
      requiredClaims: ["sub", "iat", "exp", "jti"],
    });
    if (typeof payload.exp !== "number" || typeof payload.iat !== "number") return "invalid";
    if (payload.exp - payload.iat > MAX_LIFETIME_SECONDS) return "lifetime-too-long";
    if (payload["pid"] !== principalId) return "wrong-principal";
    const { createHash } = await import("node:crypto");
    if (payload["bh"] !== createHash("sha256").update(rawBody).digest("hex")) return "body-mismatch";
    const sub = typeof payload.sub === "string" ? payload.sub.trim() : "";
    const ws = typeof payload["ws"] === "string" ? payload["ws"] : "";
    if (!sub || !ws || typeof payload.jti !== "string") return "invalid";
    return {
      spacesUserId: sub,
      workspaceId: ws,
      principalId,
      ...(typeof payload["prp"] === "string" ? { purpose: payload["prp"] } : {}),
      jti: payload.jti,
      token,
    };
  } catch {
    return "invalid";
  }
}
